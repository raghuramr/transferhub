import PDFDocument from 'pdfkit';

/**
 * Renders the sample documents a student would upload (transcript, ID / passport, English test, syllabus, enrolment
 * letter) as small text-layer PDFs. Pure functions: callers pass plain data, so the same renderers serve the super-admin
 * "Demo documents" tool and the offline sample-pack script. Layouts follow what the Smart Upload rules reader expects
 * (term headings, "CODE Title credits grade" rows, labelled fields) so the documents classify and read cleanly.
 */

export type DemoDocKind = 'transcript' | 'id_document' | 'english_test' | 'syllabus' | 'enrollment_letter';
export const DEMO_DOC_KINDS: { kind: DemoDocKind; label: string }[] = [
  { kind: 'transcript', label: 'Transcript (one per previous college)' },
  { kind: 'id_document', label: 'ID / passport copy' },
  { kind: 'english_test', label: 'English test report (international students)' },
  { kind: 'syllabus', label: 'Course syllabi (one per course)' },
  { kind: 'enrollment_letter', label: 'Enrolment verification letter' },
];

export interface DocStudent {
  firstName: string;
  lastName: string;
  studentId: string;
  dateOfBirth: string; // yyyy-mm-dd
  email: string;
  country: string; // country of origin / nationality
  city?: string;
  state?: string;
  idType: 'passport' | 'student_id' | 'national_id' | 'other';
  expectedGraduation?: number;
  targetUniversity?: string;
  targetProgram?: string;
  /** TOEFL or IELTS details, only for non-native speakers. */
  english?: { type: 'TOEFL' | 'IELTS'; total: string; r: string; l: string; s: string; w: string };
}
export interface DocInstitution { name: string; code: string; calendar?: string }
export interface DocCourse { code: string; title: string; credits: number; grade: string; term: string; description?: string; outcomes?: string; topics?: string[] }

