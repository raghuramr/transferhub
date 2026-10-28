/** Run: npx tsx scripts/test-scan-match.ts - checks the text-position matcher used by the Smart Upload scan view (pure, no browser). */
import assert from 'node:assert/strict';
import { buildIndex, dateVariants, findText, flattenFields, matchFields, squash, type Box, type TextItem } from '../../ui/src/lib/scan-match';

// One text item per "cell" like pdf.js gives them; y in 0..1 from the top, 0.04 line height.
let y = 0.05;
const items: TextItem[] = [];
const line = (cells: [string, number, number][], page = 1) => {
  for (const [str, x, w] of cells) items.push({ page, str, x, y, w, h: 0.02 });
  y += 0.04;
};
line([['Northeastern University', 0.1, 0.4]]);
line([['Student Name: ', 0.1, 0.15], ['Jane Q Doe', 0.26, 0.15], ['Student ID: ', 0.5, 0.1], ['001234567', 0.61, 0.12]]);
line([['Fall 2021', 0.1, 0.1]]);
line([['CS 1800', 0.1, 0.1], ['Discrete Structures', 0.25, 0.3], ['4.0', 0.6, 0.05], ['A', 0.75, 0.02]]);
line([['MATH-1341', 0.1, 0.1], ['Calculus I', 0.25, 0.2], ['4', 0.6, 0.02], ['A-', 0.75, 0.03]]);
line([['Fall 2022', 0.1, 0.1]]);
line([['CS 1800', 0.1, 0.1], ['Discrete Structures', 0.25, 0.3], ['4.0', 0.6, 0.05], ['B', 0.75, 0.02]]);
line([['Cumulative GPA: ', 0.1, 0.2], ['3.62', 0.31, 0.05]]);
line([['Date of birth 1 Sep 2003', 0.1, 0.4]]);
line([['Degree awarded Bachelor of', 0.1, 0.3]]);
line([['Science in Computing', 0.1, 0.3]]);

assert.equal(squash('CS-1800'), 'cs1800');
assert.equal(squash('Zoë  Müller'), 'zoemuller');
assert.ok(dateVariants('2003-09-01').includes('1 Sep 2003'));

const idx = buildIndex(items);
let b = findText(idx, 'jane q doe')!;
assert.ok(b && b.length === 1 && Math.abs(b[0].x - 0.26) < 1e-6, 'name located at its own cell');
b = findText(idx, 'Student ID')!;
assert.ok(b);
// partial-item match is proportional, not the whole item
b = findText(idx, 'Name')!;
assert.ok(b[0].w < 0.1, `sliced box ${b[0].w}`);
assert.equal(findText(idx, 'Nobody Here'), null, 'absent value has no box (never fabricated)');
// value that wraps over two lines is found as one box per line
const wrap = findText(idx, 'Bachelor of Science in Computing')!;
assert.equal(wrap.length, 2);

const fields = {
  institution: { name: 'Northeastern University', code: 'NU' },
  student: { name: 'Jane Q. Doe', id: '001234567', dateOfBirth: '2003-09-01' },
  gpa: 3.62,
  degree: 'Bachelor of Science in Computing',
  notThere: 'Totally absent text',
  courses: [
    { courseCode: 'CS 1800', courseTitle: 'Discrete Structures', credits: 4, grade: 'A', term: 'Fall 2021' },
    { courseCode: 'MATH 1341', courseTitle: 'Calculus I', credits: 4, grade: 'A-', term: 'Fall 2021' },
    { courseCode: 'CS 1800', courseTitle: 'Discrete Structures', credits: 4, grade: 'B', term: 'Fall 2022' },
    { courseCode: 'XX 9999', courseTitle: 'Not on the page', credits: 3, grade: 'A' },
  ],
};
const r = matchFields(items, fields);
const get = (k: string): Box[] | undefined => r.highlights.find((h) => h.key === k)?.boxes;
assert.ok(get('institution.name'));
assert.equal(get('institution.code'), undefined, 'two-letter values are too ambiguous to place');
assert.ok(get('student.name'), 'tolerates the full stop in "Q."');
assert.ok(get('student.id'));
assert.ok(get('student.dateOfBirth'), 'ISO date found as "1 Sep 2003"');
assert.ok(get('gpa'));
assert.ok(Math.abs(get('gpa')![0].x - 0.31) < 1e-6);
assert.equal(get('notThere'), undefined);
assert.ok(get('degree'));
// course rows: each repeated code lands on its OWN line
assert.ok(get('course.0') && get('course.2'));
assert.notEqual(get('course.0')![0].y, get('course.2')![0].y);
assert.ok(get('course.0')![0].y < get('course.1')![0].y && get('course.1')![0].y < get('course.2')![0].y);
assert.ok(Math.abs(get('course.0.code')![0].x - 0.1) < 1e-6);
assert.ok(Math.abs(get('course.0.credits')![0].x - 0.6) < 1e-3, 'credits 4 matches "4.0"');
assert.ok(Math.abs(get('course.1.credits')![0].x - 0.6) < 1e-3);
assert.ok(Math.abs(get('course.1.grade')![0].x - 0.75) < 1e-3, 'A- is matched as a whole word, not as A');
assert.ok(Math.abs(get('course.2.grade')![0].x - 0.75) < 1e-3);
assert.equal(get('course.3'), undefined, 'a course that is not on the page gets no box');
assert.ok(get('course.1.code'), 'MATH 1341 matches MATH-1341');
assert.ok(r.fields.filter((f) => f.courseIndex === 0).length === 4);
assert.ok(flattenFields({ a: { b: 'x' }, n: 5 }).some((f) => f.key === 'a.b'));

// no text layer -> labelled fields but zero highlights
assert.equal(matchFields([], fields).highlights.length, 0);
assert.ok(matchFields([], fields).fields.length > 5);
console.log('scan-match ok:', r.highlights.length, 'highlights for', r.fields.length, 'fields');
