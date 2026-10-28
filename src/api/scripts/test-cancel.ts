import assert from 'node:assert/strict';
import { TranscriptsService } from '../src/transcripts/transcripts.service';

/** Cancel rules against a stubbed database: only the owner, only open requests, snapshot + transaction written. */
function make(row: { Status: string; WorkflowStatus: string | null; StudentUserId: string; SubmittedById: string | null }, hasCol = true) {
  const writes: string[] = [];
  const db: any = {
    query: async (text: string) => {
      if (/FROM Transcripts t JOIN Institutions/.test(text)) return { recordset: [{ ...row, InstitutionName: 'Bay State CC' }] };
      if (/COUNT\(\*\) AS Total,\s+SUM\(CASE WHEN tc\.Status/.test(text)) return { recordset: [{ Total: 5, Decided: 3, Credits: 11 }] };
      if (/FROM TranscriptStages/.test(text)) return { recordset: [{ Total: 5, Done: 2, Active: 'Faculty review' }] };
      return { recordset: [] };
    },
    transaction: async (fn: any) => fn(async (t: string) => { writes.push(t); return { recordset: [], rowsAffected: [1] }; }),
  };
  const schema: any = { has: async () => hasCol };
  const svc = new TranscriptsService(db, {} as any, {} as any, {} as any, {} as any, {} as any, schema, {} as any);
  return { svc, writes };
}

(async () => {
  const open = { Status: 'processing', WorkflowStatus: 'active', StudentUserId: 'AAA', SubmittedById: 'AAA' };
  {
    const { svc, writes } = make(open);
    const r = await svc.cancel('t1', { id: 'aaa', role: 'student' }, { reason: 'Personal reasons' });
    assert.equal(r.status, 'cancelled');
    assert.deepEqual(r.progress, { coursesTotal: 5, coursesDecided: 3, creditsAwarded: 11, stagesCompleted: 2, stagesTotal: 5, stoppedAt: 'Faculty review' });
    assert.ok(writes.some((w) => /SET Status = 'cancelled'/.test(w)));
    assert.ok(writes.some((w) => /TranscriptStages SET Status = 'skipped'/.test(w)));
  }
  await assert.rejects(make(open).svc.cancel('t1', { id: 'bbb', role: 'student' }, { reason: 'x' }), /Only the student/);
  await assert.rejects(make({ ...open, Status: 'complete', WorkflowStatus: 'approved' }).svc.cancel('t1', { id: 'aaa', role: 'student' }, { reason: 'x' }), /already been completed/);
  await assert.rejects(make({ ...open, Status: 'cancelled' }).svc.cancel('t1', { id: 'aaa', role: 'student' }, { reason: 'x' }), /already cancelled/);
  await assert.rejects(make(open, false).svc.cancel('t1', { id: 'aaa', role: 'student' }, { reason: 'x' }), /migration 031/);
  console.log('cancel rules OK');
})();
