/**
 * HTTP smoke suite for a running TransferHub API (local or deployed). No dependencies beyond Node 18+ (global fetch).
 *
 *   npm run smoke -- --base https://<app>.azurewebsites.net/api
 *   npm run smoke -- --base http://localhost:3000/api --json smoke-report.json
 *   npm run smoke -- --base https://<app>/api --write      # also runs the few self-cleaning mutating checks
 *
 * Options
 *   --base <url>     API root including the /api prefix (or env SMOKE_BASE)
 *   --write          enable mutating checks (create + cancel one document request on Maya's demo request)
 *   --json <path>    write a machine-readable report
 *   --timeout <ms>   per-request timeout (default 20000)
 *   --verbose        print response detail for every check
 * Credentials: the demo accounts from CLAUDE.md; override per role with
 *   SMOKE_STUDENT_EMAIL / SMOKE_STUDENT_PASSWORD, SMOKE_FACULTY_*, SMOKE_ADMIN_*, SMOKE_AGENCY_*, SMOKE_SUPER_ADMIN_*
 *
 * Statuses: PASS, FAIL, SKIP (precondition missing, e.g. demo not seeded), INFO (informational, never fails).
 * Exit code 1 if any check FAILs (or the API is unreachable), else 0. Read-only unless --write is given.
 */
import { writeFileSync } from 'node:fs';
import { checkDemoScenario } from './maya';
import { Ctx, Http, ROLES, Role, Session, SkipError, Status, Result, expect, shape } from './core';

// ── args ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const base = (opt('base') ?? process.env.SMOKE_BASE ?? '').replace(/\/+$/, '');
const write = flag('write');
const verbose = flag('verbose');
const jsonPath = opt('json');
const timeoutMs = Number(opt('timeout') ?? 20000);

if (!base) {
  console.error('Usage: npm run smoke -- --base https://<app>/api [--write] [--json report.json] [--verbose]');
  process.exit(2);
}

const DEMO: Record<Role, { email: string; password: string }> = {
  student: { email: 'student@test.edu', password: 'Student@123!' },
  faculty: { email: 'faculty.cs@bu.edu', password: 'Faculty@123!' },
  admin: { email: 'admin@bu.edu', password: 'Admin@123!' },
  agency: { email: 'agency@partner.edu', password: 'Agency@123!' },
  super_admin: { email: 'super_admin@bu.edu', password: 'SuperAdmin@123!' },
};
const creds = (r: Role) => {
  const k = r.toUpperCase();
  return { email: process.env[`SMOKE_${k}_EMAIL`] ?? DEMO[r].email, password: process.env[`SMOKE_${k}_PASSWORD`] ?? DEMO[r].password };
};

const http = new Http(base, timeoutMs);
const results: Result[] = [];
const sessions: Partial<Record<Role, Session>> = {};

const ctx: Ctx = {
  http,
  write,
  sessions,
  info: (m) => { current.info.push(m); },
};
let current: { info: string[] } = { info: [] };

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  current = { info: [] };
  const t0 = Date.now();
  let status: Status = 'PASS';
  let detail = '';
  try {
    detail = ((await fn()) as string | undefined) ?? '';
  } catch (e) {
    if (e instanceof SkipError) { status = 'SKIP'; detail = e.message; }
    else { status = 'FAIL'; detail = (e as Error).message; }
  }
  const ms = Date.now() - t0;
  results.push({ name, status, detail, ms, info: current.info });
  console.log(`${status.padEnd(4)}  ${name}${detail ? `  - ${detail}` : ''}  (${ms} ms)`);
  for (const i of current.info) console.log(`INFO  ${name}: ${i}`);
}

const need = (r: Role): Session => {
  const s = sessions[r];
  if (!s) throw new SkipError(`no ${r} session (login failed earlier)`);
  return s;
};

