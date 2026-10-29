import { BadRequestException, Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { createHash } from 'crypto';
import { DatabaseService } from '../database/database.service';
import {
  buildStudentDocuments, safeName, syntheticCollege, syntheticCourses, zip, DEMO_DOC_KINDS,
  type DemoDocKind, type DocCollegeRecord, type DocCourse, type DocStudent, type GeneratedDoc,
} from './demo-documents';

const MAX_STUDENTS = 25;
const MAX_MANUAL_COURSES = 40;
const hashInt = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);

/** What the "type the details" form posts. Everything but the name is optional - gaps are filled deterministically. */
export interface ManualDocRequest {
  kinds?: DemoDocKind[];
  student?: {
    firstName?: string; lastName?: string; email?: string; studentId?: string; dateOfBirth?: string;
    country?: string; city?: string; state?: string; idType?: DocStudent['idType']; passportNumber?: string;
    program?: string; expectedGraduation?: number | string; targetUniversity?: string; targetProgram?: string;
    english?: { type?: string; total?: string; r?: string; l?: string; s?: string; w?: string } | null;
  };
  institution?: { name?: string; code?: string; calendar?: string; school?: string };
  courses?: { code?: string; title?: string; credits?: number | string; grade?: string; term?: string; description?: string; outcomes?: string; topics?: string[] | string }[];
}

/** Sample documents for any student in the database, built from that student's own records (super admin demo tool). */
@Injectable()
export class DemoDocumentsService {
  constructor(private db: DatabaseService) {}

  kinds() {
    return DEMO_DOC_KINDS;
  }

  async listStudents(q?: string) {
    const term = (q ?? '').trim();
    const r = await this.db.query(
      `SELECT TOP 1000 u.Id, u.FirstName, u.LastName, u.Email, u.StudentId,
              (SELECT COUNT(*) FROM Transcripts t WHERE t.StudentUserId = u.Id) AS Requests,
              (SELECT COUNT(*) FROM Transcripts t JOIN TranscriptCourses c ON c.TranscriptId = t.Id WHERE t.StudentUserId = u.Id) AS CourseCount,
              (SELECT TOP 1 i.Name FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId WHERE t.StudentUserId = u.Id ORDER BY t.ReceivedAt) AS FromCollege,
              ti.Name AS TargetUniversity
       FROM Users u JOIN Roles ro ON ro.Id = u.RoleId AND ro.Name = 'student'
       LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id LEFT JOIN Institutions ti ON ti.Id = sp.TargetInstitutionId
       WHERE u.IsActive = 1 AND (@q = '' OR u.FirstName LIKE @like OR u.LastName LIKE @like OR u.Email LIKE @like OR u.StudentId LIKE @like
             OR CONCAT(u.FirstName, ' ', u.LastName) LIKE @like)
       ORDER BY CASE WHEN u.Email = 'student@test.edu' THEN 0 ELSE 1 END, CourseCount DESC, u.LastName, u.FirstName`,
      [{ name: 'q', type: sql.NVarChar(100), value: term }, { name: 'like', type: sql.NVarChar(120), value: `%${term}%` }],
    );
    return r.recordset.map((x: any) => ({
      id: x.Id, name: `${x.FirstName} ${x.LastName}`, email: x.Email, studentId: x.StudentId, requests: x.Requests, courses: x.CourseCount,
      fromCollege: x.FromCollege, targetUniversity: x.TargetUniversity,
    }));
  }

