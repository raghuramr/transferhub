import assert from 'node:assert/strict';
import { PurgeService } from '../src/purge/purge.service';

/**
 * Exercises the purge rules against a stubbed database: which rows block, which are deleted, which are detached,
 * and that a blocked delete throws without opening a transaction. (The SQL itself needs a real database.)
 */
type Counts = Record<string, number>;

function make(counts: Counts, opts: { isBU?: boolean; existingTables?: string[] } = {}) {
  const calls: string[] = [];
  let txOpened = false;
  const db: any = {
    query: async (text: string) => {
      calls.push(text);
      if (/SELECT .* AS L/.test(text)) return { recordset: [{ L: 'Pacific Ridge University' }] };
      if (/SELECT IsBU/.test(text)) return { recordset: [{ IsBU: !!opts.isBU }] };
      const m = /SELECT COUNT\(\*\) AS N FROM (\w+) WHERE (.*)/.exec(text);
      if (m) {
        // "Table|marker" keys let a test target one rule; plain "Table" matches any rule on that table.
        const hit = Object.keys(counts).find((k) => { const [t, mk] = k.split('|'); return t === m[1] && (!mk || m[2].includes(mk)); });
        return { recordset: [{ N: hit ? counts[hit] : 0 }] };
      }
      return { recordset: [], rowsAffected: [0] };
    },
    transaction: async (fn: any) => {
      txOpened = true;
      return fn(async () => ({ recordset: [], rowsAffected: [2] }));
    },
  };
  const schema: any = { has: async (t: string) => !opts.existingTables || opts.existingTables.includes(t) };
  return { svc: new PurgeService(db, schema), calls, opened: () => txOpened };
}

(async () => {
  // A clean topic: deletable, nothing blocks.
  {
    const { svc } = make({ CourseTopics: 1 });
    const r = await svc.impact('topics', 1);
    assert.equal(r.canDelete, true);
    assert.equal(r.blockers.length, 0);
  }

  // A course used on a student's transcript is blocked, with a hint.
  {
    const { svc } = make({ TranscriptCourses: 3, Courses: 1 });
    const r = await svc.impact('courses', 5);
    assert.equal(r.canDelete, false);
    assert.ok(r.blockers.some((b) => /transcript/.test(b.label) && b.count === 3 && !!b.hint));
  }

  // Course topics and program links go with the course; AI suggestions are derived data, so they do not block.
  {
    const { svc } = make({ CourseTopics: 4, ProgramCourses: 2, AIMatchCandidates: 6, Courses: 1 });
    const r = await svc.impact('courses', 5);
    assert.equal(r.canDelete, true);
    for (const l of ['topics', 'program links', 'AI match suggestions']) assert.ok(r.willDelete.some((w) => w.label === l), `willDelete has ${l}`);
  }

  // A program detaches (not deletes) its courses and student targets; programme rules block.
  {
    const { svc } = make({ Courses: 5, StudentProfiles: 2, Programs: 1 });
    const r = await svc.impact('programs', 3);
    assert.equal(r.canDelete, true);
    assert.ok(r.willDetach.some((d) => /courses/.test(d.label) && d.count === 5));
    assert.ok(r.willDetach.some((d) => /student profiles/.test(d.label) && d.count === 2));
    const blocked = await make({ ProgramRules: 1 }).svc.impact('programs', 3);
    assert.equal(blocked.canDelete, false);
  }

  // A university that still owns programs/courses needs cascade; with cascade it can go.
  {
    const counts = { 'Programs|InstitutionId': 10, 'Courses|InstitutionId': 50, Institutions: 1 };
    const without = await make(counts).svc.impact('universities', 9, false);
    assert.equal(without.canDelete, false);
    assert.ok(without.blockers.some((b) => /belong to it/.test(b.label) && /cascade|also delete/i.test(b.hint ?? '')));
    const withCascade = await make(counts).svc.impact('universities', 9, true);
    assert.equal(withCascade.canDelete, true);
    assert.ok(withCascade.willDelete.some((w) => w.label === 'courses'));
    assert.ok(withCascade.willDelete.some((w) => w.label === 'programs'));
  }

  // Imported student profiles go with a cascade delete, but a profile already claimed into an account blocks it.
  {
    const counts = { 'Programs|InstitutionId': 10, 'Courses|InstitutionId': 50, 'StudentSourceProfiles|InstitutionCode': 30, Institutions: 1 };
    const without = await make(counts).svc.impact('universities', 9, false);
    assert.ok(without.blockers.some((b) => /30 imported student profile/.test(b.label)));
    const casc = await make(counts).svc.impact('universities', 9, true);
    assert.equal(casc.canDelete, true);
    assert.ok(casc.willDelete.some((w) => /imported student profiles/.test(w.label) && w.count === 30));
    const claimed = await make({ ...counts, 'IntakeSessions|ClaimedUserId IS NOT NULL': 2 }).svc.impact('universities', 9, true);
    assert.equal(claimed.canDelete, false);
    assert.ok(claimed.blockers.some((b) => /student accounts created/.test(b.label) && b.count === 2));
  }

  // Real history blocks even with cascade; the BU home university can never be deleted.
  {
    const hist = await make({ Transcripts: 4 }).svc.impact('universities', 9, true);
    assert.equal(hist.canDelete, false);
    assert.ok(hist.blockers.some((b) => /transcript requests/.test(b.label)));
    const bu = await make({}, { isBU: true }).svc.impact('universities', 1, true);
    assert.equal(bu.canDelete, false);
    assert.ok(bu.blockers.some((b) => /home \(BU\)/.test(b.label)));
  }

  // Tables from unapplied migrations are skipped instead of throwing.
  {
    const { svc } = make({ ProgramRules: 9 }, { existingTables: ['Programs', 'Courses'] });
    const r = await svc.impact('programs', 3);
    assert.equal(r.canDelete, true);
  }

  // A blocked delete throws a 409 and never opens a transaction.
  {
    const m = make({ TranscriptCourses: 1 });
    await assert.rejects(() => m.svc.remove('courses', 5, false, { id: 'u', email: 'a@b.c', role: 'super_admin' }), /Cannot delete/);
    assert.equal(m.opened(), false);
  }

  // An allowed delete runs inside one transaction and reports what it removed.
  {
    const m = make({ CourseTopics: 2 });
    const out = await m.svc.remove('topics', 1, false, { id: 'u', email: 'a@b.c', role: 'super_admin' });
    assert.equal(out.ok, true);
    assert.equal(m.opened(), true);
    assert.ok(out.deleted.some((d) => d.label === 'topics'));
  }

  console.log('purge rules OK');
})().catch((e) => { console.error(e); process.exit(1); });
