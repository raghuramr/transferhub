// Run: npx tsx scripts/test-progress.ts
import assert from 'node:assert/strict';
import { buildProgress, convertCredits, ProgressCourseRow, ProgressRequestRow } from '../src/progress/progress.aggregate';

const base = (o: Partial<ProgressCourseRow>): ProgressCourseRow => ({
  id: Math.random().toString(36).slice(2), courseCode: 'X 100', courseTitle: 'X', lane: 'pending', status: 'pending',
  originalCredits: 4, normalisedCredits: 4, evalStatus: null, outcome: null, awardedCredits: null,
  aiConfidence: null, aiBuCredits: null, flags: [], ...o,
});
const opts = { cap: 68, examCredits: 6, likelyThreshold: 0.75, hubRequirements: 10, hubCocurricularAllowed: 1, applicantType: 'transfer' };

assert.equal(convertCredits(4, null, 'quarter'), 2.66);
assert.equal(convertCredits(5, null, 'quarter'), 3.33);
assert.equal(convertCredits(4, 3, 'quarter'), 3);
assert.equal(convertCredits(4, null, 'semester'), 4);

const req: ProgressRequestRow = {
  id: 'r1', institutionName: 'NU', calendar: 'quarter', kind: 'official', status: 'processing', receivedAt: null,
  courses: [
    base({ courseCode: 'A', lane: 'applied', normalisedCredits: 3 }),                                           // secure 3
    base({ courseCode: 'B', lane: 'needs_syllabus', outcome: 'equivalent', evalStatus: 'posted', status: 'posted', awardedCredits: 4, decidedBuCode: 'CAS CS 111' }), // secure 4
    base({ courseCode: 'C', lane: 'likely', normalisedCredits: 3, aiConfidence: 0.8, aiBuCredits: 4, aiBuCode: 'CAS CS 330', evalStatus: 'in_progress' }), // likely 3-4
    base({ courseCode: 'D', lane: 'needs_syllabus', normalisedCredits: 3, evalStatus: 'queued' }),             // pending 3, upload syllabus
    base({ courseCode: 'E', lane: 'not_eligible', normalisedCredits: 3, flags: [{ code: 'below_min_grade', severity: 'block', message: 'Grade D is below the minimum of C.' }] }), // not counted 3
    base({ courseCode: 'F', lane: 'pending', normalisedCredits: 3, flags: [{ code: 'over_cap', severity: 'review' }] }), // not counted 3, cap
    base({ courseCode: 'G', lane: 'needs_syllabus', outcome: 'no_credit', evalStatus: 'decided', status: 'decided', normalisedCredits: 2 }), // not counted 2
    base({ courseCode: 'H', lane: 'pending', normalisedCredits: 3, flags: [{ code: 'international', severity: 'info' }] }), // pending 3
    base({ courseCode: 'I', lane: 'needs_syllabus', normalisedCredits: 3, aiConfidence: 0.5, aiBuCredits: 4, hasSyllabus: true }), // pending (below threshold)
  ],
};
const r = buildProgress([req], opts);
assert.deepEqual(r.totals, { secure: 7, likelyLow: 3, likelyHigh: 4, pending: 9, notCounted: 8 });
const by = Object.fromEntries(r.requests[0].courses.map((c) => [c.courseCode, c]));
assert.equal(by.A.bucket, 'secure');
assert.equal(by.C.bucket, 'likely');
assert.equal(by.C.low, 3); assert.equal(by.C.high, 4);
assert.match(by.D.nextStep, /Upload the syllabus for D/);
assert.match(by.F.nextStep, /Over the 68-credit cap/);
assert.match(by.I.nextStep, /Waiting for the department/);
assert.equal(by.G.bucket, 'not_counted');
assert.equal(r.cap.used, 13);            // 7 secure + 6 exam
assert.equal(r.cap.projectedMax, 17);    // + likely high
assert.equal(r.cap.remaining, 55);
assert.match(r.hub.note, /10 Hub requirements/);
assert.equal(r.isProvisional, true);

// preview: nothing is secure
const p = buildProgress([{ ...req, kind: 'preview', courses: [req.courses[0]] }], opts);
assert.equal(p.totals.secure, 0); assert.equal(p.totals.likelyHigh, 3); assert.match(p.requests[0].courses[0].nextStep, /Preview only/);

// empty
const e = buildProgress([], opts);
assert.deepEqual(e.totals, { secure: 0, likelyLow: 0, likelyHigh: 0, pending: 0, notCounted: 0 });
assert.equal(e.isProvisional, false);
console.log('progress aggregation: all checks passed');
