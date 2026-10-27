import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService, QueryInput } from '../database/database.service';
import * as sql from 'mssql';
import { SubmitTranscriptDto } from './dto/create-transcript.dto';
import { EmailService } from '../common/email.service';
import { UploadsService } from '../uploads/uploads.service';
import { ScopeService } from '../policy/scope.service';
import { TransferPolicyService, parseFlags } from '../policy/transfer-policy.service';
import { SchemaService } from '../policy/schema.service';
import { WorkflowEngineService } from '../requests/workflow-engine.service';

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
  OriginalFileName: string | null;
  StudentUserId: string;
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
  constructor(
    private db: DatabaseService,
    private emailService: EmailService,
    private uploadsService: UploadsService,
    private scopeService: ScopeService,
    private workflowEngine: WorkflowEngineService,
    private policy: TransferPolicyService,
    private schema: SchemaService,
  ) {}
  private readonly logger = new Logger(TranscriptsService.name);

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
  async submit(dto: SubmitTranscriptDto, submittedByUserId: string, submittedByRole: string) {
    const institutionId = await this.findOrCreateInstitution(
      dto.institutionCode.toUpperCase(),
      dto.institutionName,
      dto.calendar,
    );

    const notesParts: string[] = [];
    if (dto.studentName) notesParts.push(`Student name on file: ${dto.studentName}`);
    if (dto.studentId) notesParts.push(`Student ID on file: ${dto.studentId}`);
    if (dto.notes) notesParts.push(dto.notes);

    // The uploaded document is optional — re-verifies ownership via the same
    // check GET /uploads/:id uses, so a documentUploadId can't be used to
    // attach someone else's file to this transcript.
    let fileStoragePath: string | null = null;
    let originalFileName: string | null = null;
    if (dto.documentUploadId) {
      const upload = await this.uploadsService.getForAuthenticatedUser(dto.documentUploadId, {
        id: submittedByUserId,
        role: submittedByRole,
      });
      fileStoragePath = upload.blobName;
      originalFileName = upload.fileName;
    }

    // Per-course syllabus attachments: ownership is re-checked up front (before anything is written), so a
    // syllabusUploadId can never attach someone else's file. Optional and independent of the transcript upload.
    const syllabusUploads = new Map<number, { id: string; blobName: string; fileName: string }>();
    for (let i = 0; i < dto.courses.length; i++) {
      const sid = dto.courses[i].syllabusUploadId;
      if (!sid) continue;
      const up = await this.uploadsService.getForAuthenticatedUser(sid, { id: submittedByUserId, role: submittedByRole });
      syllabusUploads.set(i, { id: sid, blobName: up.blobName, fileName: up.fileName });
    }

    const transcriptRes = await this.db.query<{ Id: string }>(
      `INSERT INTO Transcripts (StudentUserId, SubmittedById, InstitutionId, Status, Notes, FileStoragePath, OriginalFileName)
       OUTPUT inserted.Id
       VALUES (@student, @submitter, @instId, 'received', @notes, @filePath, @fileName)`,
      [
        { name: 'student', type: sql.UniqueIdentifier, value: submittedByUserId },
        { name: 'submitter', type: sql.UniqueIdentifier, value: submittedByUserId },
        { name: 'instId', type: sql.Int, value: institutionId },
        { name: 'notes', type: sql.NVarChar(sql.MAX), value: notesParts.join(' | ') || null },
        { name: 'filePath', type: sql.NVarChar(500), value: fileStoragePath },
        { name: 'fileName', type: sql.NVarChar(300), value: originalFileName },
      ],
    );
    const transcriptId = transcriptRes.recordset[0].Id;

    // Preview (not yet admitted), official, or pre-approval (current BU student) - BU never evaluates before admission.
    const policyReady = await this.schema.policyReady();
    const kind = policyReady ? await this.evaluationKindFor(submittedByUserId) : 'official';
    if (policyReady && kind !== 'official') {
      await this.db.query(`UPDATE Transcripts SET EvaluationKind = @k WHERE Id = @id`, [
        { name: 'k', type: sql.VarChar(12), value: kind },
        { name: 'id', type: sql.UniqueIdentifier, value: transcriptId },
      ]);
    }

    for (const [courseIndex, course] of dto.courses.entries()) {
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
      await this.attachSyllabus(transcriptId, transcriptCourseId, submittedByUserId, syllabusUploads.get(courseIndex) ?? null, course.catalogUrl ?? null);
      if (policyReady) {
        await this.db.query(
          `UPDATE TranscriptCourses SET TermSeason = @ts, TermYear = @ty, GradingBasis = @gb, DeliveryMode = @dm, CourseType = @ct, IsOutsideUS = @os
           WHERE Id = @id`,
          [
            { name: 'ts', type: sql.VarChar(10), value: course.termSeason ?? null },
            { name: 'ty', type: sql.Int, value: course.termYear ?? null },
            { name: 'gb', type: sql.VarChar(10), value: course.gradingBasis ?? null },
            { name: 'dm', type: sql.VarChar(10), value: course.deliveryMode ?? null },
            { name: 'ct', type: sql.VarChar(16), value: course.courseType ?? null },
            { name: 'os', type: sql.Bit, value: dto.isOutsideUS || course.isOutsideUS ? 1 : 0 },
            { name: 'id', type: sql.UniqueIdentifier, value: transcriptCourseId },
          ],
        );
      }

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

    // BU policy on top of the triage result (P/F, minimum grade, age, accreditation, cap, intl...).
    try {
      await this.policy.applyToTranscript(transcriptId);
    } catch (err) {
      this.logger.warn(`Request ${transcriptId}: transfer policy check failed: ${(err as Error).message}`);
    }

    // A preview is finished as soon as the rules have run; it becomes official when the student is admitted.
    await this.db.query(
      `UPDATE Transcripts SET Status = @s WHERE Id = @id`,
      [
        { name: 's', type: sql.VarChar(20), value: kind === 'preview' ? 'complete' : 'processing' },
        { name: 'id', type: sql.UniqueIdentifier, value: transcriptId },
      ],
    );

    // Hand the request to the intaking university's approval workflow. Never let a workflow problem
    // (e.g. migration 013 not applied yet) fail a submission that has already been saved.
    if (kind !== 'preview') {
      try {
        await this.workflowEngine.startWorkflow(transcriptId, submittedByUserId);
      } catch (err) {
        this.logger.warn(`Request ${transcriptId} saved but workflow did not start: ${(err as Error).message}`);
      }
    }

    return this.findById(transcriptId);
  }

  /**
   * Links an optional per-course syllabus (uploaded file and/or catalogue URL). Never fails a submission.
   * - the file is recorded as a 'syllabus' TranscriptDocument, which is exactly what the document checklist
   *   counts (documentChecklist: per-course syllabi), so no workflow-engine change is needed;
   * - a Syllabi row keeps the course-level link (+ UploadId / CatalogUrl when migration 025 is applied).
   */
  private async attachSyllabus(
    transcriptId: string,
    transcriptCourseId: string,
    userId: string,
    upload: { id: string; blobName: string; fileName: string } | null,
    catalogUrl: string | null,
  ) {
    if (!upload && !catalogUrl) return;
    try {
      if (upload && (await this.schema.has('TranscriptDocuments'))) {
        await this.db.query(
          `INSERT INTO TranscriptDocuments (TranscriptId, TranscriptCourseId, DocTypeKey, UploadId, FileName, CreatedBy)
           VALUES (@t, @c, 'syllabus', @u, @f, @by)`,
          [
            { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
            { name: 'c', type: sql.UniqueIdentifier, value: transcriptCourseId },
            { name: 'u', type: sql.UniqueIdentifier, value: upload.id },
            { name: 'f', type: sql.NVarChar(300), value: upload.fileName },
            { name: 'by', type: sql.UniqueIdentifier, value: userId },
          ],
        );
      }
      const v25 = (await this.schema.has('Syllabi', 'CatalogUrl')) && (await this.schema.has('Syllabi', 'UploadId'));
      if (upload || v25) {
        await this.db.query(
          `INSERT INTO Syllabi (TranscriptCourseId, FileStoragePath, OriginalFileName, UploadedBy${v25 ? ', UploadId, CatalogUrl' : ''})
           VALUES (@c, @p, @n, @by${v25 ? ', @u, @url' : ''})`,
          [
            { name: 'c', type: sql.UniqueIdentifier, value: transcriptCourseId },
            { name: 'p', type: sql.NVarChar(500), value: upload?.blobName ?? null },
            { name: 'n', type: sql.NVarChar(300), value: upload?.fileName ?? null },
            { name: 'by', type: sql.UniqueIdentifier, value: userId },
            ...(v25
              ? [
                  { name: 'u', type: sql.UniqueIdentifier, value: upload?.id ?? null },
                  { name: 'url', type: sql.NVarChar(500), value: catalogUrl },
                ]
              : []),
          ],
        );
      }
    } catch (err) {
      this.logger.warn(`Request ${transcriptId}: could not link the syllabus for a course: ${(err as Error).message}`);
    }
  }

  /** Syllabus status per course of a request (file and/or catalogue link). Empty map on any problem. */
  private async syllabusStatus(transcriptId: string): Promise<Map<string, { attached: boolean; fileName: string | null; hasCatalogUrl: boolean }>> {
    const out = new Map<string, { attached: boolean; fileName: string | null; hasCatalogUrl: boolean }>();
    const bump = (tcId: string, fileName: string | null, url: boolean) => {
      const k = String(tcId).toLowerCase();
      const cur = out.get(k) ?? { attached: false, fileName: null, hasCatalogUrl: false };
      out.set(k, { attached: true, fileName: cur.fileName ?? fileName, hasCatalogUrl: cur.hasCatalogUrl || url });
    };
    try {
      const hasUrl = await this.schema.has('Syllabi', 'CatalogUrl');
      const r = await this.db.query<{ Tc: string; FileName: string | null; Url: string | null }>(
        `SELECT s.TranscriptCourseId AS Tc, s.OriginalFileName AS FileName, ${hasUrl ? 's.CatalogUrl' : 'CAST(NULL AS NVARCHAR(500))'} AS Url
         FROM Syllabi s JOIN TranscriptCourses tc ON tc.Id = s.TranscriptCourseId WHERE tc.TranscriptId = @t`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      for (const x of r.recordset) if (x.FileName || x.Url) bump(x.Tc, x.FileName, !!x.Url);
    } catch { /* ignore */ }
    try {
      const d = await this.db.query<{ Tc: string; FileName: string }>(
        `SELECT TranscriptCourseId AS Tc, FileName FROM TranscriptDocuments WHERE TranscriptId = @t AND DocTypeKey = 'syllabus' AND TranscriptCourseId IS NOT NULL`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      for (const x of d.recordset) bump(x.Tc, x.FileName, false);
    } catch { /* ignore */ }
    return out;
  }

  /** applicant (not admitted) -> preview; current BU student -> pre-approval; otherwise official. Legacy profiles stay official. */
  private async evaluationKindFor(userId: string): Promise<'preview' | 'official' | 'preapproval'> {
    const r = await this.db.query<{ ApplicantType: string | null; AdmissionStatus: string | null }>(
      `SELECT ApplicantType, AdmissionStatus FROM StudentProfiles WHERE UserId = @u`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: userId }],
    );
    const p = r.recordset[0];
    if (!p?.ApplicantType) return 'official';
    if (p.ApplicantType === 'current_student') return 'preapproval';
    return p.AdmissionStatus === 'admitted' ? 'official' : 'preview';
  }

  async findById(id: string) {
    const res = await this.db.query<TranscriptHeaderRow>(
      `SELECT t.Id, t.Status, t.ReceivedAt, t.ProcessedAt, t.Notes, t.OriginalFileName, t.StudentUserId,
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

    // BU policy extras (migration 015): per-course attributes + flags, appeals, preview/official kind, credit position.
    const extras = new Map<string, Record<string, unknown>>();
    let evaluationKind = 'official';
    let preapprovalExpiresAt: Date | null = null;
    let credit: Awaited<ReturnType<TransferPolicyService['creditSummary']>> | null = null;
    if (await this.schema.policyReady()) {
      const k = await this.db.query<{ EvaluationKind: string; PreapprovalExpiresAt: Date | null }>(
        `SELECT EvaluationKind, PreapprovalExpiresAt FROM Transcripts WHERE Id = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
      );
      evaluationKind = k.recordset[0]?.EvaluationKind ?? 'official';
      preapprovalExpiresAt = k.recordset[0]?.PreapprovalExpiresAt ?? null;
      const x = await this.db.query<{
        Id: string; TermSeason: string | null; TermYear: number | null; GradingBasis: string | null; DeliveryMode: string | null;
        CourseType: string | null; IsOutsideUS: boolean; PolicyFlags: string | null;
        AppealId: number | null; AppealStatus: string | null; AppealOutcome: string | null; AppealDenial: string | null; AppealComments: string | null;
      }>(
        `SELECT tc.Id, tc.TermSeason, tc.TermYear, tc.GradingBasis, tc.DeliveryMode, tc.CourseType, tc.IsOutsideUS, tc.PolicyFlags,
                a.Id AS AppealId, a.Status AS AppealStatus, a.Outcome AS AppealOutcome, a.DenialReason AS AppealDenial, a.DepartmentComments AS AppealComments
         FROM TranscriptCourses tc
         OUTER APPLY (SELECT TOP 1 * FROM CourseAppeals ca WHERE ca.TranscriptCourseId = tc.Id ORDER BY ca.Id DESC) a
         WHERE tc.TranscriptId = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
      );
      for (const r of x.recordset) {
        extras.set(String(r.Id).toLowerCase(), {
          termSeason: r.TermSeason,
          termYear: r.TermYear,
          gradingBasis: r.GradingBasis,
          deliveryMode: r.DeliveryMode,
          courseType: r.CourseType,
          isOutsideUS: !!r.IsOutsideUS,
          policyFlags: parseFlags(r.PolicyFlags),
          appeal: r.AppealId
            ? { id: r.AppealId, status: r.AppealStatus, outcome: r.AppealOutcome, denialReason: r.AppealDenial, comments: r.AppealComments }
            : null,
        });
      }
      credit = await this.policy.creditSummary(t.StudentUserId);
    }

    const syllabi = await this.syllabusStatus(id);

    return {
      id: t.Id,
      evaluationKind,
      preapprovalExpiresAt,
      credit,
      status: t.Status,
      receivedAt: t.ReceivedAt,
      processedAt: t.ProcessedAt,
      notes: t.Notes,
      studentName: t.StudentName,
      studentEmail: t.StudentEmail,
      documentFileName: t.OriginalFileName,
      institution: {
        id: t.InstitutionId,
        code: t.InstitutionCode,
        name: t.InstitutionName,
        calendar: t.Calendar,
      },
      courses: courses.recordset.map((r) => ({
        ...mapCourseRow(r),
        ...(extras.get(String(r.Id).toLowerCase()) ?? {}),
        syllabus: syllabi.get(String(r.Id).toLowerCase()) ?? { attached: false, fileName: null, hasCatalogUrl: false },
      })),
    };
  }

  /** The transcript document itself, if one was attached at submission — see submit(). */
  async getDocument(id: string) {
    const res = await this.db.query<{
      FileStoragePath: string | null;
      OriginalFileName: string | null;
      StudentEmail: string;
    }>(
      `SELECT t.FileStoragePath, t.OriginalFileName, u.Email AS StudentEmail
       FROM Transcripts t JOIN Users u ON u.Id = t.StudentUserId
       WHERE t.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    const row = res.recordset[0];
    if (!row) throw new NotFoundException('Transcript not found');
    if (!row.FileStoragePath) throw new NotFoundException('No document was attached to this transcript');
    return { path: row.FileStoragePath, fileName: row.OriginalFileName || 'transcript', studentEmail: row.StudentEmail };
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

  async findAll(filters: { studentUserId?: string; submittedByUserId?: string; status?: string; requestingUserId?: string; requestingRole?: string } = {}) {
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

    if (filters.requestingRole === 'admin' && filters.requestingUserId) {
      // Admins assigned to universities see only requests targeting (or registered for) those universities.
      const adminScope = await this.scopeService.universityScope({ id: filters.requestingUserId, role: 'admin' });
      if (adminScope) where += ` AND ${this.scopeService.transcriptVisibleInScope(adminScope, 't', inputs)}`;
    } else {
      const scope = await this.getUniversityScope(filters.requestingUserId);
      if (scope) {
        const scopeParams = scope.map((instId, i) => {
          const name = `scopeInst${i}`;
          inputs.push({ name, type: sql.Int, value: instId });
          return `@${name}`;
        });
        where += ` AND t.InstitutionId IN (${scopeParams.join(', ')})`;
      }
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
    const transcript = await this.findById(id);
    // Send status update email — best-effort, non-fatal
    try {
      const firstName = transcript.studentName.split(' ')[0];
      await this.emailService.sendTranscriptStatus(
        transcript.studentEmail,
        firstName,
        id,
        status,
      );
    } catch { /* non-fatal */ }
    return transcript;
  }

  /** Can this admin see the transcript? (true for everyone but scoped admins.) */
  async adminCanSee(transcriptId: string, viewer: { id: string; role: string }): Promise<boolean> {
    const ids = await this.scopeService.universityScope(viewer);
    if (!ids) return true;
    const inputs: QueryInput[] = [{ name: 'tid', type: sql.UniqueIdentifier, value: transcriptId }];
    const pred = this.scopeService.transcriptVisibleInScope(ids, 't', inputs);
    const r = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Transcripts t WHERE t.Id = @tid AND ${pred}`, inputs);
    return r.recordset[0].N > 0;
  }
}
