/**
 * University scope for FACULTY (and any other scoped staff role), against a stubbed database.
 *
 * What is checked:
 *  - a faculty member with UserScopeUniversities rows sees only requests coming INTO one of those
 *    universities or going OUT of one, and nothing else;
 *  - a faculty member with no scope rows stays unrestricted (the documented default);
 *  - a super admin is never narrowed;
 *  - a scoped faculty member may NOT decide an outgoing request (read / documents / reminders only);
 *  - the same rules reach the real call sites: RequestsService.assertCanView / assertCanWork and
 *    TranscriptsService.findAll.
 */
import assert from 'node:assert/strict';
import { ScopeService, isScopedStaffRole } from '../src/policy/scope.service';
import { RequestsService } from '../src/requests/requests.service';
import { TranscriptsService } from '../src/transcripts/transcripts.service';
import { EvaluationsService } from '../src/evaluations/evaluations.service';

type T = { id: string; source: number; target: number | null; profileTarget: number | null; student: string; submitter: string };

/** BU = 1 (receiving), Bay State CC = 2 (sending), Northeastern = 3 (unrelated). */
const TRANSCRIPTS: T[] = [
  { id: 'in-1', source: 2, target: 1, profileTarget: 1, student: 'stu-1', submitter: 'stu-1' }, // incoming at BU
  { id: 'out-1', source: 1, target: 3, profileTarget: 3, student: 'stu-2', submitter: 'stu-2' }, // outgoing from BU
  { id: 'other', source: 2, target: 3, profileTarget: 3, student: 'stu-3', submitter: 'stu-3' }, // nothing to do with BU
];

/** Scope rows per user id. */
const SCOPE: Record<string, number[]> = { 'fac-bu': [1], 'adm-bu': [1], 'fac-open': [] };

/** Which request each evaluation in the faculty queue belongs to. */
const EVALUATIONS: Record<string, string> = { 'ev-in': 'in-1', 'ev-out': 'out-1', 'ev-other': 'other' };

/**
 * Enough of DatabaseService to answer what ScopeService asks. The COUNT query is answered by reading
 * the bound parameters ScopeService produced (sc* = target ids, so* = source ids) and the predicate
 * text, so the real SQL building is exercised rather than re-implemented.
 */