  private async load(userId: string): Promise<{ student: DocStudent; colleges: DocCollegeRecord[]; notes: string[] } | null> {
    const u = (await this.db.query(
      `SELECT u.Id, u.FirstName, u.LastName, u.Email, u.StudentId, u.City, u.State, u.CountryOfOrigin, u.Country,
              sp.PriorInstitutionName, sp.FieldOfStudy, sp.IsNativeEnglish, sp.EnglishTestType, sp.EnglishTestScore, sp.GraduationYear, sp.TargetInstitutionId,
              ti.Name AS TargetName, tp.Name AS TargetProgram
       FROM Users u LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id
       LEFT JOIN Institutions ti ON ti.Id = sp.TargetInstitutionId LEFT JOIN Programs tp ON tp.Id = sp.TargetProgramId
       WHERE u.Id = @id`, [{ name: 'id', type: sql.UniqueIdentifier, value: userId }])).recordset[0];
    if (!u) return null;
    const h = hashInt(String(u.Id));
    const origin: string = u.CountryOfOrigin || u.Country || 'United States';
    const international = !/^(united states|usa|us)$/i.test(origin);
    const nativeEnglish = u.IsNativeEnglish === null || u.IsNativeEnglish === undefined ? !international : !!u.IsNativeEnglish;
    const testType: 'TOEFL' | 'IELTS' = String(u.EnglishTestType || '').toUpperCase() === 'IELTS' ? 'IELTS' : 'TOEFL';
    const ielts = testType === 'IELTS';
    const total = u.EnglishTestScore ? String(u.EnglishTestScore) : ielts ? '7.0' : String(88 + (h % 25));
    const sub = (k: number) => (ielts ? (6.5 + ((h >> k) % 3) * 0.5).toFixed(1) : String(22 + ((h >> k) % 6)));
    const student: DocStudent = {
      firstName: u.FirstName, lastName: u.LastName, email: u.Email,
      studentId: u.StudentId || (international ? `P${String(7000000 + (h % 999999)).padStart(8, '0')}` : `SID-${String(h % 10000000).padStart(7, '0')}`),
      dateOfBirth: `${2001 + (h % 5)}-${String(1 + ((h >> 3) % 12)).padStart(2, '0')}-${String(1 + ((h >> 7) % 28)).padStart(2, '0')}`,
      country: origin, city: u.City ?? undefined, state: u.State ?? undefined,
      idType: international ? 'passport' : 'student_id', program: u.FieldOfStudy ?? undefined,
      expectedGraduation: u.GraduationYear ?? undefined, targetUniversity: u.TargetName ?? undefined, targetProgram: u.TargetProgram ?? undefined,
      english: nativeEnglish ? undefined : { type: testType, total, r: sub(1), l: sub(2), s: sub(3), w: sub(4) },
    };

    const rows = (await this.db.query(
      `SELECT t.InstitutionId, i.Name AS InstName, i.Code AS InstCode, i.Calendar, c.CourseCode, c.CourseTitle, c.OriginalCredits, c.Grade, c.Term,
              co.Description, co.LearningOutcomes, c.ExternalCourseId,
              (SELECT STRING_AGG(ct.Title, '|') WITHIN GROUP (ORDER BY ct.SortOrder) FROM CourseTopics ct WHERE ct.CourseId = c.ExternalCourseId) AS Topics
       FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId JOIN TranscriptCourses c ON c.TranscriptId = t.Id
       LEFT JOIN Courses co ON co.Id = c.ExternalCourseId
       WHERE t.StudentUserId = @id ORDER BY t.ReceivedAt, c.SortOrder, c.CourseCode`, [{ name: 'id', type: sql.UniqueIdentifier, value: userId }])).recordset;
    const byInst = new Map<number, DocCollegeRecord>();
    const seen = new Set<string>();
    for (const x of rows) {
      let rec = byInst.get(x.InstitutionId);
      if (!rec) byInst.set(x.InstitutionId, (rec = { institution: { name: x.InstName, code: x.InstCode, calendar: x.Calendar }, courses: [] }));
      const key = `${x.InstitutionId}|${x.CourseCode}|${x.Term}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let outcomes: string | undefined = x.LearningOutcomes ?? undefined;
      if (outcomes && outcomes.trim().startsWith('[')) {
        try { outcomes = (JSON.parse(outcomes) as string[]).join('; '); } catch { /* keep text */ }
      }
      const course: DocCourse = {
        code: x.CourseCode, title: x.CourseTitle, credits: Number(x.OriginalCredits), grade: x.Grade, term: x.Term || 'Term not stated',
        description: x.Description ?? undefined, outcomes, topics: x.Topics ? String(x.Topics).split('|') : undefined,
      };
      rec.courses.push(course);
    }
    // Nothing is skipped for want of data: a student with no transcript on file gets a plausible sending college and
    // coursework, derived from their own name so the same person always gets the same records. Said so in the README.
    const notes: string[] = [];
    const field = student.program ?? student.targetProgram;
    let colleges = [...byInst.values()].filter((c) => c.courses.length);
    if (!colleges.length) {
      colleges = [syntheticCollege(student, u.PriorInstitutionName || undefined, { field })];
      notes.push(`no coursework on file, so the transcript and syllabi use made-up courses at ${colleges[0].institution.name}`);
    } else {
      for (const c of colleges) {
        if (c.courses.length) continue;
        c.courses = syntheticCourses(`${student.firstName}${student.lastName}${student.studentId}${c.institution.code}`, { field });
        notes.push(`${c.institution.name} had no course rows, so sample courses were used`);
      }
    }
    if (!student.english) notes.push('no English test on file, so the score report is a sample derived from the name');
    if (!u.StudentId) notes.push('no student ID on file, so one was derived from the name');
    return { student, colleges, notes };
  }

  /** Returns one PDF (single document) or a ZIP (several), with a README listing what was generated and what was skipped. */
  async generate(userIds: string[], kinds: DemoDocKind[]) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) throw new BadRequestException('Select at least one student.');
    if (ids.length > MAX_STUDENTS) throw new BadRequestException(`Select at most ${MAX_STUDENTS} students at a time.`);
    const valid = DEMO_DOC_KINDS.map((k) => k.kind);
    const chosen = kinds.filter((k) => valid.includes(k));
    if (!chosen.length) throw new BadRequestException('Select at least one document type.');

    const files: { path: string; bytes: Buffer }[] = [];
    const notes: string[] = [];
    const skipped: string[] = [];
    let single: GeneratedDoc | null = null;
    for (const id of ids) {
      const d = await this.load(id);
      if (!d) { skipped.push(`Student ${id}: not found, nothing generated`); continue; }
      const who = `${d.student.firstName} ${d.student.lastName}`;
      const docs = await buildStudentDocuments(d.student, d.colleges, chosen);
      if (!docs.length) { skipped.push(`${who}: nothing could be generated`); continue; }
      single = docs.length === 1 && ids.length === 1 ? docs[0] : null;
      for (const g of docs) files.push({ path: `${safeName(who) || 'student'}/${g.fileName}`, bytes: g.bytes });
      notes.push(`${who}: ${docs.length} file(s) - ${[...new Set(docs.map((x) => x.docType))].join(', ')}`);
      for (const n of d.notes) notes.push(`   note - ${who}: ${n}`);
    }
    if (!files.length) throw new BadRequestException(`Nothing to generate. ${skipped.join(' | ')}`);
    if (single) return { fileName: single.fileName, mime: 'application/pdf', bytes: single.bytes };
    files.push({ path: 'README.txt', bytes: Buffer.from(readme(notes, skipped)) });
    return { fileName: ids.length === 1 ? `${safeName(files[0].path.split('/')[0])} - Demo documents.zip` : 'Demo documents.zip', mime: 'application/zip', bytes: zip(files) };
  }

  /** What the manual form must still be told before it can generate the ticked kinds (empty = good to go). */
  validateManual(body: ManualDocRequest): { missing: string[]; kinds: DemoDocKind[] } {
    const valid = DEMO_DOC_KINDS.map((k) => k.kind);
    const kinds = (Array.isArray(body?.kinds) ? body.kinds : []).filter((k) => valid.includes(k));
    const st = body?.student ?? {};
    const missing: string[] = [];
    if (!kinds.length) missing.push('Pick at least one document type.');
    if (!String(st.firstName ?? '').trim()) missing.push('First name is required.');
    if (!String(st.lastName ?? '').trim()) missing.push('Last name is required.');
    const needsInstitution = kinds.some((k) => k === 'transcript' || k === 'syllabus' || k === 'enrollment_letter');
    if (needsInstitution && !String(body?.institution?.name ?? '').trim()) {
      missing.push('University / college name is required for a transcript, syllabi or an enrolment letter.');
    }
    const rows = Array.isArray(body?.courses) ? body.courses : [];
    const usable = rows.filter((c) => String(c?.code ?? '').trim() && String(c?.title ?? '').trim());
    if (kinds.some((k) => k === 'transcript' || k === 'syllabus')) {
      if (!rows.length) missing.push('Add at least one course for a transcript or syllabi.');
      else if (!usable.length) missing.push('Every course needs a code and a title.');
      else if (usable.length < rows.length) missing.push(`${rows.length - usable.length} course row(s) have no code or title and will be left out.`);
    }
    if (rows.length > MAX_MANUAL_COURSES) missing.push(`At most ${MAX_MANUAL_COURSES} courses at a time.`);
    const dob = String(st.dateOfBirth ?? '').trim();
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) missing.push('Date of birth must be yyyy-mm-dd.');
    return { missing, kinds };
  }

  /** Same renderers, but from details typed into the form - no student record needed. */
  async generateManual(body: ManualDocRequest) {
    const { missing, kinds } = this.validateManual(body);
    const blocking = missing.filter((m) => !m.includes('will be left out'));
    if (blocking.length) throw new BadRequestException(blocking.join(' '));

    const st = body.student ?? {};
    const first = String(st.firstName).trim();
    const last = String(st.lastName).trim();
    const h = hashInt(`${first} ${last}`);
    const country = String(st.country ?? '').trim() || 'United States';
    const idType: DocStudent['idType'] = ['passport', 'student_id', 'national_id', 'other'].includes(String(st.idType))
      ? (st.idType as DocStudent['idType'])
      : /^(united states|usa|us)$/i.test(country) ? 'student_id' : 'passport';
    const e = st.english ?? undefined;
    const gradYear = Number(st.expectedGraduation);
    const student: DocStudent = {
      firstName: first, lastName: last,
      email: String(st.email ?? '').trim() || `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.edu',
      studentId: String(st.studentId ?? '').trim() || `SID-${String(h % 10000000).padStart(7, '0')}`,
      dateOfBirth: String(st.dateOfBirth ?? '').trim() || `${2001 + (h % 5)}-${String(1 + ((h >> 3) % 12)).padStart(2, '0')}-${String(1 + ((h >> 7) % 28)).padStart(2, '0')}`,
      country, city: String(st.city ?? '').trim() || undefined, state: String(st.state ?? '').trim() || undefined,
      idType, passportNumber: String(st.passportNumber ?? '').trim() || undefined,
      program: String(st.program ?? '').trim() || undefined,
      expectedGraduation: Number.isFinite(gradYear) && gradYear > 1900 ? gradYear : undefined,
      targetUniversity: String(st.targetUniversity ?? '').trim() || undefined,
      targetProgram: String(st.targetProgram ?? '').trim() || undefined,
      english: e && (e.total || e.r || e.l || e.s || e.w)
        ? {
          type: String(e.type ?? '').toUpperCase() === 'IELTS' ? 'IELTS' : 'TOEFL',
          total: String(e.total ?? '').trim() || '0', r: String(e.r ?? '').trim() || '0', l: String(e.l ?? '').trim() || '0',
          s: String(e.s ?? '').trim() || '0', w: String(e.w ?? '').trim() || '0',
        }
        : undefined,
    };

    const instName = String(body.institution?.name ?? '').trim();
    const courses: DocCourse[] = (body.courses ?? [])
      .filter((c) => String(c?.code ?? '').trim() && String(c?.title ?? '').trim())
      .slice(0, MAX_MANUAL_COURSES)
      .map((c, i) => {
        const credits = Number(c.credits);
        const topics = Array.isArray(c.topics) ? c.topics : String(c.topics ?? '').split(/\r?\n|\|/);
        return {
          code: String(c.code).trim(), title: String(c.title).trim(),
          credits: Number.isFinite(credits) && credits > 0 ? credits : 3,
          grade: String(c.grade ?? '').trim() || 'A-',
          term: String(c.term ?? '').trim() || `Fall ${2024 + (i % 2)}`,
          description: String(c.description ?? '').trim() || undefined,
          outcomes: String(c.outcomes ?? '').trim() || undefined,
          topics: topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) || undefined,
        } as DocCourse;
      });

