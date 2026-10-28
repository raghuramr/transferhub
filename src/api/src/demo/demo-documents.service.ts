import { BadRequestException, Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { createHash } from 'crypto';
import { DatabaseService } from '../database/database.service';
import {
  buildStudentDocuments, safeName, zip, DEMO_DOC_KINDS,
  type DemoDocKind, type DocCollegeRecord, type DocCourse, type DocStudent, type GeneratedDoc,
} from './demo-documents';

const MAX_STUDENTS = 25;
const hashInt = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);

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

  private async load(userId: string): Promise<{ student: DocStudent; colleges: DocCollegeRecord[] } | null> {
    const u = (await this.db.query(
      `SELECT u.Id, u.FirstName, u.LastName, u.Email, u.StudentId, u.City, u.State, u.CountryOfOrigin, u.Country,
              sp.PriorInstitutionName, sp.IsNativeEnglish, sp.EnglishTestType, sp.EnglishTestScore, sp.GraduationYear, sp.TargetInstitutionId,
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
      idType: international ? 'passport' : 'student_id',
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
    let colleges = [...byInst.values()];
    if (!colleges.length && u.PriorInstitutionName) colleges = [{ institution: { name: u.PriorInstitutionName, code: 'PRIOR' }, courses: [] }];
    return { student, colleges };
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
    let single: GeneratedDoc | null = null;
    for (const id of ids) {
      const d = await this.load(id);
      if (!d) { notes.push(`Student ${id}: not found`); continue; }
      const who = `${d.student.firstName} ${d.student.lastName}`;
      const withCourses = d.colleges.filter((c) => c.courses.length);
      const docs = await buildStudentDocuments(d.student, withCourses.length ? withCourses : d.colleges, chosen);
      if (chosen.includes('transcript') && !withCourses.length) notes.push(`${who}: no submitted coursework on file, so no transcript or syllabi were made`);
      if (chosen.includes('english_test') && !d.student.english) notes.push(`${who}: native English speaker, no English test report`);
      if (!docs.length) continue;
      single = docs.length === 1 && ids.length === 1 ? docs[0] : null;
      for (const g of docs) files.push({ path: `${safeName(who) || 'student'}/${g.fileName}`, bytes: g.bytes });
      notes.push(`${who}: ${docs.length} file(s) - ${[...new Set(docs.map((x) => x.docType))].join(', ')}`);
    }
    if (!files.length) throw new BadRequestException(`Nothing to generate. ${notes.join(' | ')}`);
    if (single) return { fileName: single.fileName, mime: 'application/pdf', bytes: single.bytes };
    files.push({ path: 'README.txt', bytes: Buffer.from(`Demo documents generated by TransferHub (synthetic, for testing Smart Upload).\n\n${notes.join('\n')}\n`) });
    return { fileName: ids.length === 1 ? `${safeName(notes.length ? files[0].path.split('/')[0] : 'Student')} - Demo documents.zip` : 'Demo documents.zip', mime: 'application/zip', bytes: zip(files) };
  }
}
