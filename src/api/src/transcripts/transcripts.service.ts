import { CourseMappingsService } from '../policy/course-mappings.service';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService, QueryInput } from '../database/database.service';
import * as sql from 'mssql';
import { SubmitTranscriptDto, UpdateTranscriptCourseDto } from './dto/create-transcript.dto';
import { EmailService } from '../common/email.service';
import { UploadsService } from '../uploads/uploads.service';
import { ScopeService, isScopedStaffRole } from '../policy/scope.service';
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
  TargetName?: string | null;
  StageName?: string | null;
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
    private courseMappings: CourseMappingsService,
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

    // The student may choose where these credits go (the receiving university). Recorded on the
    // request so the workflow resolves against it; falls back to their profile target, else BU.
    if (dto.targetInstitutionId && (await this.schema.has('Transcripts', 'TargetInstitutionId'))) {
      await this.db.query(`UPDATE Transcripts SET TargetInstitutionId = @ti WHERE Id = @id`, [
        { name: 'ti', type: sql.Int, value: dto.targetInstitutionId },
        { name: 'id', type: sql.UniqueIdentifier, value: transcriptId },
      ]).catch(() => {});
    }

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
   * A student corrects one of their own submitted courses (code/title/credits/grade/term). The course
   * is re-triaged and the request's policy flags recomputed. Blocked once a decision is posted — the
   * evaluation outcome stays system-controlled, this only edits what the student entered.
   */
  async updateCourseByStudent(courseId: string, user: { id: string; role: string }, dto: UpdateTranscriptCourseDto) {
    const row = await this.db.query<{
      Id: string; TranscriptId: string; StudentUserId: string; InstitutionId: number; Status: string;
      CourseCode: string; CourseTitle: string; OriginalCredits: number; Grade: string; Term: string | null;
    }>(
      `SELECT tc.Id, tc.TranscriptId, t.StudentUserId, t.InstitutionId, tc.Status,
              tc.CourseCode, tc.CourseTitle, tc.OriginalCredits, tc.Grade, tc.Term
       FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId WHERE tc.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: courseId }],
    );
    const c = row.recordset[0];
    if (!c) throw new NotFoundException('Course not found');
    if (user.role === 'student' && String(c.StudentUserId).toLowerCase() !== user.id.toLowerCase()) {
      throw new ForbiddenException('You can only edit your own courses.');
    }
    const posted = await this.db.query<{ N: number }>(
      `SELECT COUNT(*) AS N FROM Evaluations WHERE TranscriptCourseId = @id AND Status = 'posted'`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: courseId }],
    );
    if (c.Status === 'posted' || posted.recordset[0]?.N > 0) {
      throw new BadRequestException('This course has already been decided and can no longer be edited.');
    }

    const code = (dto.courseCode ?? c.CourseCode).trim();
    const title = (dto.courseTitle ?? c.CourseTitle).trim();
    const credits = dto.originalCredits ?? Number(c.OriginalCredits);
    const grade = (dto.grade ?? c.Grade ?? '').trim().toUpperCase() || c.Grade;
    const term = dto.term !== undefined ? (dto.term || null) : c.Term;

    const extId = await this.findOrCreateExternalCourse(c.InstitutionId, code, title, credits);
    await this.db.query(
      `UPDATE TranscriptCourses SET CourseCode = @code, CourseTitle = @title, ExternalCourseId = @ext,
              OriginalCredits = @cr, Grade = @grade, Term = @term WHERE Id = @id`,
      [
        { name: 'code', type: sql.NVarChar(50), value: code },
        { name: 'title', type: sql.NVarChar(300), value: title },
        { name: 'ext', type: sql.Int, value: extId },
        { name: 'cr', type: sql.Decimal(5, 2), value: credits },
        { name: 'grade', type: sql.NVarChar(10), value: grade },
        { name: 'term', type: sql.NVarChar(50), value: term },
        { name: 'id', type: sql.UniqueIdentifier, value: courseId },
      ],
    );
    if (await this.schema.policyReady()) {
      await this.db.query(
        `UPDATE TranscriptCourses SET TermSeason = COALESCE(@ts, TermSeason), TermYear = COALESCE(@ty, TermYear),
                GradingBasis = COALESCE(@gb, GradingBasis) WHERE Id = @id`,
        [
          { name: 'ts', type: sql.VarChar(10), value: dto.termSeason ?? null },
          { name: 'ty', type: sql.Int, value: dto.termYear ?? null },
          { name: 'gb', type: sql.VarChar(10), value: dto.gradingBasis ?? null },
          { name: 'id', type: sql.UniqueIdentifier, value: courseId },
        ],
      ).catch(() => {});
    }

    // Re-triage this course against the (possibly new) code/credits/grade.
    const triageRes = await this.db.execute<TriageResultRow>('sp_TriageCourse', [
      { name: 'TranscriptCourseId', type: sql.UniqueIdentifier, value: courseId },
      { name: 'TriagedBy', type: sql.UniqueIdentifier, value: user.id },
    ]);
    const lane = triageRes.recordset[0]?.Lane ?? 'needs_syllabus';
    if (lane === 'needs_syllabus') {
      const ev = await this.db.query<{ N: number }>(
        `SELECT COUNT(*) AS N FROM Evaluations WHERE TranscriptCourseId = @id AND Status IN ('queued','in_progress')`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: courseId }],
      );
      if (!ev.recordset[0]?.N) {
        await this.db.query(`INSERT INTO Evaluations (TranscriptCourseId, Status) VALUES (@id, 'queued')`, [
          { name: 'id', type: sql.UniqueIdentifier, value: courseId },
        ]);
      }
    }
    try {
      await this.policy.applyToTranscript(c.TranscriptId);
    } catch (err) {
      this.logger.warn(`Re-triage policy pass failed for ${c.TranscriptId}: ${(err as Error).message}`);
    }
    return { ok: true, lane };
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

  /**
   * The student (or the agency that submitted it) cancels an open request. Staff queues drop it (WorkflowStatus
   * 'cancelled'), open stages are skipped, and a snapshot of how far it got is kept so reports can show how much
   * had been done: courses decided, credits awarded so far, approval stages completed.
   */
  async cancel(id: string, user: { id: string; role: string; email?: string }, dto: { reason: string; note?: string }) {
    if (!(await this.schema.has('Transcripts', 'CancelledAt'))) {
      throw new ServiceUnavailableException('Cancelling is not available yet (migration 031 has not been applied).');
    }
    const r = await this.db.query<{ Status: string; WorkflowStatus: string | null; StudentUserId: string; SubmittedById: string | null; InstitutionName: string }>(
      `SELECT t.Status, ${(await this.schema.has('Transcripts', 'WorkflowStatus')) ? 't.WorkflowStatus' : 'CAST(NULL AS VARCHAR(12)) AS WorkflowStatus'},
              t.StudentUserId, t.SubmittedById, i.Name AS InstitutionName
       FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId WHERE t.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    const t = r.recordset[0];
    if (!t) throw new NotFoundException('Transcript not found');
    const owner = (user.role === 'student' && String(t.StudentUserId).toLowerCase() === user.id.toLowerCase())
      || (user.role === 'agency' && t.SubmittedById && String(t.SubmittedById).toLowerCase() === user.id.toLowerCase());
    if (!owner) throw new ForbiddenException('Only the student who owns this request can cancel it.');
    if (t.Status === 'cancelled') throw new BadRequestException('This request is already cancelled.');
    if (t.Status === 'complete' || ['approved', 'bypassed', 'rejected'].includes(t.WorkflowStatus ?? '')) {
      throw new BadRequestException('This request has already been completed, so it can no longer be cancelled.');
    }

    // Progress snapshot
    const hasStages = await this.schema.has('TranscriptStages');
    const courses = await this.db.query<{ Total: number; Decided: number; Credits: number | null }>(
      `SELECT COUNT(*) AS Total,
              SUM(CASE WHEN tc.Status IN ('decided','posted') OR e.Outcome IS NOT NULL OR tc.Lane = 'applied' THEN 1 ELSE 0 END) AS Decided,
              SUM(CASE WHEN e.AwardedCredits IS NOT NULL AND e.Outcome IN ('equivalent','elective') THEN e.AwardedCredits
                       WHEN tc.Lane = 'applied' THEN ISNULL(tc.NormalisedCredits, tc.OriginalCredits) ELSE 0 END) AS Credits
       FROM TranscriptCourses tc LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id WHERE tc.TranscriptId = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    let stagesDone = 0, stagesTotal = 0, stageName: string | null = null;
    if (hasStages) {
      const st = await this.db.query<{ Total: number; Done: number; Active: string | null }>(
        `SELECT COUNT(*) AS Total, SUM(CASE WHEN Status IN ('approved','bypassed') THEN 1 ELSE 0 END) AS Done,
                MAX(CASE WHEN Status = 'active' THEN StageName END) AS Active
         FROM TranscriptStages WHERE TranscriptId = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
      );
      stagesTotal = Number(st.recordset[0]?.Total ?? 0);
      stagesDone = Number(st.recordset[0]?.Done ?? 0);
      stageName = st.recordset[0]?.Active ?? null;
    }
    const progress = {
      coursesTotal: Number(courses.recordset[0]?.Total ?? 0),
      coursesDecided: Number(courses.recordset[0]?.Decided ?? 0),
      creditsAwarded: Number(courses.recordset[0]?.Credits ?? 0),
      stagesCompleted: stagesDone,
      stagesTotal,
      stoppedAt: stageName,
    };
    const reason = dto.reason.trim().slice(0, 60);
    const note = dto.note?.trim().slice(0, 1000) || null;

    await this.db.transaction(async (run) => {
      const bind = [
        { name: 'id', type: sql.UniqueIdentifier, value: id },
        { name: 'reason', type: sql.NVarChar(60), value: reason },
        { name: 'note', type: sql.NVarChar(1000), value: note },
        { name: 'prog', type: sql.NVarChar(1000), value: JSON.stringify(progress) },
      ];
      const wf = (await this.schema.has('Transcripts', 'WorkflowStatus')) ? ", WorkflowStatus = CASE WHEN WorkflowStatus IS NULL THEN NULL ELSE 'cancelled' END" : '';
      await run(
        `UPDATE Transcripts SET Status = 'cancelled'${wf}, CancelledAt = SYSUTCDATETIME(), CancelReason = @reason, CancelNote = @note, CancelProgress = @prog WHERE Id = @id`,
        bind,
      );
      if (hasStages) await run(`UPDATE TranscriptStages SET Status = 'skipped' WHERE TranscriptId = @id AND Status IN ('pending','active')`, [bind[0]]);
      if (await this.schema.has('TranscriptNotes')) {
        await run(
          `INSERT INTO TranscriptNotes (TranscriptId, Audience, Kind, AuthorUserId, AuthorRole, Body) VALUES (@id, 'internal', 'system', @uid, @role, @body)`,
          [bind[0], { name: 'uid', type: sql.UniqueIdentifier, value: user.id }, { name: 'role', type: sql.VarChar(20), value: user.role },
            { name: 'body', type: sql.NVarChar(sql.MAX), value: `Cancelled by the ${user.role}. Reason: ${reason}${note ? ` - ${note}` : ''}. Progress: ${progress.coursesDecided}/${progress.coursesTotal} courses decided, ${progress.creditsAwarded} credits awarded, ${stagesDone}/${stagesTotal} stages done${stageName ? `, stopped at "${stageName}"` : ''}.` }],
        );
      }
    });

    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, OldValue, NewValue)
         VALUES (@uid, @email, @role, 'TRANSCRIPT_CANCELLED', 'Transcript', @eid, NULL, @new)`,
        [
          { name: 'uid', type: sql.UniqueIdentifier, value: user.id },
          { name: 'email', type: sql.NVarChar(254), value: user.email ?? '' },
          { name: 'role', type: sql.VarChar(20), value: user.role },
          { name: 'eid', type: sql.NVarChar(100), value: id },
          { name: 'new', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ reason, note, progress }) },
        ],
      );
    } catch { /* auditing must never undo the cancel */ }
    return { ok: true, status: 'cancelled', progress };
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
    const multiMappings = await this.courseMappings.forTranscript(id); // OUT-06: BU courses per course (empty unless one-to-many)

    // From -> To summary: the receiving university's name, credits submitted (from) and credits
    // accepted/awarded on this request (to). Target column is guarded for pre-migration-013 DBs.
    let targetInstitutionName: string | null = null;
    if (await this.schema.has('Transcripts', 'TargetInstitutionId')) {
      const tn = await this.db.query<{ Name: string | null }>(
        `SELECT ti.Name FROM Transcripts t LEFT JOIN Institutions ti ON ti.Id = t.TargetInstitutionId WHERE t.Id = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
      ).catch(() => ({ recordset: [] as { Name: string | null }[] }));
      targetInstitutionName = tn.recordset[0]?.Name ?? null;
    }
    const totals = await this.db.query<{ FromCredits: number | null; ToCredits: number | null }>(
      `SELECT SUM(tc.OriginalCredits) AS FromCredits,
              SUM(CASE WHEN e.AwardedCredits IS NOT NULL AND e.Outcome IN ('equivalent','elective') THEN e.AwardedCredits
                       WHEN tc.Lane = 'applied' THEN ISNULL(tc.NormalisedCredits, tc.OriginalCredits) ELSE 0 END) AS ToCredits
       FROM TranscriptCourses tc LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
       WHERE tc.TranscriptId = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );

    // Suggested receiving-university equivalents per course (top 3 from the matcher), so the student
    // can see likely matches even before a reviewer decides. Keyed by TranscriptCourse id.
    const suggestRows = await this.db.query<{ TcId: string; Rank: number; Code: string; Title: string; Credits: number; Score: number | null }>(
      `SELECT tc.Id AS TcId, amc.Rank, bu.Code, bu.Title, bu.Credits, amc.Score
       FROM TranscriptCourses tc
       JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
       JOIN AIMatchCandidates amc ON amc.EvaluationId = e.Id
       JOIN Courses bu ON bu.Id = amc.BUCourseId
       WHERE tc.TranscriptId = @id AND amc.Rank <= 3
       ORDER BY tc.Id, amc.Rank`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    ).catch(() => ({ recordset: [] as { TcId: string; Rank: number; Code: string; Title: string; Credits: number; Score: number | null }[] }));
    const suggestions = new Map<string, { code: string; title: string; credits: number; score: number | null }[]>();
    for (const s of suggestRows.recordset) {
      const key = String(s.TcId).toLowerCase();
      if (!suggestions.has(key)) suggestions.set(key, []);
      suggestions.get(key)!.push({ code: s.Code, title: s.Title, credits: s.Credits, score: s.Score });
    }

    let cancellation: { cancelledAt: Date; reason: string | null; note: string | null; progress: unknown } | null = null;
    if (t.Status === 'cancelled' && (await this.schema.has('Transcripts', 'CancelledAt'))) {
      const c = await this.db.query<{ CancelledAt: Date; CancelReason: string | null; CancelNote: string | null; CancelProgress: string | null }>(
        `SELECT CancelledAt, CancelReason, CancelNote, CancelProgress FROM Transcripts WHERE Id = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
      );
      const row = c.recordset[0];
      if (row) {
        let progress: unknown = null;
        try { progress = row.CancelProgress ? JSON.parse(row.CancelProgress) : null; } catch { /* ignore */ }
        cancellation = { cancelledAt: row.CancelledAt, reason: row.CancelReason, note: row.CancelNote, progress };
      }
    }

    return {
      id: t.Id,
      cancellation,
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
      targetInstitutionName,
      fromCredits: Number(totals.recordset[0]?.FromCredits ?? 0),
      toCredits: Number(totals.recordset[0]?.ToCredits ?? 0),
      courses: courses.recordset.map((r) => ({
        ...mapCourseRow(r),
        ...(extras.get(String(r.Id).toLowerCase()) ?? {}),
        syllabus: syllabi.get(String(r.Id).toLowerCase()) ?? { attached: false, fileName: null, hasCatalogUrl: false },
        mappedBuCourses: multiMappings.get(String(r.Id).toLowerCase()) ?? [],
        suggestions: suggestions.get(String(r.Id).toLowerCase()) ?? [],
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

    if (filters.requestingRole && isScopedStaffRole(filters.requestingRole) && filters.requestingUserId) {
      // Admins and faculty assigned to universities see only requests coming INTO one of those
      // universities (target) or going OUT of one (source). No scope rows = unrestricted.
      const staffScope = await this.scopeService.universityScope({ id: filters.requestingUserId, role: filters.requestingRole });
      if (staffScope) where += ` AND ${this.scopeService.transcriptVisibleInScope(staffScope, 't', inputs)}`;
    } else if (filters.requestingRole !== 'super_admin') {
      // Legacy source-institution narrowing, kept for the roles above that are not scoped staff.
      // Super admins are never narrowed, even when they happen to carry scope rows of their own.
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

    // Receiving university + the stage a request is currently at (columns exist only after migration 013).
    const hasTarget = await this.schema.has('Transcripts', 'TargetInstitutionId');
    const hasStages = await this.schema.has('TranscriptStages');
    const extraSel = (hasTarget ? `, (SELECT ti.Name FROM Institutions ti WHERE ti.Id = t.TargetInstitutionId) AS TargetName` : '')
      + (hasStages ? `, (SELECT TOP 1 ts.StageName FROM TranscriptStages ts WHERE ts.TranscriptId = t.Id AND ts.Status = 'active' ORDER BY ts.StageOrder) AS StageName` : '');
    const res = await this.db.query<TranscriptListRow>(
      `SELECT t.Id, t.Status, t.ReceivedAt,
              i.Name AS InstitutionName,
              u.FirstName + ' ' + u.LastName AS StudentName,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id) AS CourseCount${extraSel}
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
      targetInstitutionName: t.TargetName ?? null,
      currentStage: t.StageName ?? null,
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

  /** Can this staff member see the transcript? (true for everyone but scoped admins/faculty.) */
  async adminCanSee(transcriptId: string, viewer: { id: string; role: string }): Promise<boolean> {
    const ids = await this.scopeService.universityScope(viewer);
    if (!ids) return true;
    const inputs: QueryInput[] = [{ name: 'tid', type: sql.UniqueIdentifier, value: transcriptId }];
    const pred = this.scopeService.transcriptVisibleInScope(ids, 't', inputs);
    const r = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Transcripts t WHERE t.Id = @tid AND ${pred}`, inputs);
    return r.recordset[0].N > 0;
  }
}
