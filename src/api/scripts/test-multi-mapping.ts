// Run: npx tsx scripts/test-multi-mapping.ts
import assert from 'node:assert/strict';
import { buildProgress, ProgressCourseRow } from '../src/progress/progress.aggregate';
import { asOfFromTerm, combineShares, inWindow, splitCredits, validateMultiDecision } from '../src/policy/multi-mapping';

const sum = (a: { awardedCredits: number }[]) => Math.round(a.reduce((s, x) => s + x.awardedCredits, 0) * 100) / 100;

// NU CHEM 1161 (5 credits) -> CH 101 (4) + CH 102 (4): catalogue credits do not fit, so they are scaled down; never more than 5.
{
  const out = splitCredits(5, [{ buCourseId: 1, catalogCredits: 4 }, { buCourseId: 2, catalogCredits: 4 }]);
  assert.deepEqual(out.map((x) => x.awardedCredits), [2.5, 2.5]);
  assert.ok(sum(out) <= 5);
  assert.deepEqual(out.map((x) => x.sortOrder), [0, 1]);
}
// When the catalogue credits fit inside the converted credits, they are used as they are.
{
  const out = splitCredits(8, [{ buCourseId: 1, catalogCredits: 4 }, { buCourseId: 2, catalogCredits: 4 }]);
  assert.deepEqual(out.map((x) => x.awardedCredits), [4, 4]);
  const out2 = splitCredits(10, [{ buCourseId: 1, catalogCredits: 4 }, { buCourseId: 2, catalogCredits: 4 }]);
  assert.equal(sum(out2), 8, 'never invents credit beyond the catalogue values');
}
// Uneven catalogue values scale proportionally; rounding never exceeds the total.
{
  const out = splitCredits(5, [{ buCourseId: 1, catalogCredits: 4 }, { buCourseId: 2, catalogCredits: 2 }, { buCourseId: 3, catalogCredits: 2 }]);
  assert.ok(sum(out) <= 5);
  assert.equal(sum(out), 5);
  assert.ok(out[0].awardedCredits > out[1].awardedCredits);
  const thirds = splitCredits(1, [{ buCourseId: 1 }, { buCourseId: 2 }, { buCourseId: 3 }]);
  assert.ok(sum(thirds) <= 1 && sum(thirds) >= 0.99);
}
// Credits stated explicitly win, even above the converted total ("unless the data says otherwise").
{
  const out = splitCredits(4, [{ buCourseId: 1, credits: 4 }, { buCourseId: 2, credits: 4 }]);
  assert.deepEqual(out.map((x) => x.awardedCredits), [4, 4]);
  // mixed: the unstated course gets what is left
  const mixed = splitCredits(5, [{ buCourseId: 1, credits: 3, catalogCredits: 4 }, { buCourseId: 2, catalogCredits: 4 }]);
  assert.deepEqual(mixed.map((x) => x.awardedCredits), [3, 2]);
  const exhausted = splitCredits(3, [{ buCourseId: 1, credits: 3 }, { buCourseId: 2, catalogCredits: 4 }]);
  assert.equal(exhausted[1].awardedCredits, 0);
}
// A single course is just the single-course path.
assert.deepEqual(splitCredits(4, [{ buCourseId: 7, catalogCredits: 4 }]).map((x) => x.awardedCredits), [4]);
assert.deepEqual(splitCredits(3.33, [{ buCourseId: 7, catalogCredits: 4 }]).map((x) => x.awardedCredits), [3.33]);

// Many-to-one: NU CS 2100 (5) + CS 2700 (5) -> CS 112 (4): awarded once, shared by converted credits.
{
  const m = combineShares(4, [{ courseId: 'a', convertedCredits: 5 }, { courseId: 'b', convertedCredits: 5 }]);
  assert.equal(m.get('a'), 2);
  assert.equal(m.get('b'), 2);
  const uneven = combineShares(4, [{ courseId: 'a', convertedCredits: 3 }, { courseId: 'b', convertedCredits: 1 }]);
  assert.equal(Math.round(((uneven.get('a') ?? 0) + (uneven.get('b') ?? 0)) * 100) / 100, 4);
  // members bring less than the BU course is worth: never more than they brought
  const small = combineShares(4, [{ courseId: 'a', convertedCredits: 1 }, { courseId: 'b', convertedCredits: 1 }]);
  assert.equal((small.get('a') ?? 0) + (small.get('b') ?? 0), 2);
  assert.equal(combineShares(4, []).size, 0);
}

