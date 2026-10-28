/**
 * Offline sample pack for the Maya Rivera demo (no database needed): her two college transcripts, ID, enrolment letter and the
 * three syllabi the scenario asks for. Writes docs/demo-data/maya-documents/*.pdf and checks each file with the built-in reader.
 *   npx tsx scripts/build-maya-documents.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_TRANSCRIPTS } from '../src/demo/demo-scenario.data';
import { buildStudentDocuments, type DocStudent, type DocCourse } from '../src/demo/demo-documents';
import { RulesDocumentReader } from '../src/documents/rules-document-reader';

const out = path.join(__dirname, '..', '..', '..', 'docs', 'demo-data', 'maya-documents');
fs.mkdirSync(out, { recursive: true });

const maya: DocStudent = {
  firstName: 'Maya', lastName: 'Rivera', studentId: 'BSCC-20251142', dateOfBirth: '2004-03-14', email: 'student@test.edu', country: 'United States',
  city: 'Springfield', state: 'Massachusetts', idType: 'student_id', expectedGraduation: 2028, targetUniversity: 'Boston University', targetProgram: 'Computer Science',
};
const details: Record<string, Partial<DocCourse>> = {
  'CSC 220': { description: 'Data structures and program design: implementation and analysis of fundamental structures and the algorithms that use them.', outcomes: 'Implement lists, stacks, queues, trees and hash tables; analyse running time using Big-O notation; design object-oriented programs', topics: ['Arrays, linked lists, stacks and queues', 'Trees and binary search trees', 'Hash tables and sets', 'Sorting and searching algorithms', 'Algorithm efficiency and Big-O analysis'] },
  'CSC 240': { description: 'Discrete mathematics for computing: logic, proof techniques, counting and graphs.', outcomes: 'Construct proofs by induction; solve counting problems; model problems with graphs', topics: ['Propositional and predicate logic', 'Proof techniques and induction', 'Sets, relations and functions', 'Counting and combinatorics', 'Graphs and trees'] },
  'CIS 150': { description: 'Linear algebra: systems of equations, vector spaces, matrices and eigenvalues.', outcomes: 'Solve linear systems; compute determinants and eigenvalues; work in vector spaces', topics: ['Systems of linear equations', 'Matrices and determinants', 'Vector spaces and subspaces', 'Eigenvalues and eigenvectors'] },
};
const needSyllabus = new Set(Object.keys(details));

(async () => {
  const names: Record<string, string> = { BSCC: 'Bay State Community College', PVTC: 'Pioneer Valley Technical College' };
  const colleges = DEMO_TRANSCRIPTS.map((t) => ({
    institution: { name: names[t.institutionCode], code: t.institutionCode, calendar: t.institutionCode === 'PVTC' ? 'quarter' : 'semester' },
    courses: t.courses.map((c) => ({ ...c, ...details[c.code] }) as DocCourse),
  }));
  const docs = [
    ...(await buildStudentDocuments(maya, colleges, ['transcript', 'id_document', 'enrollment_letter'])),
    ...(await buildStudentDocuments(maya, colleges.map((c) => ({ ...c, courses: c.courses.filter((x) => needSyllabus.has(x.code)) })), ['syllabus'])),
  ];
  const reader = new RulesDocumentReader();
  for (const d of docs) {
    fs.writeFileSync(path.join(out, d.fileName), d.bytes);
    const r = await reader.read({ fileName: d.fileName, mimeType: 'application/pdf', bytes: d.bytes, userId: 'x' });
    const n = (r.extracted.fields as any).courses?.length;
    console.log(`${d.fileName.padEnd(38)} -> read as ${r.extracted.docType} (${Math.round(r.extracted.confidence * 100)}%)${n !== undefined ? `, ${n} courses` : ''}${r.extracted.docType === d.docType ? '' : '  <-- MISMATCH'}`);
  }
})();
