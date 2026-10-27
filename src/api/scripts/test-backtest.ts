/** Run: npx tsx scripts/test-backtest.ts  - checks the hold-out backtest scoring on a tiny in-memory catalogue. */
import assert from 'node:assert/strict';
import { runBacktest, BacktestCase, Matcher } from '../src/ai/backtest-scoring';
import { CatalogCourse } from '../src/ai/course-prefilter';

const bu = (id: number, code: string, title: string, description: string, topics: string[]): CatalogCourse => ({
  id, code, title, credits: 4, programArea: null, description, topics,
});

const BU_ID = 1;
const catalog: CatalogCourse[] = [
  bu(1, 'CAS CS 111', 'Introduction to Computer Science 1', 'Programming with variables, loops, functions and recursion in Python.', ['Variables and functions', 'Recursion']),
  bu(2, 'CAS CS 112', 'Introduction to Computer Science 2', 'Data structures: stacks, queues, linked lists, trees, hash tables, sorting and searching.', ['Linked lists', 'Trees', 'Sorting']),
  bu(3, 'CAS MA 123', 'Calculus I', 'Limits, derivatives and an introduction to integrals.', ['Limits', 'Derivatives']),
  bu(4, 'CAS MA 242', 'Linear Algebra', 'Matrices, vector spaces, eigenvalues and eigenvectors.', ['Matrices', 'Eigenvalues']),
  bu(5, 'CAS EC 101', 'Introductory Microeconomic Analysis', 'Supply and demand, consumer choice and market structures.', ['Supply and demand']),
];

const mk = (id: number, code: string, title: string, text: string, expected: number[]): BacktestCase => ({
  externalCourseId: id,
  externalLabel: `EXT ${code} - ${title}`,
  facts: { code, title, credits: 4, text },
  targetInstitutionId: BU_ID,
  targetCode: 'BU',
  targetName: 'Boston University',
  expectedCourseIds: expected,
});

const cases: BacktestCase[] = [
  mk(10, 'CSC 110', 'Intro to Programming', 'variables loops functions recursion python', [1]), // clear top-1
  mk(11, 'CSC 220', 'Data Structures', 'stacks queues linked lists trees hash tables', [2]), // clear top-1
  mk(12, 'MAT 210', 'Calculus I', 'limits derivatives integrals', [3]), // clear top-1
  mk(13, 'MTH 330', 'Matrix Methods', 'matrices eigenvalues vector spaces', [4, 1]), // two true answers; one in top-3
  mk(14, 'ART 101', 'Drawing Studio', 'charcoal perspective composition', [5]), // deliberate miss
];

const r = runBacktest(cases, new Map([[BU_ID, catalog]]));
console.log(JSON.stringify(r, null, 2));

assert.equal(r.method, 'built-in rules');
assert.equal(r.total, 5);
assert.equal(r.top1, 4, 'four clear top-1 hits (case 13 hits via MA 242)');
assert.equal(r.top3, 4);
assert.equal(r.top1Rate, 0.8);
assert.equal(r.top3Rate, 0.8);
assert.equal(r.misses.length, 1);
assert.match(r.misses[0].external, /ART 101/);
assert.equal(r.misses[0].expected, 'CAS EC 101');
assert.equal(r.byUniversity.length, 1);
assert.equal(r.byUniversity[0].total, 5);

// A case whose target university has no catalogue (or no true answer) is skipped, not counted.
const skipped = runBacktest([{ ...cases[0], targetInstitutionId: 99 }, { ...cases[1], expectedCourseIds: [] }], new Map([[BU_ID, catalog]]));
assert.equal(skipped.total, 0);
assert.equal(skipped.top3Rate, 0);

// top-3 but not top-1: a matcher that always puts the right answer second.
const second: Matcher = (_f, cat, c) => {
  const right = cat.find((x) => x.id === c.expectedCourseIds[0])!;
  const other = cat.find((x) => x.id !== right.id)!;
  return [other, right].map((x) => ({ courseId: x.id, code: x.code, title: x.title }));
};
const s = runBacktest(cases.slice(0, 3), new Map([[BU_ID, catalog]]), second, 'stub');
assert.equal(s.method, 'stub');
assert.equal(s.top1, 0);
assert.equal(s.top3, 3);

// Hold-out is per target university: groups are reported separately and misses are capped.
const NU_ID = 2;
const nuCatalog = [bu(20, 'NU CS 2000', 'Fundamentals of Computer Science', 'programming functions recursion', ['Functions'])];
const multi = runBacktest(
  [cases[0], { ...mk(30, 'X 1', 'Zzz', 'qqq', [20]), targetInstitutionId: NU_ID, targetCode: 'NU', targetName: 'Northeastern' }],
  new Map([[BU_ID, catalog], [NU_ID, nuCatalog]]),
  undefined, undefined, 1,
);
assert.equal(multi.byUniversity.length, 2);
assert.equal(multi.misses.length, 1);

console.log('backtest scoring ok');
