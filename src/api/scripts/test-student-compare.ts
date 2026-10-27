// Run: npx tsx scripts/test-student-compare.ts
import assert from 'node:assert/strict';
import { compareUniversity, applyCap, StudentCourseInput, UniversityInput } from '../src/student-journey/compare.logic';
import { convertCredits } from '../src/progress/progress.aggregate';

const cat = (id: number, code: string, title: string, credits: number, description = '', topics: string[] = []) => ({
  id, code, title, credits, programArea: null, description, topics,
});
const sc = (id: string, code: string, title: string, orig: number, o: Partial<StudentCourseInput> = {}): StudentCourseInput => ({
  id, code, title, term: 'Fall 2024', grade: 'A', originalCredits: orig, convertedCredits: orig, externalCourseId: null, text: '', ...o,
});

const uni: UniversityInput = {
  id: 1, code: 'BU', name: 'Boston University', cap: 68,
  catalogue: [
    cat(10, 'CS 111', 'Introduction to Computer Science', 4, 'programming algorithms data structures', ['recursion', 'sorting']),
    cat(11, 'CS 112', 'Data Structures', 4, 'trees graphs hashing'),
    cat(12, 'MA 123', 'Calculus I', 4, 'limits derivatives integrals'),
    cat(13, 'EC 101', 'Principles of Microeconomics', 4, 'supply demand markets'),
    cat(14, 'HI 100', 'World History', 4, 'ancient medieval modern'),
  ],
  programs: [
    { id: 100, name: 'BS Computer Science', area: 'Computer Science', degree: 'BS', school: null, courseIds: [10, 11, 12] },
    { id: 101, name: 'BA Economics', area: 'Economics', degree: 'BA', school: null, courseIds: [13] },
    { id: 102, name: 'BA Philosophy', area: 'Philosophy', degree: 'BA', school: null, courseIds: [] },
  ],
  equivalencies: [{ externalCourseId: 900, courseId: 12, outcome: 'equivalent', credits: null }, { externalCourseId: 901, courseId: 14, outcome: 'elective', credits: 3 }],
};

// quarter conversion happens before the comparison
const q = convertCredits(5, null, 'quarter');
assert.equal(q, 3.33);

const student: StudentCourseInput[] = [
  sc('a', 'MATH 1341', 'Calculus 1', 5, { externalCourseId: 900, convertedCredits: q }),           // known -> MA 123, capped at 4 -> 3.33
  sc('b', 'CS 1800', 'Introduction to Computer Science programming', 4, { text: 'recursion sorting algorithms' }), // suggested -> CS 111
  sc('c', 'HIST 200', 'Local History', 3, { externalCourseId: 901 }),                              // known elective explicit 3 (outside programs)
  sc('d', 'ART 100', 'Ceramics Studio', 3),                                                         // no match
  sc('e', 'CS 9999', 'Intro to Computer Science', 4, { notEligible: true }),                      // not eligible
];
const r = compareUniversity(student, uni);
assert.equal(r.summary.studentCourses, 5);
assert.equal(r.summary.coursesKnown, 2);
assert.equal(r.summary.coursesSuggested, 1);
assert.equal(r.summary.coursesMatched, 3);
assert.equal(r.summary.percentMatched, 60);
assert.equal(r.summary.knownCredits, 6.33);          // 3.33 + 3
assert.ok(r.summary.suggestedCredits > 0 && r.summary.suggestedCredits <= 4);
assert.deepEqual(r.noMatch.map((n) => n.studentCourseId).sort(), ['d', 'e']);
assert.ok(r.noMatch.find((n) => n.studentCourseId === 'e')!.reason.includes('Not eligible'));

// known match wins and keeps its credits
const calc = r.programs.find((p) => p.name === 'BS Computer Science')!;
const m = calc.matched.find((x) => x.studentCourseId === 'a')!;
assert.equal(m.kind, 'known');
assert.equal(m.universityCode, 'MA 123');
assert.equal(m.transferCredits, 3.33);
// suggested match carries confidence and a reason, never above the rules ceiling
const s = calc.matched.find((x) => x.studentCourseId === 'b')!;
assert.equal(s.kind, 'suggested');
assert.equal(s.universityCode, 'CS 111');
assert.ok(s.confidence! > 0 && s.confidence! <= 0.7);
assert.ok(s.reason.length > 5);
// program ranking: CS program (2 courses) first; Economics and Philosophy have nothing matched so are not listed
assert.deepEqual(r.programs.map((p) => p.name), ['BS Computer Science']);
assert.equal(calc.coursesCovered, 2);
// explicit elective credit outside any program
assert.equal(r.otherMatches.length, 1);
assert.equal(r.otherMatches[0].studentCourseId, 'c');
assert.equal(r.otherMatches[0].transferCredits, 3);
assert.equal(r.otherMatches[0].outcome, 'elective');

// explicit credits may exceed the student's converted credits; otherwise credits cap at the target course's credits
const r2 = compareUniversity([sc('x', 'MATH 9', 'Big Calc', 6, { externalCourseId: 900 })], uni);
assert.equal(r2.summary.knownCredits, 4); // min(6, 4)
const r3 = compareUniversity([sc('y', 'HIST 1', 'Hist', 2, { externalCourseId: 901 })], uni);
assert.equal(r3.summary.knownCredits, 3); // explicit 3 beats converted 2

// one university course is used once
const dup = compareUniversity([sc('p', 'M1', 'Calc', 4, { externalCourseId: 900 }), sc('q', 'M2', 'Calc', 4, { externalCourseId: 900 })], uni);
assert.equal(dup.summary.coursesMatched, 1);

// ranking across programs
const uni2: UniversityInput = { ...uni, programs: [
  { id: 1, name: 'Small', area: null, degree: null, school: null, courseIds: [13] },
  { id: 2, name: 'Big', area: null, degree: null, school: null, courseIds: [10, 11, 12] },
] };
const rank = compareUniversity([sc('a1', 'MATH 1', 'Calculus I', 4, { externalCourseId: 900 }), sc('e1', 'ECON 1', 'Principles of Microeconomics', 4), sc('c1', 'CS 1', 'Introduction to Computer Science', 4)], uni2);
assert.deepEqual(rank.programs.map((p) => p.name), ['Big', 'Small']);
assert.ok(rank.programs[0].transferableCredits >= rank.programs[1].transferableCredits);

// cap
const capUni: UniversityInput = { ...uni, cap: 5 };
const capped = compareUniversity([sc('k1', 'A', 'x', 4, { externalCourseId: 900 }), sc('k2', 'B', 'y', 3, { externalCourseId: 901 })], capUni);
assert.equal(capped.summary.transferableCredits, 5);
assert.equal(capped.summary.capped, true);
assert.equal(applyCap([], 10).capped, false);

// empty student
const empty = compareUniversity([], uni);
assert.equal(empty.summary.percentMatched, 0);
assert.equal(empty.programs.length, 0);

console.log('student compare: all checks passed');
