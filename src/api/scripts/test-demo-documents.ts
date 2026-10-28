/** Run: npx tsx scripts/test-demo-documents.ts - the demo document renderers, the ZIP writer and the image compressor. */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildStudentDocuments, zip, type DocStudent, type DocCollegeRecord } from '../src/demo/demo-documents';
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
  assert.equal(docs.length, 1 + 1 + 1 + 2 + 1);
  const reader = new RulesDocumentReader();
  for (const d of docs) {
    assert.equal(d.bytes.subarray(0, 4).toString('latin1'), '%PDF');
    const r = await reader.read({ fileName: d.fileName, mimeType: 'application/pdf', bytes: d.bytes, userId: 'u' });
    assert.equal(r.extracted.docType, d.docType, `${d.fileName} read as ${r.extracted.docType}`);
    if (d.docType === 'transcript') assert.equal((r.extracted.fields as any).courses.length, 2);
  }
  const english = await buildStudentDocuments({ ...s, english: undefined }, colleges, ['english_test']);
  assert.equal(english.length, 0, 'no English test for native speakers');

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
