/** Run: npx tsx scripts/test-rules-reader.ts  - checks the built-in rules reader on sample texts and generated PDFs. */
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { extractFromText, parseMrz } from '../src/documents/rules-helpers';
import { RulesDocumentReader } from '../src/documents/rules-document-reader';

const f = (t: string, n = 'doc.pdf') => extractFromText(t, n).extracted;

const transcript = `Northeastern University
Office of the University Registrar - OFFICIAL TRANSCRIPT
Student Name: Jane Q Doe   Student ID: 001234567
Fall 2021
CS 1800 Discrete Structures 4.0 A
CS 2000 Intro to Programming 5.0 B+
Spring 2022
MATH-1341 Calculus I 4 A-
ENGL 1102 First-Year Writing B 3.0
Cumulative GPA: 3.62`;
let e = f(transcript, 'transcript.pdf');
assert.equal(e.docType, 'transcript');
const fl = e.fields as any;
assert.equal(fl.courses.length, 4, JSON.stringify(fl.courses));
assert.equal(fl.courses[0].term, 'Fall 2021');
assert.equal(fl.courses[2].courseCode, 'MATH 1341');
assert.equal(fl.courses[3].grade, 'B');
assert.equal(fl.gpa, 3.62);
assert.match(fl.institution.name, /Northeastern/);
assert.match(fl.student.id, /001234567/);
console.log('transcript ok', e.confidence, fl.student);

const mrz = `P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
L898902C36UTO7408122F1204159ZE184226B<<<<<10`;
const m = parseMrz(mrz)!;
assert.equal((m.fields as any).dateOfBirth, '1974-08-12');
assert.equal((m.fields as any).expiryDate, '2012-04-15');
e = f(`PASSPORT\n${mrz}`, 'passport.jpg');
assert.equal(e.docType, 'id_document');
assert.equal((e.fields as any).idLast4, '02C3');
console.log('mrz ok', e.confidence, e.fields);

e = f('IELTS Test Report Form\nCandidate Name: Ravi Kumar\nTest Date: 12 March 2023\nListening 7.5\nReading 7.0\nWriting 6.5\nSpeaking 7.0\nOverall Band Score: 7.0');
assert.equal(e.docType, 'english_test');
assert.equal((e.fields as any).score, '7.0');
assert.equal((e.fields as any).testDate, '2023-03-12');
console.log('ielts ok', e.confidence);

e = f('TOEFL iBT Score Report\nTest Taker: Li Wei\nTest Date: 2022-11-05\nTotal Score: 102\nReading 28 Listening 26 Speaking 24 Writing 24');
assert.equal((e.fields as any).testType, 'TOEFL');
assert.equal((e.fields as any).score, '102');

e = f(`CS 101 Introduction to Programming - Syllabus
Credits: 3
Course Description
An introduction to programming in Python.
Topics Covered
- Variables and types
- Control flow
- Functions
Week 4: Recursion
Grading Policy
Exams 60%`, 'cs101-syllabus.pdf');
assert.equal(e.docType, 'syllabus');
assert.equal((e.fields as any).courseCode, 'CS 101');
assert.equal((e.fields as any).credits, 3);
assert((e.fields as any).topics.length >= 3, JSON.stringify((e.fields as any).topics));
console.log('syllabus ok', e.confidence, (e.fields as any).topics.length);

e = f('hello world', 'photo.png');
assert(e.confidence < 0.6);
e = extractFromText('', 'my_passport_scan.jpg').extracted;
assert.equal(e.docType, 'id_document');
assert(e.confidence <= 0.3);
console.log('weak inputs ok');

function pdf(rows: string[][]): Promise<Buffer> {
  return new Promise((res) => {
    const d = new PDFDocument(); const bufs: Buffer[] = [];
    d.on('data', (b: Buffer) => bufs.push(b)); d.on('end', () => res(Buffer.concat(bufs)));
    let y = 60;
    for (const r of rows) { r.forEach((c, i) => d.text(c, 60 + i * (i === 1 ? 70 : 150), y, { lineBreak: false })); y += 18; }
    d.end();
  });
}

(async () => {
  const reader = new RulesDocumentReader();
  const bytes = await pdf([
    ['Northeastern University'], ['OFFICIAL TRANSCRIPT'], ['Student Name: Jane Doe'], ['Fall 2021'],
    ['CS 1800', 'Discrete Structures', '4.0', 'A'], ['CS 2000', 'Intro to Programming', '5.0', 'B+'], ['GPA: 3.5'],
  ]);
  const r = await reader.read({ fileName: 'x.pdf', mimeType: 'application/pdf', bytes, userId: 'u' });
  console.log('pdf', r.model, r.costUsd, r.extracted.docType, r.extracted.confidence, JSON.stringify((r.extracted.fields as any).courses));
  assert.equal(r.extracted.docType, 'transcript');
  assert.equal(((r.extracted.fields as any).courses as any[]).length, 2);
  const bad = await reader.read({ fileName: 'bad.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4 garbage'), userId: 'u' });
  assert(bad.extracted.confidence < 0.6);
  const txt = await reader.read({ fileName: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from(transcript), userId: 'u' });
  assert.equal(txt.extracted.docType, 'transcript');
  const img = await reader.read({ fileName: 'IELTS.png', mimeType: 'image/png', bytes: Buffer.from([1, 2, 3]), userId: 'u' });
  assert.equal(img.extracted.docType, 'english_test');
  console.log('ALL OK');
})();
