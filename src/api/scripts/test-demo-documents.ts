/** Run: npx tsx scripts/test-demo-documents.ts - the demo document renderers, the ZIP writer and the image compressor. */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildStudentDocuments, completeColleges, syntheticCourses, zip, type DocStudent, type DocCollegeRecord } from '../src/demo/demo-documents';
import { DemoDocumentsService } from '../src/demo/demo-documents.service';
import { compressImage } from '../src/common/image-compress';
import { RulesDocumentReader } from '../src/documents/rules-document-reader';

const s: DocStudent = {
  firstName: 'Priya', lastName: 'Raman', studentId: 'P7000137', dateOfBirth: '2003-05-02', email: 'p@x.example', country: 'India', idType: 'passport',
  english: { type: 'IELTS', total: '7.0', r: '7.0', l: '7.5', s: '6.5', w: '6.5' },
};
const colleges: DocCollegeRecord[] = [{
  institution: { name: 'Test College', code: 'TC', calendar: 'semester' },
  courses: [
    { code: 'CS 101', title: 'Intro Programming', credits: 3, grade: 'A', term: 'Fall 2025', topics: ['Variables', 'Loops', 'Functions'] },
    { code: 'MA 101', title: 'Calculus I', credits: 4, grade: 'B+', term: 'Spring 2026' },
  ],
}];

(async () => {
  const docs = await buildStudentDocuments(s, colleges, ['transcript', 'id_document', 'english_test', 'syllabus', 'enrollment_letter']);
  assert.equal(docs.length, 1 + 2 + 1 + 2 + 1, 'transcript, passport + card, english, 2 syllabi, letter');
  const reader = new RulesDocumentReader();
  for (const d of docs) {
    assert.equal(d.bytes.subarray(0, 4).toString('latin1'), '%PDF');
    const r = await reader.read({ fileName: d.fileName, mimeType: 'application/pdf', bytes: d.bytes, userId: 'u' });
    assert.equal(r.extracted.docType, d.docType, `${d.fileName} read as ${r.extracted.docType}`);
    if (d.docType === 'transcript') assert.equal((r.extracted.fields as any).courses.length, 2);
  }
  // Passport MRZ: the reader must accept it with valid check digits.
  const pass = docs.find((d) => d.docType === 'id_document')!;
  const pr = await reader.read({ fileName: pass.fileName, mimeType: 'application/pdf', bytes: pass.bytes, userId: 'u' });
  assert.equal((pr.extracted.fields as any).idLast4, '0137');
  assert.equal((pr.extracted.fields as any).dateOfBirth, '2003-05-02');
  assert.ok(pr.extracted.confidence >= 0.85, `passport confidence ${pr.extracted.confidence}`);
  assert.match(docs[0].fileName, /^Priya Raman - /, 'files are named after the student');

  // Gap 1: every kind is produced even when the student record holds nothing - scores, college and courses are
  // filled in deterministically rather than skipped.
  const bare: DocStudent = { firstName: 'Alex', lastName: 'Stone', studentId: '', dateOfBirth: '2002-04-09', email: 'a@x.example', country: 'United States', idType: 'student_id' };
  const all = await buildStudentDocuments(bare, [], ['transcript', 'id_document', 'english_test', 'syllabus', 'enrollment_letter']);
  for (const k of ['transcript', 'id_document', 'english_test', 'syllabus', 'enrollment_letter']) {
    assert.ok(all.some((d) => d.docType === k), `${k} is generated with no records on file`);
  }
  const again = await buildStudentDocuments(bare, [], ['transcript']);
  assert.equal(again[0].fileName, all.find((d) => d.docType === 'transcript')!.fileName, 'synthetic records are deterministic');
  for (const d of all) {
    const r = await reader.read({ fileName: d.fileName, mimeType: 'application/pdf', bytes: d.bytes, userId: 'u' });
    assert.equal(r.extracted.docType, d.docType, `${d.fileName} read as ${r.extracted.docType}`);
  }
  const synth = syntheticCourses('Alex Stone', { field: 'Computer Science' });
  assert.ok(synth.length >= 4 && synth.every((c) => c.code && c.title && c.credits > 0 && c.grade && c.term && c.topics?.length));
  assert.ok(synth.some((c) => c.code.startsWith('CSC')), 'the field of study picks the course pool');
  assert.equal(completeColleges(bare, [{ institution: { name: 'Empty College', code: 'EC' }, courses: [] }])[0].courses.length > 0, true);

  // Gap 2: the manual ("type the details") path - validation and the same renderers from typed data.
  const svc = new DemoDocumentsService(null as never);
  assert.deepEqual(svc.validateManual({}).missing.length > 0, true);
  const typed = {
    kinds: ['transcript', 'syllabus', 'id_document', 'english_test', 'enrollment_letter'] as const,
    student: { firstName: 'Lena', lastName: 'Marsh', country: 'Poland', idType: 'passport' as const, program: 'Business Administration', targetUniversity: 'Boston University' },
    institution: { name: 'Vistula Technical College', code: 'VTC', school: 'School of Business' },
    courses: [{ code: 'ACC 110', title: 'Financial Accounting', credits: 3, grade: 'A', term: 'Fall 2024', topics: ['Ledgers', 'Statements'] }],
  };
  assert.deepEqual(svc.validateManual(typed as never).missing, [], 'a complete form has nothing missing');
  assert.ok(svc.validateManual({ kinds: ['transcript'], student: { firstName: 'A', lastName: 'B' } }).missing.some((m) => /course/i.test(m)), 'a transcript needs courses');
  assert.ok(svc.validateManual({ kinds: ['transcript'], student: { lastName: 'B' }, institution: { name: 'X College' }, courses: [{ code: 'A 1', title: 'T' }] }).missing.some((m) => /First name/.test(m)));
  const manual = await svc.generateManual(typed as never);
  assert.equal(manual.mime, 'application/zip');
  assert.equal(manual.bytes.readUInt32LE(0), 0x04034b50);
  const oneDoc = await svc.generateManual({ kinds: ['english_test'], student: { firstName: 'Lena', lastName: 'Marsh' } });
  assert.equal(oneDoc.mime, 'application/pdf');
  const mr = await reader.read({ fileName: oneDoc.fileName, mimeType: 'application/pdf', bytes: oneDoc.bytes, userId: 'u' });
  assert.equal(mr.extracted.docType, 'english_test');
  assert.ok((mr.extracted.fields as any).score, 'the derived English scores are readable');
  await assert.rejects(() => svc.generateManual({ kinds: ['transcript'], student: { firstName: 'A' } }), /Last name/);

  const z = zip(docs.map((d) => ({ path: d.fileName, bytes: d.bytes })));
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  assert.equal(z.readUInt16LE(z.length - 22 + 10), docs.length);

  const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#aa2233' } }).png().toBuffer();
  const out = await compressImage({ originalname: 'logo.png', buffer: png, mimetype: 'image/png', size: png.length }, 1920);
  assert.equal(out.mimetype, 'image/webp');
  assert.ok(out.buffer.length < png.length);
  assert.equal((await sharp(out.buffer).metadata()).width, 1920);
  const jpg = await compressImage({ originalname: 'scan.png', buffer: png, mimetype: 'image/png', size: png.length }, 800, 85, 'jpeg');
  assert.equal(jpg.mimetype, 'image/jpeg');
  const pdf = { originalname: 'a.pdf', buffer: Buffer.from('%PDF'), mimetype: 'application/pdf', size: 4 };
  assert.equal(await compressImage(pdf, 1920), pdf, 'PDFs untouched');
  console.log('demo documents OK');
})().catch((e) => { console.error(e); process.exit(1); });
