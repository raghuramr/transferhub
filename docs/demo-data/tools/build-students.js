#!/usr/bin/env node
// Generates the student roster for one demo data set (partner API demo).
//   node docs/demo-data/tools/build-students.js <set-folder>      e.g. demo-1-pacific-ridge
// Reads <set>/catalogue.json (so every student's courses exist in the catalogue), <set>/roster.json
// ([first, last, nationality|null, idType] rows) and <set>/set.json (university, seed, cities, concentrations...) and writes
//   <set>/students.json                 - every field filled, with documents (PDF, base64)
//   <set>/students-no-documents.json    - the same students without documents (small, easy to read)
// Deterministic: the same input always produces the same students. Needs pdfkit (installed in src/api).
const fs = require('fs');
const path = require('path');

const arg = process.argv[2];
if (!arg) { console.error('Usage: node build-students.js <set-folder>'); process.exit(1); }
const dir = path.resolve(arg);
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const catalogue = readJson('catalogue.json');
const ROSTER = readJson('roster.json');
const SET = readJson('set.json');
const CODE = SET.universityCode;
const UNI = SET.universityName;
let PDFDocument;
try {
  PDFDocument = require(path.join(__dirname, '..', '..', '..', 'src', 'api', 'node_modules', 'pdfkit'));
} catch {
  console.error('pdfkit not found. Run `npm install` in src/api first.');
  process.exit(1);
}

