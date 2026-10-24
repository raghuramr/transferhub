import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, QueryInput } from '../database/database.service';
import * as sql from 'mssql';
import { SubmitTranscriptDto } from './dto/create-transcript.dto';

interface TranscriptCourseJoinRow {
  Id: string;
  CourseCode: string;
  CourseTitle: string;
  OriginalCredits: number;
  NormalisedCredits: number | null;
  Grade: string;
  GradeIsEligible: boolean | null;
  Term: string | null;
  Lane: string;
  Status: string;
  EvalId: string | null;
  EvalOutcome: string | null;
  AwardedCredits: number | null;
  DecidedBUCode: string | null;
  DecidedBUTitle: string | null;
}

interface TranscriptHeaderRow {
  Id: string;
  Status: string;
  ReceivedAt: Date;
  ProcessedAt: Date | null;
  Notes: string | null;
  InstitutionId: number;
  InstitutionCode: string;
  InstitutionName: string;
  Calendar: string | null;
  StudentName: string;
  StudentEmail: string;
}

interface TranscriptListRow {
  Id: string;
  Status: string;
  ReceivedAt: Date;
  InstitutionName: string;
  StudentName: string;
  CourseCount: number;
}

interface LaneRow {
  TranscriptId: string;
  Lane: string;
}

interface TriageResultRow {
  Lane?: string;
}

function mapCourseRow(r: TranscriptCourseJoinRow) {
  return {
    id: r.Id,
    courseCode: r.CourseCode,
    courseTitle: r.CourseTitle,
    originalCredits: r.OriginalCredits,
    normalisedCredits: r.NormalisedCredits,
    grade: r.Grade,
    gradeIsEligible: r.GradeIsEligible === null ? null : !!r.GradeIsEligible,
    term: r.Term,
    lane: r.Lane,
    status: r.Status,
    evaluation: r.EvalId
      ? {
          outcome: r.EvalOutcome,
          awardedCredits: r.AwardedCredits,
          decidedBUCourse: r.DecidedBUCode ? { code: r.DecidedBUCode, title: r.DecidedBUTitle } : null,
        }
      : null,
  };
}

@Injectable()
export class TranscriptsService {
  constructor(private db: DatabaseService) {}

  /** Finds the BU-side Institution row for a code, or creates a minimal one. */
  private async findOrCreateInstitution(code: string, name: string, calendar: string) {
    const existing = await this.db.query<{ Id: number }>(
      `SELECT Id FROM Institutions WHERE Code = @code`,
      [{ name: 'code', type: sql.VarChar(20), value: code }],
    );
    if (existing.recordset[0]) return existing.recordset[0].Id;

    const inserted = await this.db.query<{ Id: number }>(
      `INSERT INTO Institutions (Code, Name, Calendar, Type, IsBU, IsActive)
       OUTPUT inserted.Id
       VALUES (@code, @name, @calendar, 'university', 0, 1)`,
      [
        { name: 'code', type: sql.VarChar(20), value: code },
        { name: 'name', type: sql.NVarChar(200), value: name },
        { name: 'calendar', type: sql.VarChar(10), value: calendar },
      ],
    );
    return inserted.recordset[0].Id;
  }

  /** Finds the catalog Course row matching this institution + code, or creates a minimal one. */
  private async findOrCreateExternalCourse(institutionId: number, code: string, title: string, credits: number) {
    const existing = await this.db.query<{ Id: number }>(
      `SELECT Id FROM Courses WHERE InstitutionId = @instId AND Code = @code`,
      [
        { name: 'instId', type: sql.Int, value: institutionId },
        { name: 'code', type: sql.NVarChar(30), value: code },
      ],
    );
    if (existing.recordset[0]) return existing.recordset[0].Id;

    const inserted = await this.db.query<{ Id: number }>(
      `INSERT INTO Courses (InstitutionId, Code, Title, Credits, IsActive)
       OUTPUT inserted.Id
       VALUES (@instId, @code, @title, @credits, 1)`,
      [
        { name: 'instId', type: sql.Int, value: institutionId },
        { name: 'code', type: sql.NVarChar(30), value: code },
        { name: 'title', type: sql.NVarChar(300), value: title },
        { name: 'credits', type: sql.Decimal(5, 2), value: credits },
      ],
    );
    return inserted.recordset[0].Id;
  }