    const notes: string[] = [];
    let colleges: DocCollegeRecord[] = [];
    if (instName) {
      colleges = [{ institution: { name: instName, code: String(body.institution?.code ?? '').trim() || instName.replace(/\b(of|the|and|at)\b/gi, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 4) || 'UNI', calendar: String(body.institution?.calendar ?? '') === 'quarter' ? 'quarter' : 'semester', school: String(body.institution?.school ?? '').trim() || undefined }, courses }];
      if (!courses.length) {
        colleges[0].courses = syntheticCourses(`${first}${last}${instName}`, { field: student.program ?? student.targetProgram });
        notes.push('no courses were typed in, so sample courses were used on the transcript and syllabi');
      }
    } else {
      notes.push('no university was typed in, so a sample sending college was used');
    }
    if (!student.english) notes.push('no English test scores were typed in, so the score report uses sample scores derived from the name');
    if (!String(st.dateOfBirth ?? '').trim()) notes.push('no date of birth was typed in, so one was derived from the name');

    const docs = await buildStudentDocuments(student, colleges, kinds);
    if (!docs.length) throw new BadRequestException('Nothing to generate for those details.');
    const who = safeName(`${first} ${last}`) || 'Student';
    if (docs.length === 1) return { fileName: docs[0].fileName, mime: 'application/pdf', bytes: docs[0].bytes };
    const files = docs.map((g) => ({ path: `${who}/${g.fileName}`, bytes: g.bytes }));
    files.push({ path: 'README.txt', bytes: Buffer.from(readme([`${who}: ${docs.length} file(s) - ${[...new Set(docs.map((x) => x.docType))].join(', ')}`, ...notes.map((n) => `   note - ${who}: ${n}`)], missing.filter((m) => m.includes('will be left out')))) });
    return { fileName: `${who} - Demo documents.zip`, mime: 'application/zip', bytes: zip(files) };
  }
}

function readme(notes: string[], skipped: string[]): string {
  return [
    'Demo documents generated by TransferHub (synthetic, for testing Smart Upload).',
    '',
    ...notes,
    '',
    skipped.length ? `Skipped:\n${skipped.join('\n')}` : 'Nothing was skipped.',
    '',
  ].join('\n');
}
