import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { ScopeService, ScopeViewer } from '../policy/scope.service';
import { TransferPolicyService, parseFlags } from '../policy/transfer-policy.service';
import { CreditDeadlineService } from '../policy/credit-deadline.service';
import { CourseMappingsService } from '../policy/course-mappings.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { buildProgress, ProgressCourseRow, ProgressRequestRow, ProgressResult } from './progress.aggregate';

interface RequestRow {
  Id: string;
  Status: string;
  ReceivedAt: Date | null;
  InstitutionName: string;
  Calendar: string | null;
  EvaluationKind?: string | null;
}

interface CourseRow {
  Id: string;
  TranscriptId: string;
  CourseCode: string;
  CourseTitle: string;
  Lane: string;
  Status: string;
  OriginalCredits: number;
  NormalisedCredits: number | null;
  Grade: string | null;
  EvalStatus: string | null;
  Outcome: string | null;
  AwardedCredits: number | null;
  AIConfidence: number | null;
  DecidedCode: string | null;
  DecidedTitle: string | null;
  AiCode: string | null;
  AiTitle: string | null;
  AiCredits: number | null;
  HasSyllabus: number;
  PolicyFlags?: string | null;
  IsOutsideUS?: boolean | null;
  AppealStatus?: string | null;
}