function makeDb(calls: string[] = []) {
  return {
    calls,
    query: async (text: string, inputs: { name: string; value: unknown }[] = []) => {
      calls.push(text);
      if (/FROM UserScopeUniversities/.test(text)) {
        const uid = String(inputs.find((i) => i.name === 'uid')?.value ?? '');
        return { recordset: (SCOPE[uid] ?? []).map((InstitutionId) => ({ InstitutionId })) };
      }
      if (/COUNT\(\*\) AS N FROM Transcripts t/.test(text)) {
        const tid = String(inputs.find((i) => i.name === 'tid')?.value ?? '');
        const t = TRANSCRIPTS.find((x) => x.id === tid);
        if (!t) return { recordset: [{ N: 0 }] };
        const targets = inputs.filter((i) => /^sc\d+$/.test(i.name)).map((i) => Number(i.value));
        const sources = inputs.filter((i) => /^so\d+$/.test(i.name)).map((i) => Number(i.value));
        const incoming = (t.target != null && targets.includes(t.target)) || (t.profileTarget != null && targets.includes(t.profileTarget));
        const outgoing = /t\.InstitutionId IN \(/.test(text) && sources.includes(t.source);
        return { recordset: [{ N: incoming || outgoing ? 1 : 0 }] };
      }
      // the faculty evaluation queue
      if (/SELECT Id FROM Evaluations WHERE Id = @id/.test(text)) return { recordset: [{ Id: inputs.find((i) => i.name === 'id')?.value }] };
      if (/SELECT tc\.TranscriptId FROM Evaluations e/.test(text)) {
        const evalId = String(inputs.find((i) => i.name === 'id')?.value ?? '');
        return { recordset: [{ TranscriptId: EVALUATIONS[evalId] ?? null }] };
      }
      if (/SELECT StudentUserId, SubmittedById FROM Transcripts WHERE Id = @t/.test(text)) {
        const tid = String(inputs.find((i) => i.name === 't')?.value ?? '');
        const t = TRANSCRIPTS.find((x) => x.id === tid);
        return { recordset: t ? [{ StudentUserId: t.student, SubmittedById: t.submitter }] : [] };
      }
      return { recordset: [] };
    },
  } as any;
}

const scopeOf = (db: any) => new ScopeService(db);
const view = (id: string, role: string) => ({ id, role });

(async () => {
  // ── which roles the assignment narrows ────────────────────────────────────
  assert.ok(isScopedStaffRole('faculty'), 'faculty must be narrowed by UserScopeUniversities');
  assert.ok(isScopedStaffRole('admin'));
  assert.ok(!isScopedStaffRole('super_admin'), 'super admins are never narrowed');
  assert.ok(!isScopedStaffRole('student'));
  assert.ok(!isScopedStaffRole('agency'));

  {
    const s = scopeOf(makeDb());
    assert.deepEqual(await s.universityScope(view('fac-bu', 'faculty')), [1], 'scoped faculty -> their universities');
    assert.equal(await s.universityScope(view('fac-open', 'faculty')), null, 'faculty with no scope rows stays unrestricted');
    assert.equal(await s.universityScope(view('fac-bu', 'super_admin')), null, 'super admin never narrowed');
    assert.equal(await s.universityScope(view('stu-1', 'student')), null, 'students keep their own ownership checks');
    // staffUniversityScope (the exchange) and universityScope must now agree.
    assert.deepEqual(await s.staffUniversityScope(view('fac-bu', 'faculty')), [1]);
  }

  // ── reading: incoming + outgoing only ─────────────────────────────────────
  {
    const s = scopeOf(makeDb());
    assert.ok(await s.canViewTranscript(view('fac-bu', 'faculty'), 'in-1'), 'scoped faculty sees an incoming request');
    assert.ok(await s.canViewTranscript(view('fac-bu', 'faculty'), 'out-1'), 'scoped faculty sees an outgoing request');
    assert.ok(!(await s.canViewTranscript(view('fac-bu', 'faculty'), 'other')), 'scoped faculty must NOT see another university’s request');

    assert.ok(await s.canViewTranscript(view('fac-open', 'faculty'), 'other'), 'unscoped faculty sees everything');
    assert.ok(await s.canViewTranscript(view('fac-bu', 'super_admin'), 'other'), 'super admin sees everything');
    assert.ok(await s.canViewTranscript(view('stu-1', 'student'), 'other'), 'students are filtered by ownership elsewhere, not here');
  }

  // ── deciding: incoming only ───────────────────────────────────────────────
  {
    const s = scopeOf(makeDb());
    assert.ok(await s.canWorkRequest(view('fac-bu', 'faculty'), 'in-1'), 'scoped faculty may decide an incoming request');
    assert.ok(!(await s.canWorkRequest(view('fac-bu', 'faculty'), 'out-1')), 'scoped faculty must NOT decide an outgoing request');
    assert.ok(!(await s.canWorkRequest(view('fac-bu', 'faculty'), 'other')));
    assert.ok(await s.canWorkRequest(view('fac-open', 'faculty'), 'out-1'), 'unscoped faculty keeps today’s behaviour');
    assert.ok(await s.canWorkRequest(view('fac-bu', 'super_admin'), 'out-1'), 'super admin is never blocked');
    // the parties a scoped faculty may speak for on the exchange
    assert.deepEqual(await s.partiesFor(view('fac-bu', 'faculty'), { studentUserId: 'stu-2', submittedById: 'stu-2', sourceId: 1, targetId: 3 }), ['source_university']);
  }

  // ── the predicate itself ──────────────────────────────────────────────────
  {
    const s = scopeOf(makeDb());
    const inputs: any[] = [];
    const sqlText = s.transcriptVisibleInScope([1], 't', inputs);
    assert.ok(/t\.TargetInstitutionId IN/.test(sqlText), 'incoming side present');
    assert.ok(/t\.InstitutionId IN/.test(sqlText), 'outgoing side present');
    assert.equal(inputs.length, 2, 'one parameter per id per clause: sc0 (incoming, re-used for the profile) + so0 (outgoing)');
  }

  // ── call site: RequestsService.assertCanView / assertCanWork ──────────────
  {
    const mk = () => {
      const db = makeDb();
      const svc = new RequestsService(db, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, scopeOf(db), {} as any);
      return svc;
    };
    const fac = { id: 'fac-bu', role: 'faculty', email: 'f@bu.edu' } as any;
    await mk().assertCanView('in-1', fac);
    await mk().assertCanView('out-1', fac);
    await assert.rejects(mk().assertCanView('other', fac), /outside your assignment/, 'faculty blocked on another university’s request');
    await mk().assertCanWork('in-1', fac);
    await assert.rejects(mk().assertCanWork('out-1', fac), /not approve it/, 'faculty cannot decide an outgoing request');

    const open = { id: 'fac-open', role: 'faculty', email: 'o@bu.edu' } as any;
    await mk().assertCanView('other', open);
    await mk().assertCanWork('other', open);
    const sa = { id: 'fac-bu', role: 'super_admin', email: 's@bu.edu' } as any;
    await mk().assertCanWork('other', sa);
  }

  // ── call site: TranscriptsService.findAll ─────────────────────────────────
  {
    const run = async (requestingUserId: string, requestingRole: string) => {
      const calls: string[] = [];
      const db = makeDb(calls);
      const schema = { has: async () => false } as any;
      const svc = new TranscriptsService(db, {} as any, {} as any, scopeOf(db), {} as any, {} as any, schema, {} as any);
      await svc.findAll({ requestingUserId, requestingRole });
      return calls.find((c) => /FROM Transcripts t\s+JOIN Institutions/.test(c)) ?? '';
    };
    const scoped = await run('fac-bu', 'faculty');
    assert.ok(/TargetInstitutionId IN/.test(scoped) && /t\.InstitutionId IN \(@so0\)/.test(scoped),
      'a scoped faculty list is limited to incoming + outgoing');
    const unscoped = await run('fac-open', 'faculty');
    assert.ok(!/TargetInstitutionId IN/.test(unscoped), 'faculty with no scope rows list everything');
    const sa = await run('fac-bu', 'super_admin');
    assert.ok(!/TargetInstitutionId IN/.test(sa) && !/t\.InstitutionId IN/.test(sa), 'super admins are never narrowed');
  }

  // ── call site: the faculty evaluation queue ──────────────────────────────
  {
    const mk = (calls: string[] = []) => {
      const db = makeDb(calls);
      return new EvaluationsService(db, {} as any, scopeOf(db));
    };
    const calls: string[] = [];
    await mk(calls).list({ viewer: view('fac-bu', 'faculty') });
    const q = calls.find((c) => /FROM Evaluations e/.test(c) && /JOIN Institutions/.test(c)) ?? '';
    assert.ok(/TargetInstitutionId IN/.test(q) && /t\.InstitutionId IN/.test(q), 'the evaluation queue is limited to a scoped faculty’s universities');

    const open: string[] = [];
    await mk(open).list({ viewer: view('fac-open', 'faculty') });
    assert.ok(!/TargetInstitutionId IN/.test(open.find((c) => /FROM Evaluations e/.test(c) && /JOIN Institutions/.test(c)) ?? ''), 'unscoped faculty queue everything');

    await assert.rejects(mk().findById('ev-other', view('fac-bu', 'faculty')), /outside your assignment/);
    await assert.rejects(mk().decide('ev-out', {} as any, 'fac-bu', view('fac-bu', 'faculty')), /decided at another university/,
      'a scoped faculty cannot decide a course of an OUTGOING request');
  }

  console.log('faculty university scope OK');
})();
