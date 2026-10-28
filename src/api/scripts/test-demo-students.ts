import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ImportService } from '../src/import/import.service';

/**
 * Runs the importer's OWN row validation over the Pacific Ridge demo students (docs/demo-data) and checks the
 * roster is rich: every supported student field used, all ID types, every program covered, and each student's
 * courses exist in the demo catalogue with the same title and credits. Database access is stubbed.
 */
const dir = path.join(__dirname, '..', '..', '..', 'docs', 'demo-data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const catalogue = read('pacific-ridge-catalogue.json');
const withDocs = read('pacific-ridge-students.json').students as Record<string, any>[];
const noDocs = read('pacific-ridge-students-no-documents.json').students as Record<string, any>[];

const db: any = { query: async () => ({ recordset: [] }) };
const schema: any = { has: async () => true };
const svc = new ImportService(db, schema, {} as any);

(async () => {
  assert.equal(withDocs.length, 30);
  assert.equal(noDocs.length, 30);

  // The importer's own validation: no errors for any student, in either file.
  const rows = withDocs.map((payload) => ({ type: 'students' as const, payload }));
  const pending = svc.pendingRefs(rows);
  for (const [label, list] of [['with documents', withDocs], ['without documents', noDocs]] as const) {
    for (const s of list) {
      const r = await svc.checkRow('students', s, svc.newLookups(), { scopeCode: 'PRU', pending });
      assert.notEqual(r.status, 'error', `${label}: ${s.externalId} - ${r.messages.join('; ')}`);
      assert.equal(r.action, 'create');
    }
  }

  // Unique external ids and emails.
  assert.equal(new Set(withDocs.map((s) => s.externalId)).size, 30);
  assert.equal(new Set(withDocs.map((s) => s.email)).size, 30);

  // Every supported student field is used by at least one student.
  const FIELDS = ['universityCode', 'universityName', 'externalId', 'idType', 'email', 'firstName', 'lastName', 'dateOfBirth', 'phone', 'country', 'countryOfOrigin',
    'city', 'state', 'programName', 'degree', 'fieldOfStudy', 'gpa', 'graduationYear', 'creditsCompleted', 'calendar', 'courses', 'documents', 'invite'];
  for (const f of FIELDS) assert.ok(withDocs.some((s) => s[f] !== undefined && s[f] !== null && s[f] !== ''), `field ${f} is never used`);

  // Variety: all four ID types, and international students with an English test.
  assert.deepEqual([...new Set(withDocs.map((s) => s.idType))].sort(), ['national_id', 'other', 'passport', 'student_id']);
  const intl = withDocs.filter((s) => s.countryOfOrigin !== 'United States');
  assert.ok(intl.length >= 8);
  assert.ok(intl.every((s) => s.documents.some((d: any) => d.docType === 'english_test')));
  assert.ok(withDocs.every((s) => s.documents.some((d: any) => d.docType === 'transcript') && s.documents.some((d: any) => d.docType === 'id_document')));

  // Every program has 3 students; every course exists in the catalogue with the same title and credits.
  for (const p of catalogue.programs) assert.equal(withDocs.filter((s) => s.programName === p.name).length, 3, p.name);
  const cat = new Map<string, any>(catalogue.courses.map((c: any) => [c.code, c]));
  for (const s of withDocs) {
    assert.ok(s.courses.length >= 6, `${s.externalId} has ${s.courses.length} courses`);
    for (const c of s.courses) {
      const k = cat.get(c.code);
      assert.ok(k, `${c.code} is not in the catalogue`);
      assert.equal(c.title, k.name);
      assert.equal(c.credits, k.credits);
    }
  }

  // Grades include the edge cases that exercise the policy engine.
  const grades = new Set(withDocs.flatMap((s) => s.courses.map((c: any) => c.grade)));
  assert.ok(grades.has('P'), 'a pass/fail course exists');
  assert.ok(grades.has('C-'), 'a below-minimum grade exists');

  // The two files describe the same students.
  assert.deepEqual(noDocs.map((s) => s.externalId), withDocs.map((s) => s.externalId));
  assert.ok(noDocs.every((s) => s.documents === undefined));

  // The documents are real PDFs within the limits.
  for (const s of withDocs) for (const d of s.documents) {
    const bytes = Buffer.from(d.contentBase64, 'base64');
    assert.equal(bytes.subarray(0, 4).toString('latin1'), '%PDF', d.fileName);
    assert.ok(bytes.length > 500 && bytes.length < 2 * 1024 * 1024);
  }
  const body = Buffer.byteLength(JSON.stringify(read('pacific-ridge-students.json')));
  assert.ok(body < 6 * 1024 * 1024, `payload ${body} bytes exceeds the 6 MB request limit`);

  console.log(`demo students OK (${withDocs.length} students, ${withDocs.reduce((n, s) => n + s.courses.length, 0)} courses, ${withDocs.reduce((n, s) => n + s.documents.length, 0)} documents)`);
})().catch((e) => { console.error(e); process.exit(1); });