async function main() {
  console.log(`TransferHub smoke - ${base}${write ? '  [--write enabled]' : '  [read-only]'}\n`);

  // 1. health
  let reachable = true;
  await check('health: GET /health is ok', async () => {
    try {
      const r = await http.get('/health');
      expect(r.status === 200, `status ${r.status}`);
      expect(r.json?.status === 'ok', `body ${JSON.stringify(r.json)}`);
    } catch (e) { reachable = false; throw e; }
  });
  if (!reachable) {
    console.log('\nAPI not reachable - skipping the rest.');
    return finish();
  }

  // 2. login per role
  for (const role of ROLES) {
    await check(`login: ${role}`, async () => {
      const c = creds(role);
      const r = await http.post('/auth/login', { email: c.email, password: c.password });
      expect(r.status === 200 || r.status === 201, `status ${r.status} ${typeof r.json?.message === 'string' ? r.json.message : ''} (did you run "npm run seed:users" on this DB?)`);
      shape(r.json, { accessToken: 'string', user: 'object' }, 'login response');
      sessions[role] = { token: r.json.accessToken, user: r.json.user, email: c.email };
      return `role=${r.json.user?.role ?? '?'}`;
    });
  }

  // 3. permissions + dashboards per role
  for (const role of ROLES) {
    await check(`permissions: GET /permissions/my (${role})`, async () => {
      const r = await http.get('/permissions/my', need(role).token);
      expect(r.status === 200, `status ${r.status}`);
      expect(r.json && typeof r.json === 'object' && !Array.isArray(r.json), 'expected an object of modules');
      const modules = Object.keys(r.json);
      if (role === 'super_admin') expect(modules.length > 0, 'super_admin has no grants at all - is seed 008 applied?');
      return `${modules.length} modules`;
    });
  }
  for (const role of ROLES) {
    await check(`dashboard: GET /dashboard (${role})`, async () => {
      const r = await http.get('/dashboard', need(role).token);
      if (role === 'agency' && r.status >= 400) { ctx.info(`agency dashboard returned ${r.status} (agency uses its own page)`); return; }
      expect(r.status === 200, `status ${r.status}`);
      expect(Array.isArray(r.json?.kpis ?? []), 'kpis should be an array');
      expect(r.json?.role === role || r.json?.role !== undefined, 'missing role field');
      return `${(r.json?.kpis ?? []).length} kpis`;
    });
    await check(`dashboard: GET /dashboard/bento (${role})`, async () => {
      const r = await http.get('/dashboard/bento', need(role).token);
      expect(r.status === 200, `status ${r.status}`);
      expect(r.json && typeof r.json === 'object', 'expected an object');
      return `keys: ${Object.keys(r.json).slice(0, 5).join(',')}`;
    });
  }

  // 4. student progress
  await check('progress: GET /progress/me shape (student)', async () => {
    const r = await http.get('/progress/me', need('student').token);
    expect(r.status === 200, `status ${r.status}`);
    shape(r.json, { totals: 'object', cap: 'object', hub: 'object', requests: 'array' }, 'progress');
    shape(r.json.totals, { secure: 'number', likelyLow: 'number', likelyHigh: 'number', pending: 'number', notCounted: 'number' }, 'progress.totals');
    shape(r.json.cap, { limit: 'number', used: 'number', remaining: 'number' }, 'progress.cap');
    return `secure=${r.json.totals.secure} cap=${r.json.cap.limit}`;
  });

  // 5. Maya scenario (own module)
  await checkDemoScenario(ctx, check, need);

  // 6. staff requests
  await check('requests: GET /requests/queue?scope=all and /requests/:id timeline (admin)', async () => {
    const q = await http.get('/requests/queue?scope=all', need('admin').token);
    expect(q.status === 200, `queue status ${q.status}`);
    const items = Array.isArray(q.json) ? q.json : q.json?.items ?? q.json?.rows ?? [];
    expect(Array.isArray(items), 'queue should be a list');
    let id: string | undefined = items[0]?.transcriptId ?? items[0]?.id;
    if (!id) {
      const t = await http.get('/transcripts', need('admin').token);
      expect(t.status === 200, `transcripts status ${t.status}`);
      id = t.json?.[0]?.id;
    }
    if (!id) throw new SkipError('no requests exist yet to open a timeline for');
    const r = await http.get(`/requests/${id}`, need('admin').token);
    expect(r.status === 200, `timeline status ${r.status}`);
    shape(r.json, { transcript: 'object', stages: 'array' }, 'timeline');
    expect(r.json.stages.length > 0, 'timeline has no stages');
    shape(r.json.stages[0], { name: 'string', status: 'string' }, 'timeline.stages[0]');
    return `queue=${items.length}, stages=${r.json.stages.length}`;
  });

  // 7. transfers summary
  await check('transfers: GET /transfers/summary shape (admin)', async () => {
    const r = await http.get('/transfers/summary', need('admin').token);
    if (r.status === 503) throw new SkipError('transfer exchange migration 022 not applied');
    expect(r.status === 200, `status ${r.status} ${typeof r.json?.message === 'string' ? r.json.message : r.text.slice(0, 160)}`);
    shape(r.json, { days: 'number', scope: 'object', incoming: 'object', outgoing: 'object', documentRequests: 'object' }, 'summary');
    return `days=${r.json.days}`;
  });

  // 8. AI controls
  await check('ai-controls: GET /ai-controls/readiness shape (super_admin)', async () => {
    const r = await http.get('/ai-controls/readiness', need('super_admin').token);
    expect(r.status === 200, `status ${r.status}`);
    expect(r.json && typeof r.json === 'object', 'expected an object');
    return `keys: ${Object.keys(r.json).slice(0, 6).join(',')}`;
  });
  await check('ai-controls: GET /ai-controls/backtest shape and 0..1 rates (super_admin)', async () => {
    const r = await http.get('/ai-controls/backtest', need('super_admin').token);
    expect(r.status === 200, `status ${r.status}`);
    shape(r.json, { method: 'string', total: 'number', top1Rate: 'number', top3Rate: 'number', byUniversity: 'array' }, 'backtest');
    for (const k of ['top1Rate', 'top3Rate']) expect(r.json[k] >= 0 && r.json[k] <= 1, `${k}=${r.json[k]} outside 0..1`);
    for (const g of r.json.byUniversity) for (const k of ['top1Rate', 'top3Rate']) expect(g[k] >= 0 && g[k] <= 1, `${g.institutionCode}.${k}=${g[k]} outside 0..1`);
    expect(r.json.top3Rate >= r.json.top1Rate, 'top-3 rate cannot be lower than top-1');
    if (r.json.total === 0) ctx.info('backtest has 0 cases (no equivalency decisions yet)');
    return `n=${r.json.total} top1=${r.json.top1Rate} top3=${r.json.top3Rate}`;
  });

  // 9. documents status
  await check('documents: GET /documents/status shape (student)', async () => {
    const r = await http.get('/documents/status', need('student').token);
    expect(r.status === 200, `status ${r.status}`);
    shape(r.json, { aiAvailable: 'boolean', reader: 'string', migrationApplied: 'boolean', docTypes: 'array' }, 'documents status');
    if (!r.json.migrationApplied) ctx.info('migration 020 not applied - /documents endpoints will answer 503');
    return `reader=${r.json.reader}, ai=${r.json.aiAvailable}`;
  });

  // 10. public endpoints
  await check('public: GET /auth/demo-login shape (no auth)', async () => {
    const r = await http.get('/auth/demo-login');
    expect(r.status === 200, `status ${r.status}`);
    shape(r.json, { enabled: 'boolean' }, 'demo-login');
    if (r.json.enabled) {
      expect(Array.isArray(r.json.accounts) && r.json.accounts.length > 0, 'enabled but no accounts');
      ctx.info(`demo login is ENABLED (${r.json.showCredentials ? 'credentials visible' : 'names only'}) - switch it off on a production system`);
    }
    return `enabled=${r.json.enabled}`;
  });
  await check('public: GET /auth/universities returns >= 3 (no auth)', async () => {
    const r = await http.get('/auth/universities');
    expect(r.status === 200, `status ${r.status}`);
    expect(Array.isArray(r.json), 'expected a list');
    expect(r.json.length >= 3, `only ${r.json.length} universities`);
    shape(r.json[0], { id: 'number', code: 'string', name: 'string' }, 'university');
    const codes: string[] = r.json.map((u: any) => u.code);
    const synth = ['BSCC', 'PVTC'].filter((c) => codes.includes(c));
    if (synth.length) ctx.info(`synthetic demo institutions appear in the public list: ${synth.join(', ')} (expected after seed 015; hide/deactivate them for a real launch)`);
    return `${r.json.length} universities`;
  });

  // 11. scope sanity
  await check('scope: unauthenticated GET /requests/queue -> 401', async () => {
    const r = await http.get('/requests/queue');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });
  await check('scope: unauthenticated GET /dashboard -> 401', async () => {
    const r = await http.get('/dashboard');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });
  for (const p of ['/requests/queue', '/transfers/summary', '/ai-controls/readiness', '/email/templates', '/permissions/matrix']) {
    await check(`scope: student GET ${p} -> 403`, async () => {
      const r = await http.get(p, need('student').token);
      expect(r.status === 403, `expected 403, got ${r.status} ${typeof r.json?.message === 'string' ? r.json.message : r.text.slice(0, 160)}`);
    });
  }
  await check('scope: admin GET /permissions/matrix (super_admin only) -> 403', async () => {
    const r = await http.get('/permissions/matrix', need('admin').token);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // 12. email templates
  await check('email: GET /email/templates preview list (super_admin)', async () => {
    const r = await http.get('/email/templates', need('super_admin').token);
    expect(r.status === 200, `status ${r.status}`);
    expect(Array.isArray(r.json) && r.json.length > 0, 'no templates');
    shape(r.json[0], { id: 'number', key: 'string', subject: 'string', html: 'string' }, 'template');
    return `${r.json.length} templates`;
  });

  // 13. mutating (opt in)
  await check('write: create then cancel a document request on a Maya demo request', async () => {
    if (!write) throw new SkipError('read-only run; pass --write to enable');
    const s = need('student');
    const list = await http.get('/transcripts', s.token);
    expect(list.status === 200, `student transcripts status ${list.status}`);
    const demo = (list.json ?? []).find((t: any) => /Bay State|Pioneer Valley/i.test(t.institution?.name ?? ''));
    if (!demo) throw new SkipError('Maya demo requests not found (seed 015 / demo reset needed)');
    const sa = need('super_admin');
    const title = `Smoke test ${new Date().toISOString()} - please ignore`;
    // Asked side = the SOURCE university (synthetic colleges have no staff accounts, so nobody is e-mailed).
    const c = await http.post(`/transfers/${demo.id}/document-requests`, { fromParty: 'source_university', party: 'target_university', title, message: 'Automated smoke test - cancelled immediately.' }, sa.token);
    if (c.status === 503) throw new SkipError('transfer exchange migration 022 not applied');
    expect(c.status === 200 || c.status === 201, `create status ${c.status} ${c.json?.message ?? ''}`);
    const mine = (c.json?.requests ?? []).find((x: any) => x.title === title);
    expect(!!mine, 'created request not found in the exchange response');
    const x = await http.post(`/transfers/${demo.id}/document-requests/${mine.id}/cancel`, { party: 'target_university', note: 'smoke test cleanup' }, sa.token);
    expect(x.status === 200 || x.status === 201, `cancel status ${x.status} ${x.json?.message ?? ''}`);
    const after = (x.json?.requests ?? []).find((y: any) => y.id === mine.id);
    expect(!after || after.status !== 'open', 'request is still open after cancel - clean it up by hand');
    return `request ${mine.id} created and cancelled`;
  });

  finish();
}

function finish() {
  const count = (s: Status) => results.filter((r) => r.status === s).length;
  const fails = results.filter((r) => r.status === 'FAIL');
  console.log('\n' + '='.repeat(60));
  console.log(`PASS ${count('PASS')}   FAIL ${count('FAIL')}   SKIP ${count('SKIP')}   (${results.length} checks)`);
  if (fails.length) { console.log('\nFailures:'); fails.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ base, write, at: new Date().toISOString(), pass: count('PASS'), fail: count('FAIL'), skip: count('SKIP'), results }, null, 2));
    console.log(`\nJSON report: ${jsonPath}`);
  }
  if (verbose) console.log(JSON.stringify(results, null, 2));
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('Smoke runner crashed:', e); process.exit(1); });
