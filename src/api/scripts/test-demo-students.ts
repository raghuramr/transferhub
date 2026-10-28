import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ImportService } from '../src/import/import.service';

/**
 * Runs the importer's OWN row validation over every demo data set's students (docs/demo-data/<set>/) and checks the
 * roster is rich: every supported student field used, every program covered, and each student's courses exist in the
 * set's catalogue with the same title and credits. The full 30-student sets must also cover all ID types and the
 * grade edge cases; the tiny test set only needs to be valid. Database access is stubbed.
 */
const root = path.join(__dirname, '..', '..', '..', 'docs', 'demo-data');
const sets = fs.readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'students.json')))
  .map((d) => d.name);

const db: any = { query: async () => ({ recordset: [] }) };
const schema: any = { has: async () => true };
const svc = new ImportService(db, schema, {} as any);

async function checkSet(name: string) {
  const dir = path.join(root, name);
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const catalogue = read('catalogue.json');
  const code: string = read('set.json').universityCode;
  const withDocs = read('students.json').students as Record<string, any>[];
  const noDocs = read('students-no-documents.json').students as Record<string, any>[];
  const full = withDocs.length >= 30;
  assert.equal(noDocs.length, withDocs.length);
  assert.ok(withDocs.length >= 3);

  // The importer's own validation: no errors for any student, in either file.
  const rows = withDocs.map((payload) => ({ type: 'students' as const, payload }));
  const pending = svc.pendingRefs(rows);
  for (const [label, list] of [['with documents', withDocs], ['without documents', noDocs]] as const) {
    for (const s of list) {
      const r = await svc.checkRow('students', s, svc.newLookups(), { scopeCode: code, pending });
      assert.notEqual(r.status, 'error', `${label}: ${s.externalId} - ${r.messages.join('; ')}`);
      assert.equal(r.action, 'create');
    }
  }

  // Unique external ids and emails.
  assert.equal(new Set(withDocs.map((s) => s.externalId)).size, withDocs.length);
  assert.equal(new Set(withDocs.map((s) => s.email)).size, withDocs.length);

  // Every supported student field is used by at least one student.
  const FIELDS = ['universityCode', 'universityName', 'externalId', 'idType', 'email', 'firstName', 'lastName', 'dateOfBirth', 'phone', 'country', 'countryOfOrigin',
    'city', 'state', 'programName', 'degree', 'fieldOfStudy', 'gpa', 'graduationYear', 'creditsCompleted', 'calendar', 'courses', 'documents', 'invite'];
  for (const f of FIELDS) assert.ok(withDocs.some((s) => s[f] !== undefined && s[f] !== null && s[f] !== ''), `field ${f} is never used`);

  // Variety: all four ID types, and international students with an English test.
  if (full) assert.deepEqual([...new Set(withDocs.map((s) => s.idType))].sort(), ['national_id', 'other', 'passport', 'student_id']);
  const intl = withDocs.filter((s) => s.countryOfOrigin !== 'United States');
  assert.ok(intl.length >= (full ? 8 : 1));
  assert.ok(intl.every((s) => s.documents.some((d: any) => d.docType === 'english_test')));
  assert.ok(withDocs.every((s) => s.documents.some((d: any) => d.docType === 'transcript') && s.documents.some((d: any) => d.docType === 'id_document')));

  // Every program has students (3 each in the full sets); every course exists in the catalogue with the same title and credits.
  for (const p of catalogue.programs) { const n = withDocs.filter((s) => s.programName === p.name).length; if (full) assert.equal(n, 3, p.name); else assert.ok(n >= 1, p.name); }
  const cat = new Map<string, any>(catalogue.courses.map((c: any) => [c.code, c]));
  for (const s of withDocs) {
    assert.ok(s.courses.length >= (full ? 6 : 3), `${s.externalId} has ${s.courses.length} courses`);
    for (const c of s.courses) {
      const k = cat.get(c.code);
      assert.ok(k, `${c.code} is not in the catalogue`);
      assert.equal(c.title, k.name);
      assert.equal(c.credits, k.credits);
    }
  }

  // Grades include the edge cases that exercise the policy engine.
  const grades = new Set(withDocs.flatMap((s) => s.courses.map((c: any) => c.grade)));
  if (full) {
    assert.ok(grades.has('P'), 'a pass/fail course exists');
    assert.ok(grades.has('C-'), 'a below-minimum grade exists');
  }

  // The two files describe the same students.
  assert.deepEqual(noDocs.map((s) => s.externalId), withDocs.map((s) => s.externalId));
  assert.ok(noDocs.every((s) => s.documents === undefined));

  // The documents are real PDFs within the limits.
  for (const s of withDocs) for (const d of s.documents) {
    const bytes = Buffer.from(d.contentBase64, 'base64');
    assert.equal(bytes.subarray(0, 4).toString('latin1'), '%PDF', d.fileName);
    assert.ok(bytes.length > 500 && bytes.length < 2 * 1024 * 1024);
  }
  const body = Buffer.byteLength(JSON.stringify(read('students.json')));
  assert.ok(body < 6 * 1024 * 1024, `${name}: payload ${body} bytes exceeds the 6 MB request limit`);

  console.log(`${name}: demo students OK (${withDocs.length} students, ${withDocs.reduce((n, s) => n + s.courses.length, 0)} courses, ${withDocs.reduce((n, s) => n + s.documents.length, 0)} documents)`);
}

(async () => {
  assert.ok(sets.length >= 4, `expected 4 data sets, found ${sets.join(', ')}`);
  for (const s of sets) await checkSet(s);
})().catch((e) => { console.error(e); process.exit(1); });