function pdf(title: string, author: string, draw: (d: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: title, Author: author, Producer: 'TransferHub demo documents', CreationDate: new Date('2026-10-01T00:00:00Z') } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

const slug = (s: string) => s.normalize('NFD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const GP: Record<string, number> = { 'A+': 4, A: 4, 'A-': 3.67, 'B+': 3.33, B: 3, 'B-': 2.67, 'C+': 2.33, C: 2, 'C-': 1.67, 'D+': 1.33, D: 1, F: 0 };

export function transcriptPdf(s: DocStudent, inst: DocInstitution, courses: DocCourse[]): Promise<Buffer> {
  return pdf(`${inst.name} transcript`, inst.name, (d) => {
    d.fontSize(16).text(inst.name, { align: 'center' });
    d.fontSize(11).text('Office of the Registrar - Academic transcript (student copy)', { align: 'center' }).moveDown();
    d.fontSize(10).text(`Student: ${s.firstName} ${s.lastName}`).text(`Student ID: ${s.studentId}`).text(`Date of birth: ${s.dateOfBirth}`);
    d.text(`Calendar: ${inst.calendar === 'quarter' ? 'Quarter' : 'Semester'}`).moveDown();
    const terms = [...new Set(courses.map((c) => c.term))];
    let credits = 0, pts = 0, gradedCredits = 0;
    for (const t of terms) {
      d.moveDown(0.5).font('Helvetica-Bold').text(t);
      d.font('Helvetica');
      for (const c of courses.filter((x) => x.term === t)) {
        d.text(`${c.code} ${c.title} ${c.credits} ${c.grade}`);
        credits += c.credits;
        if (GP[c.grade] !== undefined) { pts += GP[c.grade] * c.credits; gradedCredits += c.credits; }
      }
    }
    d.moveDown().font('Helvetica').text(`Credits completed: ${credits}`).text(`Cumulative GPA: ${(gradedCredits ? pts / gradedCredits : 0).toFixed(2)}`);
  });
}

export function idPdf(s: DocStudent, inst?: DocInstitution): Promise<Buffer> {
  const passport = s.idType === 'passport';
  return pdf(passport ? 'Passport copy' : 'Student ID', inst?.name ?? 'TransferHub', (d) => {
    d.fontSize(16).text(passport ? 'Passport copy' : s.idType === 'national_id' ? 'National identity card' : `${inst?.name ?? 'University'} student ID`, { align: 'center' }).moveDown();
    d.fontSize(11);
    d.text(`Surname: ${s.lastName.toUpperCase()}`).text(`Given names: ${s.firstName}`);
    d.text(passport ? `Passport No: ${s.studentId}` : `ID number: ${s.studentId}`);
    d.text(`Date of birth: ${s.dateOfBirth}`).text(`Nationality: ${s.country}`);
    d.text(passport ? 'Date of expiry: 2031-06-30' : 'Valid until: 2027-08-31');
  });
}

export function englishPdf(s: DocStudent): Promise<Buffer> {
  const e = s.english ?? { type: 'TOEFL', total: '96', r: '25', l: '25', s: '23', w: '23' };
  return pdf(`${e.type} score report`, e.type, (d) => {
    if (e.type === 'IELTS') {
      d.fontSize(16).text('IELTS Test Report Form', { align: 'center' }).moveDown();
      d.fontSize(11).text(`Candidate name: ${s.firstName} ${s.lastName}`).text('Test date: 2025-03-18');
      d.text(`Listening ${e.l}`).text(`Reading ${e.r}`).text(`Writing ${e.w}`).text(`Speaking ${e.s}`).text(`Overall band score: ${e.total}`);
    } else {
      d.fontSize(16).text('TOEFL iBT Test Taker Score Report', { align: 'center' }).moveDown();
      d.fontSize(11).text(`Candidate name: ${s.firstName} ${s.lastName}`).text('Test date: 2025-03-18').text(`Total score: ${e.total}`);
      d.text(`Reading ${e.r}  Listening ${e.l}  Speaking ${e.s}  Writing ${e.w}`);
    }
    d.text('Valid until: 2027-03-18');
  });
}

export function syllabusPdf(inst: DocInstitution, c: DocCourse): Promise<Buffer> {
  const topics = c.topics?.length ? c.topics : ['Course foundations and key terminology', 'Core concepts and worked examples', 'Applications and problem solving', 'Review and assessment'];
  return pdf(`${c.code} syllabus`, inst.name, (d) => {
    d.fontSize(16).text(`${c.code} ${c.title} - Syllabus`).moveDown(0.3);
    d.fontSize(10).text(inst.name).text(`Credits: ${c.credits}`).text('Instructor: Course staff   Office hours: by appointment').moveDown();
    d.font('Helvetica-Bold').text('Course Description').font('Helvetica');
    d.text(c.description || `${c.title}: a college-level course covering the standard topics listed below.`).moveDown();
    d.font('Helvetica-Bold').text('Learning Outcomes').font('Helvetica');
    for (const o of (c.outcomes || `Explain the core ideas of ${c.title}; apply them to practical problems.`).split(/;\s*/)) d.text(`- ${o.replace(/\.$/, '')}`);
    d.moveDown().font('Helvetica-Bold').text('Topics Covered').font('Helvetica');
    topics.forEach((t) => d.text(`- ${t}`));
    d.moveDown().font('Helvetica-Bold').text('Weekly Schedule').font('Helvetica');
    topics.forEach((t, i) => d.text(`Week ${i * 3 + 1}-${i * 3 + 3}: ${t}`));
    d.moveDown().font('Helvetica-Bold').text('Grading Policy').font('Helvetica');
    d.text('Assignments 30%, midterm exam 30%, final exam 40%. Prerequisites: as listed in the catalogue. Academic integrity policy applies.');
  });
}

export function enrollmentLetterPdf(s: DocStudent, inst: DocInstitution): Promise<Buffer> {
  return pdf('Enrolment verification letter', inst.name, (d) => {
    d.fontSize(16).text(inst.name, { align: 'center' });
    d.fontSize(12).text('Enrollment Verification Letter', { align: 'center' }).moveDown();
    d.fontSize(10).text('Date: 2026-10-01').moveDown().text('To Whom It May Concern,').moveDown();
    d.text(`This letter certifies that ${s.firstName} ${s.lastName} (Student ID ${s.studentId}) is currently enrolled as a full-time student at ${inst.name} and is in good standing.`).moveDown();
    if (s.targetUniversity) d.text(`The student intends to transfer to ${s.targetUniversity}${s.targetProgram ? ` (${s.targetProgram})` : ''}.`).moveDown();
    if (s.expectedGraduation) d.text(`Expected graduation: ${s.expectedGraduation}.`).moveDown();
    d.text('Registrar, ' + inst.name);
  });
}

export interface DocCollegeRecord { institution: DocInstitution; courses: DocCourse[] }
export interface GeneratedDoc { fileName: string; docType: DemoDocKind; bytes: Buffer }

/** Builds the requested documents for one student. `colleges` = every college the student has coursework from. */
export async function buildStudentDocuments(s: DocStudent, colleges: DocCollegeRecord[], kinds: DemoDocKind[]): Promise<GeneratedDoc[]> {
  const out: GeneratedDoc[] = [];
  const who = slug(`${s.lastName}-${s.firstName}`);
  const home = colleges[0]?.institution;
  for (const k of kinds) {
    if (k === 'transcript') for (const c of colleges) out.push({ docType: k, fileName: `transcript-${slug(c.institution.code)}-${who}.pdf`, bytes: await transcriptPdf(s, c.institution, c.courses) });
    if (k === 'id_document') out.push({ docType: k, fileName: `${s.idType === 'passport' ? 'passport' : 'id'}-${who}.pdf`, bytes: await idPdf(s, home) });
    if (k === 'english_test' && s.english) out.push({ docType: k, fileName: `${s.english.type.toLowerCase()}-${who}.pdf`, bytes: await englishPdf(s) });
    if (k === 'enrollment_letter' && home) out.push({ docType: k, fileName: `enrollment-letter-${slug(home.code)}-${who}.pdf`, bytes: await enrollmentLetterPdf(s, home) });
    if (k === 'syllabus') for (const c of colleges) for (const course of c.courses) out.push({ docType: k, fileName: `syllabus-${slug(c.institution.code)}-${slug(course.code)}.pdf`, bytes: await syllabusPdf(c.institution, course) });
  }
  return out;
}

// ── minimal ZIP writer (STORE, no compression - the PDFs are already compressed; avoids a new dependency) ──
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zip(files: { path: string; bytes: Buffer }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8'), crc = crc32(f.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.bytes.length, 18); local.writeUInt32LE(f.bytes.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, f.bytes);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(f.bytes.length, 20); c.writeUInt32LE(f.bytes.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + f.bytes.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