// Effective-date window and term parsing mirror sp_TriageCourse.
{
  assert.equal(asOfFromTerm('Fall 2021', '2026-10-27'), '2021-09-01');
  assert.equal(asOfFromTerm('Summer 2019', '2026-10-27'), '2019-06-01');
  assert.equal(asOfFromTerm('Spring 2020', '2026-10-27'), '2020-01-01');
  assert.equal(asOfFromTerm('no year', '2026-10-27'), '2026-10-27');
  assert.equal(asOfFromTerm('Fall 1800', '2026-10-27'), '2026-10-27');
  assert.equal(inWindow({}, '2021-09-01'), true);
  assert.equal(inWindow({ EffectiveFrom: '2022-01-01' }, '2021-09-01'), false);
  assert.equal(inWindow({ EffectiveTo: new Date('2021-08-31T00:00:00Z') }, '2021-09-01'), false);
  assert.equal(inWindow({ EffectiveFrom: '2021-01-01', EffectiveTo: '2021-12-31' }, '2021-09-01'), true);
}

// Decision validation.
{
  assert.deepEqual(validateMultiDecision('equivalent', [{ buCourseId: 1 }, { buCourseId: 2, awardedCredits: 4 }]), []);
  assert.equal(validateMultiDecision('no_credit', [{ buCourseId: 1 }, { buCourseId: 2 }]).length, 1);
  assert.equal(validateMultiDecision('no_credit', [{ buCourseId: 1 }]).length, 0);
  assert.equal(validateMultiDecision('elective', [{ buCourseId: 1 }, { buCourseId: 1 }]).length, 1);
  assert.equal(validateMultiDecision('equivalent', [{ buCourseId: 1, awardedCredits: -1 }]).length, 1);
}

// Progress view: a course counting as two BU courses shows both and counts the mapped credits.
{
  const row = (o: Partial<ProgressCourseRow>): ProgressCourseRow => ({
    id: 'c1', courseCode: 'CHEM 1161', courseTitle: 'General Chemistry', lane: 'applied', status: 'pending', originalCredits: 5, normalisedCredits: 5,
    evalStatus: null, outcome: null, awardedCredits: null, aiConfidence: null, aiBuCredits: null, flags: [], ...o,
  });
  const opts = { cap: 68, examCredits: 0, likelyThreshold: 0.75, hubRequirements: 10, hubCocurricularAllowed: 1 };
  const mk = (c: ProgressCourseRow) => buildProgress([{ id: 'r', institutionName: 'NU', calendar: 'semester', kind: 'official', status: 'processing', receivedAt: null, courses: [c] }], opts);
  const applied = mk(row({ mappings: [{ code: 'CAS CH 101', credits: 2.5 }, { code: 'CAS CH 102', credits: 2.5 }] }));
  assert.equal(applied.totals.secure, 5);
  assert.equal(applied.requests[0].courses[0].mappings.length, 2);
  assert.match(applied.requests[0].courses[0].nextStep, /CAS CH 101 \+ CAS CH 102/);
  const decided = mk(row({ lane: 'needs_syllabus', outcome: 'equivalent', evalStatus: 'posted', status: 'posted', awardedCredits: 8, decidedBuCode: 'CAS CH 101',
    mappings: [{ code: 'CAS CH 101', credits: 4 }, { code: 'CAS CH 102', credits: 4 }] }));
  assert.equal(decided.totals.secure, 8);
  assert.equal(decided.requests[0].courses[0].buCourse, 'CAS CH 101 + CAS CH 102');
  // no mappings: unchanged single-course behaviour
  const single = mk(row({}));
  assert.equal(single.totals.secure, 5);
  assert.deepEqual(single.requests[0].courses[0].mappings, []);
}

console.log('multi mapping: all checks passed');