  /**
   * Combined submit: find-or-create the institution, create the transcript,
   * insert every course, then run the sp_TriageCourse business-rules engine
   * on each one (grade eligibility, credit normalisation, equivalency
   * lookup). Courses that still need a human look get a queued Evaluation.
   */
  async submit(dto: SubmitTranscriptDto, submittedByUserId: string) {
    const institutionId = await this.findOrCreateInstitution(
      dto.institutionCode.toUpperCase(),
      dto.institutionName,
      dto.calendar,
    );

    const notesParts: string[] = [];
    if (dto.studentName) notesParts.push(`Student name on file: ${dto.studentName}`);
    if (dto.studentId) notesParts.push(`Student ID on file: ${dto.studentId}`);
    if (dto.notes) notesParts.push(dto.notes);

    const transcriptRes = await this.db.query<{ Id: string }>(
      `INSERT INTO Transcripts (StudentUserId, SubmittedById, InstitutionId, Status, Notes)
       OUTPUT inserted.Id
       VALUES (@student, @submitter, @instId, 'received', @notes)`,
      [
        { name: 'student', type: sql.UniqueIdentifier, value: submittedByUserId },
        { name: 'submitter', type: sql.UniqueIdentifier, value: submittedByUserId },
        { name: 'instId', type: sql.Int, value: institutionId },
        { name: 'notes', type: sql.NVarChar(sql.MAX), value: notesParts.join(' | ') || null },
      ],
    );
    const transcriptId = transcriptRes.recordset[0].Id;

    for (const course of dto.courses) {
      const externalCourseId = await this.findOrCreateExternalCourse(
        institutionId,
        course.courseCode,
        course.courseTitle,
        course.originalCredits,
      );

      const tcRes = await this.db.query<{ Id: string }>(
        `INSERT INTO TranscriptCourses
            (TranscriptId, CourseCode, CourseTitle, ExternalCourseId, OriginalCredits, Grade, Term)
         OUTPUT inserted.Id
         VALUES (@tid, @code, @title, @extId, @credits, @grade, @term)`,
        [
          { name: 'tid', type: sql.UniqueIdentifier, value: transcriptId },
          { name: 'code', type: sql.NVarChar(50), value: course.courseCode },
          { name: 'title', type: sql.NVarChar(300), value: course.courseTitle },
          { name: 'extId', type: sql.Int, value: externalCourseId },
          { name: 'credits', type: sql.Decimal(5, 2), value: course.originalCredits },
          { name: 'grade', type: sql.NVarChar(10), value: course.grade },
          { name: 'term', type: sql.NVarChar(50), value: course.term || null },
        ],
      );
      const transcriptCourseId = tcRes.recordset[0].Id;

      const triageRes = await this.db.execute<TriageResultRow>('sp_TriageCourse', [
        { name: 'TranscriptCourseId', type: sql.UniqueIdentifier, value: transcriptCourseId },
        { name: 'TriagedBy', type: sql.UniqueIdentifier, value: submittedByUserId },
      ]);
      const lane = triageRes.recordset[0]?.Lane ?? 'needs_syllabus';

      // Courses the rules engine can't resolve on its own go to the faculty queue.
      if (lane === 'needs_syllabus') {
        await this.db.query(
          `INSERT INTO Evaluations (TranscriptCourseId, Status) VALUES (@tcId, 'queued')`,
          [{ name: 'tcId', type: sql.UniqueIdentifier, value: transcriptCourseId }],
        );
      }
    }

    await this.db.query(
      `UPDATE Transcripts SET Status = 'processing' WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: transcriptId }],
    );

    return this.findById(transcriptId);
  }

  async findById(id: string) {
    const res = await this.db.query<TranscriptHeaderRow>(
      `SELECT t.Id, t.Status, t.ReceivedAt, t.ProcessedAt, t.Notes,
              i.Id AS InstitutionId, i.Code AS InstitutionCode, i.Name AS InstitutionName, i.Calendar,
              u.FirstName + ' ' + u.LastName AS StudentName, u.Email AS StudentEmail
       FROM Transcripts t
       JOIN Institutions i ON i.Id = t.InstitutionId
       JOIN Users u        ON u.Id = t.StudentUserId
       WHERE t.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Transcript not found');
    const t = res.recordset[0];

    const courses = await this.db.query<TranscriptCourseJoinRow>(
      `SELECT tc.Id, tc.CourseCode, tc.CourseTitle, tc.OriginalCredits, tc.NormalisedCredits,
              tc.Grade, tc.GradeIsEligible, tc.Term, tc.Lane, tc.Status,
              e.Id AS EvalId, e.Outcome AS EvalOutcome, e.AwardedCredits,
              bu.Code AS DecidedBUCode, bu.Title AS DecidedBUTitle
       FROM TranscriptCourses tc
       LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
       LEFT JOIN Courses bu    ON bu.Id = e.DecidedBUCourseId
       WHERE tc.TranscriptId = @id
       ORDER BY tc.SortOrder, tc.CourseCode`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );

    return {
      id: t.Id,
      status: t.Status,
      receivedAt: t.ReceivedAt,
      processedAt: t.ProcessedAt,
      notes: t.Notes,
      studentName: t.StudentName,
      studentEmail: t.StudentEmail,
      institution: {
        id: t.InstitutionId,
        code: t.InstitutionCode,
        name: t.InstitutionName,
        calendar: t.Calendar,
      },
      courses: courses.recordset.map(mapCourseRow),
    };
  }

  /**
   * No rows in UserScopeUniversities for this user = unrestricted (sees
   * everything) — must remain the default. Returns null when unrestricted,
   * or the list of InstitutionIds the user is scoped to otherwise.
   */
  private async getUniversityScope(userId?: string): Promise<number[] | null> {
    if (!userId) return null;
    const res = await this.db.query<{ InstitutionId: number }>(
      `SELECT InstitutionId FROM UserScopeUniversities WHERE UserId = @uid`,
      [{ name: 'uid', type: sql.UniqueIdentifier, value: userId }],
    );
    return res.recordset.length ? res.recordset.map((r) => r.InstitutionId) : null;
  }

  async findAll(filters: { studentUserId?: string; submittedByUserId?: string; status?: string; requestingUserId?: string } = {}) {
    let where = '1=1';
    const inputs: QueryInput[] = [];

    if (filters.studentUserId) {
      where += ' AND t.StudentUserId = @sid';
      inputs.push({ name: 'sid', type: sql.UniqueIdentifier, value: filters.studentUserId });
    }
    if (filters.submittedByUserId) {
      where += ' AND t.SubmittedById = @subId';
      inputs.push({ name: 'subId', type: sql.UniqueIdentifier, value: filters.submittedByUserId });
    }
    if (filters.status) {
      where += ' AND t.Status = @status';
      inputs.push({ name: 'status', type: sql.VarChar(20), value: filters.status });
    }

    const scope = await this.getUniversityScope(filters.requestingUserId);
    if (scope) {
      const scopeParams = scope.map((instId, i) => {
        const name = `scopeInst${i}`;
        inputs.push({ name, type: sql.Int, value: instId });
        return `@${name}`;
      });
      where += ` AND t.InstitutionId IN (${scopeParams.join(', ')})`;
    }

    const res = await this.db.query<TranscriptListRow>(
      `SELECT t.Id, t.Status, t.ReceivedAt,
              i.Name AS InstitutionName,
              u.FirstName + ' ' + u.LastName AS StudentName,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id) AS CourseCount
       FROM Transcripts t
       JOIN Institutions i ON i.Id = t.InstitutionId
       JOIN Users u        ON u.Id = t.StudentUserId
       WHERE ${where}
       ORDER BY t.ReceivedAt DESC`,
      inputs,
    );

    const transcripts = res.recordset;
    if (transcripts.length === 0) return [];

    // Batch-load lanes for every transcript so the dashboard can show
    // per-lane counts without an N+1 query per row.
    const laneRes = await this.db.query<LaneRow>(
      `SELECT tc.TranscriptId, tc.Lane
       FROM TranscriptCourses tc
       JOIN Transcripts t ON t.Id = tc.TranscriptId
       WHERE ${where}`,
      inputs,
    );
    const lanesByTranscript = new Map<string, { lane: string }[]>();
    for (const row of laneRes.recordset) {
      const list = lanesByTranscript.get(row.TranscriptId) ?? [];
      list.push({ lane: row.Lane });
      lanesByTranscript.set(row.TranscriptId, list);
    }

    return transcripts.map((t) => ({
      id: t.Id,
      status: t.Status,
      receivedAt: t.ReceivedAt,
      institution: { name: t.InstitutionName },
      studentName: t.StudentName,
      courseCount: t.CourseCount,
      courses: lanesByTranscript.get(t.Id) ?? [],
    }));
  }

  async updateStatus(id: string, status: string, reviewedBy: string) {
    await this.db.query(
      `UPDATE Transcripts SET Status = @status, ProcessedBy = @by, ProcessedAt = SYSUTCDATETIME() WHERE Id = @id`,
      [
        { name: 'status', type: sql.VarChar(20), value: status },
        { name: 'by', type: sql.UniqueIdentifier, value: reviewedBy },
        { name: 'id', type: sql.UniqueIdentifier, value: id },
      ],
    );
    return this.findById(id);
  }
}