// ── deterministic randomness ──
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SET.seed);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const shuffle = (arr) => arr.map((v) => [rand(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

const CITIES = SET.cities;
const CONCENTRATION = SET.concentrations;
const OWN = SET.ownCourses || [4, 5]; // courses taken from the student's own program (min, max)
const GEN = SET.generalCourses || [2, 3]; // courses from other programs
const GRADES = [['A', 4.0], ['A-', 3.67], ['B+', 3.33], ['B', 3.0], ['B-', 2.67], ['C+', 2.33], ['C', 2.0]];
const GRADE_WEIGHTS = [5, 5, 5, 6, 3, 2, 1];
const TERMS = SET.terms || ['Fall 2023', 'Spring 2024', 'Fall 2024', 'Spring 2025', 'Fall 2025', 'Spring 2026'];

const pickGrade = () => {
  const total = GRADE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < GRADES.length; i++) {
    r -= GRADE_WEIGHTS[i];
    if (r <= 0) return GRADES[i];
  }
  return GRADES[3];
};
const points = Object.fromEntries([...GRADES, ['C-', 1.67]]);
const pad = (n, w) => String(n).padStart(w, '0');
const ascii = (s) => s.normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase();
const level = (code) => Number((/\d+/.exec(code) || ['100'])[0]);

const byProgram = {};
for (const c of catalogue.courses) (byProgram[c.programName] ||= []).push(c);
const programs = catalogue.programs;
const generalPool = catalogue.courses.filter((c) => SET.generalCourseCodes.includes(c.code));

// ── PDFs ──
function pdf(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: UNI, Author: UNI, CreationDate: new Date('2026-10-01T00:00:00Z') } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

const transcriptPdf = (s) =>
  pdf((d) => {
    d.fontSize(16).text(UNI, { align: 'center' });
    d.fontSize(11).text('Academic transcript (student copy)', { align: 'center' }).moveDown();
    d.fontSize(10).text(`Student: ${s.firstName} ${s.lastName}`).text(`Student ID: ${s.externalId}`).text(`Date of birth: ${s.dateOfBirth}`);
    d.text(`Program: ${s.programName} (${s.degree})`).text('Calendar: Semester').moveDown();
    // Grouped by term like a real transcript: a term heading, then "CODE Title credits grade" rows.
    const terms = [...new Set(s.courses.map((c) => c.term))];
    for (const t of terms) {
      d.moveDown(0.5).font('Helvetica-Bold').text(t);
      d.font('Helvetica');
      for (const c of s.courses.filter((x) => x.term === t)) d.text(`${c.code} ${c.title} ${c.credits} ${c.grade}`);
    }
    d.moveDown().font('Helvetica').text(`Credits completed: ${s.creditsCompleted}`).text(`Cumulative GPA: ${s.gpa.toFixed(2)}`);
  });

const idPdf = (s, rec) =>
  pdf((d) => {
    d.fontSize(16).text(rec.passport ? 'Passport copy' : `${UNI} student ID`, { align: 'center' }).moveDown();
    d.fontSize(11);
    d.text(`Name: ${s.lastName.toUpperCase()}, ${s.firstName}`);
    d.text(rec.passport ? `Passport No: ${s.externalId}` : `ID number: ${s.externalId}`);
    d.text(`Date of birth: ${s.dateOfBirth}`);
    d.text(`Country: ${s.countryOfOrigin}`);
    d.text(rec.passport ? 'Expiry date: 2031-06-30' : 'Valid until: 2027-08-31');
  });

const englishPdf = (s, score) =>
  pdf((d) => {
    d.fontSize(16).text('TOEFL iBT Test Taker Score Report', { align: 'center' }).moveDown();
    d.fontSize(11).text(`Candidate name: ${s.firstName} ${s.lastName}`).text('Test date: 2023-03-18').text(`Total score: ${score.total}`);
    d.text(`Reading ${score.r}  Listening ${score.l}  Speaking ${score.s}  Writing ${score.w}`).text('Valid until: 2025-03-18');
  });

(async () => {
  const students = [];
  for (let i = 0; i < ROSTER.length; i++) {
    const [firstName, lastName, nationality, idType] = ROSTER[i];
    const prog = programs[i % programs.length];
    const own = shuffle(byProgram[prog.name]).slice(0, OWN[0] + Math.floor(rand() * (OWN[1] - OWN[0] + 1)));
    const general = shuffle(generalPool.filter((c) => c.programName !== prog.name)).slice(0, GEN[0] + Math.floor(rand() * (GEN[1] - GEN[0] + 1)));
    const chosen = [...own, ...general].sort((a, b) => level(a.code) - level(b.code));

    let weighted = 0;
    let gradedCredits = 0;
    let earned = 0;
    const courses = chosen.map((c, idx) => {
      let g = pickGrade();
      let grade = g[0];
      if (idx === chosen.length - 1 && i % 7 === 3) grade = 'C-'; // a few "below the usual minimum" grades to show review flags
      if (general.includes(c) && i % 9 === 4) grade = 'P'; // a few pass/fail courses
      if (grade !== 'P') {
        weighted += (points[grade] ?? g[1]) * c.credits;
        gradedCredits += c.credits;
      }
      earned += c.credits;
      return { code: c.code, title: c.name, credits: c.credits, grade, term: TERMS[Math.min(TERMS.length - 1, Math.floor((idx * TERMS.length) / chosen.length))] };
    });

    const [city, state] = CITIES[i % CITIES.length];
    const num = pad(i + 1, 4);
    const externalId =
      idType === 'passport' ? `${ascii(nationality).slice(0, 1).toUpperCase()}${pad(7000000 + i * 137, 8)}`
      : idType === 'national_id' ? `NID-${pad(40000000 + i * 911, 9)}`
      : idType === 'other' ? `ALT-${CODE}-${num}`
      : `${CODE}-2023-${num}`;
    const gpa = Math.round((weighted / Math.max(1, gradedCredits)) * 100) / 100;
    const conc = pick(CONCENTRATION[prog.name]);
    const birthYear = 2002 + (i % 4);

    const s = {
      universityCode: CODE,
      universityName: UNI,
      externalId,
      idType,
      email: `${ascii(firstName)}.${ascii(lastName)}@${SET.emailDomain}`,
      firstName,
      lastName,
      dateOfBirth: `${birthYear}-${pad(1 + ((i * 5) % 12), 2)}-${pad(1 + ((i * 7) % 28), 2)}`,
      phone: `+1-${SET.phoneAreaCodes[i % SET.phoneAreaCodes.length]}-555-01${pad(i, 2)}`, // US numbers (555-01xx is the reserved fictional range)
      country: 'United States', // where the student lives now; countryOfOrigin is where they are from
      countryOfOrigin: nationality ?? 'United States',
      city,
      state,
      programName: prog.name,
      degree: prog.degree,
      fieldOfStudy: `${prog.name} - ${conc}`,
      gpa,
      graduationYear: 2027 + (i % 2),
      creditsCompleted: earned + 12 + (i % 4) * 6, // plus credits from before this university (AP, dual enrollment)
      calendar: 'semester',
      courses,
      documents: [],
      invite: false,
    };

    s.documents.push({ docType: 'transcript', fileName: `transcript-${ascii(lastName)}-${num}.pdf`, contentBase64: await transcriptPdf(s) });
    s.documents.push({ docType: 'id_document', fileName: `${idType === 'passport' ? 'passport' : 'student-id'}-${ascii(lastName)}-${num}.pdf`, contentBase64: await idPdf(s, { passport: idType === 'passport' }) });
    if (nationality) {
      const total = 88 + ((i * 3) % 30);
      s.documents.push({ docType: 'english_test', fileName: `toefl-${ascii(lastName)}-${num}.pdf`, contentBase64: await englishPdf(s, { total, r: 24 + (i % 6), l: 24 + ((i + 1) % 6), s: 22 + ((i + 2) % 6), w: 22 + ((i + 3) % 6) }) });
    }
    students.push(s);
  }

  const withDocs = { note: `${UNI} student profiles (${students.length}, with documents)`, students };
  const noDocs = {
    note: `${UNI} student profiles (${students.length}, no documents)`,
    students: students.map(({ documents, ...rest }) => rest),
  };
  fs.writeFileSync(path.join(dir, 'students.json'), JSON.stringify(withDocs, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'students-no-documents.json'), JSON.stringify(noDocs, null, 2) + '\n');
  const kb = Math.round(fs.statSync(path.join(dir, 'students.json')).size / 1024);
  const docCount = students.reduce((n, s) => n + s.documents.length, 0);
  console.log(`Wrote ${students.length} students, ${students.reduce((n, s) => n + s.courses.length, 0)} courses, ${docCount} documents (${kb} KB with documents).`);
})().catch((e) => { console.error(e); process.exit(1); });
