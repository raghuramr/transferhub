// Run: npx tsx scripts/test-credit-deadline.ts
import assert from 'node:assert/strict';
import { buildProgress } from '../src/progress/progress.aggregate';
import { addMonths, computeCreditDeadline, thresholdFor } from '../src/policy/credit-deadline';

const at = (s: string) => new Date(`${s}T12:00:00Z`);
const c = (o: Parameters<typeof computeCreditDeadline>[0]) => computeCreditDeadline({ months: 12, ...o });

// Term defaults
let r = c({ entryTerm: 'fall', entryYear: 2025, now: at('2025-10-01') });
assert.equal(r.startsOn, '2025-09-01'); assert.equal(r.deadlineOn, '2026-09-01'); assert.equal(r.state, 'on_track'); assert.equal(r.basis, 'entry_term');
r = c({ entryTerm: 'Spring', entryYear: 2026, now: at('2026-02-01') });
assert.equal(r.startsOn, '2026-01-15'); assert.equal(r.deadlineOn, '2027-01-15');
r = c({ entryTerm: 'summer', entryYear: 2026, now: at('2026-06-01') });
assert.equal(r.startsOn, '2026-05-25'); assert.equal(r.deadlineOn, '2027-05-25');

// Not started yet
r = c({ entryTerm: 'fall', entryYear: 2027, now: at('2026-10-27') });
assert.equal(r.state, 'not_started'); assert.ok(r.daysLeft! > 365);

// Boundaries: 90 / 30 days, the deadline day itself, the day after
r = c({ entryTerm: 'fall', entryYear: 2025, now: at('2026-06-03') }); // deadline 2026-09-01 -> 90 days
assert.equal(r.daysLeft, 90); assert.equal(r.state, 'due_soon');
r = c({ entryTerm: 'fall', entryYear: 2025, now: at('2026-06-02') }); assert.equal(r.daysLeft, 91); assert.equal(r.state, 'on_track');
r = c({ entryTerm: 'fall', entryYear: 2025, now: at('2026-08-02') }); assert.equal(r.daysLeft, 30); assert.equal(r.state, 'urgent');
r = c({ entryTerm: 'fall', entryYear: 2025, now: at('2026-09-01') }); assert.equal(r.daysLeft, 0); assert.equal(r.state, 'urgent');
r = c({ entryTerm: 'fall', entryYear: 2025, now: at('2026-09-02') }); assert.equal(r.daysLeft, -1); assert.equal(r.state, 'overdue');
// time of day does not matter
assert.equal(c({ entryTerm: 'fall', entryYear: 2025, now: new Date('2026-09-01T23:59:59Z') }).daysLeft, 0);

// Leap days: explicit start on 29 Feb clamps to 28 Feb a year later; 12 months across a leap year is still a calendar year
r = c({ startDate: '2024-02-29', now: at('2024-03-01') }); assert.equal(r.deadlineOn, '2025-02-28'); assert.equal(r.basis, 'start_date');
r = c({ startDate: '2023-03-01', now: at('2024-03-01') }); assert.equal(r.deadlineOn, '2024-03-01'); assert.equal(r.daysLeft, 0);
r = c({ entryTerm: 'spring', entryYear: 2024, now: at('2025-01-14') }); assert.equal(r.daysLeft, 1); // Jan 15 2024 -> Jan 15 2025
assert.equal(addMonths(new Date(Date.UTC(2025, 7, 31)), 6).toISOString().slice(0, 10), '2026-02-28');
assert.equal(addMonths(new Date(Date.UTC(2027, 7, 31)), 6).toISOString().slice(0, 10), '2028-02-29');

// Explicit start date wins over the term
r = c({ entryTerm: 'fall', entryYear: 2025, startDate: new Date('2025-09-08T00:00:00Z'), now: at('2025-10-01') });
assert.equal(r.startsOn, '2025-09-08'); assert.equal(r.deadlineOn, '2026-09-08');

// Configurable months
r = computeCreditDeadline({ entryTerm: 'fall', entryYear: 2025, months: 18, now: at('2025-10-01') }); assert.equal(r.deadlineOn, '2027-03-01'); assert.equal(r.months, 18);
r = computeCreditDeadline({ entryTerm: 'fall', entryYear: 2025, months: 0, now: at('2025-10-01') }); assert.equal(r.months, 12, 'invalid months fall back to 12');

// Unknown entry
r = c({ now: at('2026-01-01') }); assert.equal(r.state, 'unknown'); assert.equal(r.deadlineOn, null); assert.equal(r.daysLeft, null); assert.equal(r.basis, 'none');
r = c({ entryTerm: 'winter', entryYear: 2025, now: at('2026-01-01') }); assert.equal(r.state, 'unknown');
r = c({ entryTerm: 'fall', entryYear: null, now: at('2026-01-01') }); assert.equal(r.state, 'unknown');
// ... estimate from the first request only when no entry info
r = c({ firstRequestAt: '2025-12-01T10:00:00Z', now: at('2026-01-01') });
assert.equal(r.basis, 'estimate'); assert.equal(r.isEstimate, true); assert.equal(r.deadlineOn, '2026-12-01'); assert.equal(r.state, 'on_track');
r = c({ entryTerm: 'fall', entryYear: 2025, firstRequestAt: '2020-01-01', now: at('2025-10-01') }); assert.equal(r.basis, 'entry_term', 'entry term beats the estimate');

// Reminder thresholds
assert.equal(thresholdFor(null), null);
assert.equal(thresholdFor(200), null); assert.equal(thresholdFor(91), null);
assert.equal(thresholdFor(90), '90'); assert.equal(thresholdFor(31), '90');
assert.equal(thresholdFor(30), '30'); assert.equal(thresholdFor(8), '30');
assert.equal(thresholdFor(7), '7'); assert.equal(thresholdFor(0), '7');
assert.equal(thresholdFor(-1), 'overdue');

// Progress aggregate: pending count excludes previews and outside-US courses
const mk = (id: string, o: object) => ({ id, courseCode: id, courseTitle: id, lane: 'pending', status: 'pending', originalCredits: 3, normalisedCredits: 3, evalStatus: null, outcome: null, awardedCredits: null, aiConfidence: null, aiBuCredits: null, flags: [], ...o });
const pr = buildProgress([
  { id: 'a', institutionName: 'X', calendar: 'semester', kind: 'official', status: 'p', receivedAt: null, courses: [mk('c1', {}), mk('c2', { isOutsideUS: true }), mk('c3', { lane: 'applied' })] },
  { id: 'b', institutionName: 'Y', calendar: 'semester', kind: 'preview', status: 'p', receivedAt: null, courses: [mk('c4', {})] },
], { cap: 68, examCredits: 0, likelyThreshold: 0.75, hubRequirements: 10, hubCocurricularAllowed: 1, deadline: c({ entryTerm: 'fall', entryYear: 2025, now: at('2026-09-02') }) });
assert.equal(pr.deadline?.pendingCourses, 1); assert.equal(pr.deadline?.state, 'overdue');
assert.equal(buildProgress([], { cap: 68, examCredits: 0, likelyThreshold: 0.75, hubRequirements: 10, hubCocurricularAllowed: 1 }).deadline, null);

console.log('credit-deadline: all assertions passed');