@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private db: DatabaseService,
    private schema: SchemaService,
    private scope: ScopeService,
    private policy: TransferPolicyService,
    private aiSettings: AiSettingsService,
    private deadlines: CreditDeadlineService,
    private courseMappings: CourseMappingsService,
  ) {}

  /** Staff view of one student; same visibility rules as the other student-data endpoints. */
  async forStudent(viewer: ScopeViewer, studentUserId: string): Promise<ProgressResult> {
    if (viewer.id !== studentUserId) {
      if (!['admin', 'super_admin', 'faculty'].includes(viewer.role)) throw new ForbiddenException();
      if (!(await this.scope.canManageUser(viewer, studentUserId))) throw new ForbiddenException();
    }
    const exists = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Users WHERE Id = @u`, [
      { name: 'u', type: sql.UniqueIdentifier, value: studentUserId },
    ]);
    if (!exists.recordset[0]?.N) throw new NotFoundException('Student not found');
    return this.build(studentUserId);
  }

  async build(studentUserId: string): Promise<ProgressResult> {
    const policyReady = await this.schema.policyReady();
    const u = [{ name: 'u', type: sql.UniqueIdentifier, value: studentUserId }];

    const reqs = await this.db.query<RequestRow>(
      `SELECT t.Id, t.Status, t.ReceivedAt, i.Name AS InstitutionName, i.Calendar
              ${policyReady ? ', t.EvaluationKind' : ''}
       FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE t.StudentUserId = @u ORDER BY t.ReceivedAt DESC`,
      u,
    );

    const courseRows = reqs.recordset.length
      ? await this.db.query<CourseRow>(
          `SELECT tc.Id, tc.TranscriptId, tc.CourseCode, tc.CourseTitle, tc.Lane, tc.Status, tc.OriginalCredits, tc.NormalisedCredits, tc.Grade,
                  e.Status AS EvalStatus, e.Outcome, e.AwardedCredits, e.AIConfidence,
                  dc.Code AS DecidedCode, dc.Title AS DecidedTitle,
                  ac.Code AS AiCode, ac.Title AS AiTitle, ac.Credits AS AiCredits,
                  CASE WHEN EXISTS (SELECT 1 FROM Syllabi s WHERE s.TranscriptCourseId = tc.Id) THEN 1 ELSE 0 END AS HasSyllabus
                  ${policyReady ? `, tc.PolicyFlags, tc.IsOutsideUS,
                  (SELECT TOP 1 ca.Status FROM CourseAppeals ca WHERE ca.TranscriptCourseId = tc.Id ORDER BY ca.Id DESC) AS AppealStatus` : ''}
           FROM TranscriptCourses tc
           JOIN Transcripts t ON t.Id = tc.TranscriptId
           OUTER APPLY (SELECT TOP 1 * FROM Evaluations ev WHERE ev.TranscriptCourseId = tc.Id ORDER BY ev.CreatedAt DESC) e
           LEFT JOIN Courses dc ON dc.Id = e.DecidedBUCourseId
           LEFT JOIN Courses ac ON ac.Id = e.AISuggestedCourseId
           WHERE t.StudentUserId = @u
           ORDER BY tc.SortOrder, tc.CourseCode`,
          u,
        )
      : { recordset: [] as CourseRow[] };

    const multiMappings = await this.courseMappings.forStudent(studentUserId);
    const byReq = new Map<string, ProgressCourseRow[]>();
    for (const c of courseRows.recordset) {
      const key = String(c.TranscriptId).toLowerCase();
      const list = byReq.get(key) ?? [];
      list.push({
        id: c.Id,
        courseCode: c.CourseCode,
        courseTitle: c.CourseTitle,
        lane: c.Lane,
        status: c.Status,
        originalCredits: Number(c.OriginalCredits),
        normalisedCredits: c.NormalisedCredits == null ? null : Number(c.NormalisedCredits),
        grade: c.Grade,
        evalStatus: c.EvalStatus,
        outcome: c.Outcome,
        awardedCredits: c.AwardedCredits == null ? null : Number(c.AwardedCredits),
        decidedBuCode: c.DecidedCode,
        decidedBuTitle: c.DecidedTitle,
        aiConfidence: c.AIConfidence == null ? null : Number(c.AIConfidence),
        aiBuCode: c.AiCode,
        aiBuTitle: c.AiTitle,
        aiBuCredits: c.AiCredits == null ? null : Number(c.AiCredits),
        flags: parseFlags(c.PolicyFlags),
        isOutsideUS: !!c.IsOutsideUS,
        appealStatus: c.AppealStatus ?? null,
        hasSyllabus: !!c.HasSyllabus,
        mappings: (multiMappings.get(String(c.Id).toLowerCase()) ?? []).map((m) => ({ code: m.code, title: m.title, credits: m.credits })),
      });
      byReq.set(key, list);
    }

    const requests: ProgressRequestRow[] = reqs.recordset.map((r) => ({
      id: r.Id,
      institutionName: r.InstitutionName,
      calendar: r.Calendar,
      kind: r.EvaluationKind ?? 'official',
      status: r.Status,
      receivedAt: r.ReceivedAt,
      courses: byReq.get(String(r.Id).toLowerCase()) ?? [],
    }));

    // Cap, exam credits and Hub rule come from the policy (defaults when migration 015 is absent).
    const target = await this.policy.targetFor(studentUserId);
    const pol = await this.policy.getEffective(target);
    let applicantType: string | null = null;
    let examCredits = 0;
    let examSummary: Awaited<ReturnType<TransferPolicyService['examSummary']>> | null = null;
    if (policyReady) {
      try {
        const p = await this.db.query<{ A: string | null }>(`SELECT ApplicantType AS A FROM StudentProfiles WHERE UserId = @u`, u);
        applicantType = p.recordset[0]?.A ?? null;
        // Only exams at or above the university's minimum score count toward the cap (ExamCreditService).
        examSummary = await this.policy.examSummary(studentUserId);
        examCredits = examSummary.countedCredits;
      } catch (err) {
        this.logger.warn(`progress: profile/exam lookup failed: ${(err as Error).message}`);
      }
    }
    let likelyThreshold = 0.75;
    try {
      likelyThreshold = (await this.aiSettings.getEffective(target)).autoLikelyThreshold ?? 0.75;
    } catch {
      // AI settings tables not available: keep the default
    }

    return buildProgress(requests, {
      cap: this.policy.capFor(pol, applicantType),
      examCredits,
      exams: examSummary?.results ?? [],
      likelyThreshold,
      hubRequirements: pol.hubRequirementsTransfer,
      hubCocurricularAllowed: pol.hubCocurricularAllowed,
      applicantType,
      policyKnown: policyReady,
      deadline: await this.deadlines.forStudent(studentUserId),
    });
  }
}
