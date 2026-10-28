/** Run: npx tsx scripts/test-learning-trend.ts - weekly bucketing, deltas and recurring-mistake ranking (no DB). */
import assert from 'node:assert/strict';
import { buildHeadlines, buildWeeklySeries, countResolvedPatterns, rankRecurringMistakes, weekKey, type DecisionRow } from '../src/ai/learning-trend';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 28, 12); // Wed 2026-10-28
const ago = (days: number) => new Date(now - days * DAY);

// Empty input never throws and yields the requested number of empty weeks.
const empty = buildWeeklySeries({ decisions: [], courses: [], equivalencies: [], usage: [] }, 8, now);
assert.equal(empty.length, 8);
assert.equal(empty[7].weekStart, '2026-10-26');
assert.ok(empty.every((p) => p.agreementRate === null && p.decided === 0 && p.knowledgeBase === 0));
assert.equal(weekKey(Date.UTC(2026, 9, 25, 23)), '2026-10-19'); // Sunday belongs to the previous Monday's week

const d = (daysAgo: number, top: number | null, dec: number | null, conf: number | null, extra: Partial<DecisionRow> = {}): DecisionRow => ({
  decidedAt: ago(daysAgo), aiTopId: top, aiTop3Ids: top == null ? [] : [top, 90, 91], aiConfidence: conf,
  decidedCourseId: dec, outcome: 'equivalent', auto: false, ...extra,
});
const pair = (daysAgo: number): DecisionRow =>
  d(daysAgo, 1, 2, 0.9, { extInstitution: 'NU', extCode: 'CS 1', extLabel: 'Intro', aiCode: 'BU A', aiLabel: 'A', decidedCode: 'BU B', decidedLabel: 'B' });

const decisions: DecisionRow[] = [
  // older block (weeks -7..-4): 1 of 4 agree
  d(40, 1, 1, 0.8), d(41, 1, 2, 0.9), d(42, 1, 3, 0.7), d(43, 1, 4, 0.95),
  // recent block (last 4 weeks): 3 of 4 agree, one in top3 but wrong
  d(2, 5, 5, 0.9, { auto: true }), d(3, 5, 5, 0.6), d(9, 5, 5, 0.95), d(10, 5, 90, 0.5),
  d(4, null, 7, null), // no suggestion: counted as decided only
  { ...d(5, 5, null, 0.9), outcome: 'elective' }, // not scorable
];
const courses = [
  ...Array.from({ length: 10 }, () => ({ createdAt: ago(40), lane: 'pending' })),
  ...Array.from({ length: 10 }, (_, i) => ({ createdAt: ago(2), lane: i < 6 ? 'applied' : 'likely' })),
];
const equivalencies = [{ createdAt: ago(400) }, { createdAt: ago(100) }, { createdAt: ago(40) }, { createdAt: ago(1) }, { createdAt: ago(2) }];
const usage = [
  { createdAt: ago(1), skipReason: 'cache_hit' }, { createdAt: ago(1), skipReason: 'cache_hit' }, { createdAt: ago(2), skipReason: 'equivalency_exists' },
];

const series = buildWeeklySeries({ decisions, courses, equivalencies, usage, autoApplyThreshold: 0.85 }, 12, now);
const cur = series.slice(-4);
assert.equal(cur.reduce((a, p) => a + p.withSuggestion, 0), 4);
assert.equal(cur.reduce((a, p) => a + p.agreed, 0), 3);
assert.equal(cur.reduce((a, p) => a + p.autoApplied, 0), 1);
assert.equal(cur.reduce((a, p) => a + p.top3Hits, 0), 4); // all four decided courses were within the top 3
assert.equal(cur.reduce((a, p) => a + p.cacheHits, 0), 2);
assert.equal(cur.reduce((a, p) => a + p.knownHits, 0), 1);
// knowledge base is cumulative and includes the pre-window row
assert.equal(series[0].knowledgeBase >= 1, true);
assert.equal(series[11].knowledgeBase, 5);
assert.equal(series.reduce((a, p) => a + p.newEquivalencies, 0), 3);

const h = buildHeadlines(series, 4);
assert.equal(h.agreement.value, 75);
assert.equal(h.agreement.previous, 25);
assert.equal(h.agreement.delta, 50);
assert.equal(h.instantShare.value, 60);
assert.equal(h.knowledgeBase.value, 5);
assert.equal(h.knowledgeBase.delta, 2);
// conf >= 0.85 picks: recent 0.9 ok + 0.95 ok => 100 ; previous 0.9 wrong + 0.95 wrong => 0
assert.equal(h.safety.value, 100);
assert.equal(h.safety.previous, 0);
// no data at all: deltas are null, not NaN
const he = buildHeadlines(empty, 4);
assert.equal(he.agreement.delta, null);
assert.equal(he.knowledgeBase.value, 0);

// Recurring mistakes: ranked by count, minimum 2, agreements ignored.
const mistakes = rankRecurringMistakes([
  pair(5), pair(6), pair(7),
  { ...pair(8), extCode: 'CS 2', decidedCode: 'BU C' }, { ...pair(9), extCode: 'CS 2', decidedCode: 'BU C' },
  { ...pair(10), extCode: 'CS 3', decidedCode: 'BU D' }, // only once
  d(3, 1, 1, 0.9, { extInstitution: 'NU', extCode: 'CS 9', aiCode: 'X', decidedCode: 'X' }), // agreement
]);
assert.equal(mistakes.length, 2);
assert.equal(mistakes[0].count, 3);
assert.equal(mistakes[0].decidedCode, 'BU B');
assert.equal(mistakes[1].count, 2);
assert.match(mistakes[0].instructions, /Rank BU B first/);
assert.match(mistakes[0].key, /^ov:NU\|CS 1\|BU B$/);

// A pattern that repeated before the last 30 days and has not recurred counts as resolved.
assert.equal(countResolvedPatterns([pair(60), pair(61), pair(62)], now), 1);
assert.equal(countResolvedPatterns([pair(60), pair(61), pair(2)], now), 0);

console.log('learning trend OK');
