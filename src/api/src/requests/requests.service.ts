import { ForbiddenException, HttpException, Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { EventBus } from '../events/event-bus.service';
import * as sql from 'mssql';
import { SchemaService } from '../policy/schema.service';
import { TransferPolicyService } from '../policy/transfer-policy.service';
import { CreditDeadlineService } from '../policy/credit-deadline.service';
import { DatabaseService, QueryInput } from '../database/database.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { UploadsService } from '../uploads/uploads.service';
import { ScopeService, isScopedStaffRole } from '../policy/scope.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import { AiUsageService } from '../ai/ai-usage.service';
import { Actor, WorkflowEngineService, isAdminRole } from './workflow-engine.service';

export interface Viewer extends Actor {
  email: string;
}

const isOwnerRole = (role: string) => role === 'student' || role === 'agency';

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private db: DatabaseService,
    private engine: WorkflowEngineService,
    private workflows: WorkflowsService,
    private uploads: UploadsService,
    private email: EmailService,
    private aiUsage: AiUsageService,
    private schema: SchemaService,
    private policy: TransferPolicyService,
    private scopeSvc: ScopeService,
    private deadlines: CreditDeadlineService,
    @Optional() private bus?: EventBus,
  ) {}

  /** Application details a reviewer needs (migration 015): applicant type, school, term, English, history, exams. */
  async studentProfile(userId: string) {
    if (!(await this.schema.policyReady())) return null;
    const p = await this.db.query(
      `SELECT sp.ApplicantType AS applicantType, sp.AdmissionStatus AS admissionStatus, sp.BUStudentId AS buid,
              au.Name AS intendedSchool, ti.Name AS targetUniversity, pr.Name AS targetProgram,
              sp.EntryTerm AS entryTerm, sp.EntryYear AS entryYear, sp.IsNativeEnglish AS isNativeEnglish,
              sp.EnglishTestType AS englishTestType, sp.EnglishTestScore AS englishTestScore,
              sp.HasIntlCoursework AS hasIntlCoursework, sp.HighSchoolName AS highSchoolName,
              sp.HighSchoolGradYear AS highSchoolGradYear, sp.CreditsCompleted AS creditsCompleted
       FROM StudentProfiles sp
       LEFT JOIN AcademicUnits au ON au.Id = sp.IntendedAcademicUnitId
       LEFT JOIN Institutions ti ON ti.Id = sp.TargetInstitutionId
       LEFT JOIN Programs pr ON pr.Id = sp.TargetProgramId
       WHERE sp.UserId = @u`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: userId }],
    );
    const education = await this.db.query(
      `SELECT InstitutionName AS institutionName, City AS city, StateRegion AS stateRegion, Country AS country,
              IsOutsideUS AS isOutsideUS, FromYear AS fromYear, ToYear AS toYear, CreditsEarned AS creditsEarned, FullTime AS fullTime
       FROM StudentEducation WHERE UserId = @u ORDER BY SortOrder, Id`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: userId }],
    );
    const exams = await this.db.query(
      `SELECT ExamType AS examType, Subject AS subject, Score AS score, ExamYear AS examYear, Credits AS credits
       FROM StudentExamCredits WHERE UserId = @u ORDER BY ExamType, Subject`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: userId }],
    );
    return { ...(p.recordset[0] ?? {}), education: education.recordset, exams: exams.recordset };
  }

  // ── access ──────────────────────────────────────────────────

  /** Students/agencies see only their own request; staff can open any in their university scope. */
  async assertCanView(transcriptId: string, viewer: Viewer) {
    const r = await this.db.query<{ StudentUserId: string; SubmittedById: string }>(
      `SELECT StudentUserId, SubmittedById FROM Transcripts WHERE Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const row = r.recordset[0];
    if (!row) throw new NotFoundException('Request not found');
    const same = (a: string) => String(a).toLowerCase() === viewer.id.toLowerCase();
    if (viewer.role === 'student' && !same(row.StudentUserId)) throw new ForbiddenException();
    if (viewer.role === 'agency' && !same(row.SubmittedById)) throw new ForbiddenException();
    if (isScopedStaffRole(viewer.role)) {
      const ids = await this.scopeSvc.universityScope(viewer);
      if (ids) {
        const inputs: QueryInput[] = [{ name: 'tid', type: sql.UniqueIdentifier, value: transcriptId }];
        // incoming (full access) or outgoing from a scoped university (read + documents + reminders)
        const pred = this.scopeSvc.transcriptVisibleInScope(ids, 't', inputs);
        const ok = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Transcripts t WHERE t.Id = @tid AND ${pred}`, inputs);
        if (!ok.recordset[0].N) throw new ForbiddenException('This request belongs to a university outside your assignment.');
      }
    }
    return row;
  }

  /** assertCanView + "may decide stages": scoped staff of the SOURCE university only read / upload / remind. */
  async assertCanWork(transcriptId: string, viewer: Viewer) {
    const row = await this.assertCanView(transcriptId, viewer);
    if (!(await this.scopeSvc.canWorkRequest(viewer, transcriptId))) {
      throw new ForbiddenException('This request is incoming at another university. You can view it, add documents and send reminders, but not approve it.');
    }
    return row;
  }

  /** Workflow stage ids this user can act on. null = every stage (admins). */
  private async myStageIds(viewer: Viewer): Promise<Set<number> | null> {
    if (isAdminRole(viewer.role)) return null;
    const res = await this.db.query<{ Id: number }>(
      `SELECT s.Id FROM WorkflowStages s WHERE
         EXISTS (SELECT 1 FROM WorkflowStageApprovers a WHERE a.StageId = s.Id AND a.ApproverType = 'role' AND a.RoleName = @role)
         OR EXISTS (SELECT 1 FROM WorkflowStageApprovers a
                    JOIN ApproverGroupMembers m ON m.GroupId = a.GroupId
                    JOIN ApproverGroups g ON g.Id = a.GroupId AND g.IsActive = 1
                    WHERE a.StageId = s.Id AND a.ApproverType = 'group' AND m.UserId = @uid)
         OR EXISTS (SELECT 1 FROM WorkflowStageApprovers a WHERE a.StageId = s.Id AND a.ApproverType = 'user' AND a.UserId = @uid)`,
      [
        { name: 'role', type: sql.VarChar(20), value: viewer.role },
        { name: 'uid', type: sql.UniqueIdentifier, value: viewer.id },
      ],
    );
    return new Set(res.recordset.map((r) => r.Id));
  }

  // ── timeline ────────────────────────────────────────────────

  /** Preview / official / pre-approval, credit position and (for staff) the application profile. */
  private async policyExtras(transcriptId: string, staff: boolean) {
    let evaluationKind = 'official';
    let preapprovalExpiresAt: Date | null = null;
    let student: Awaited<ReturnType<RequestsService['studentProfile']>> = null;
    let credit: Awaited<ReturnType<TransferPolicyService['creditSummary']>> | null = null;
    if (await this.schema.policyReady()) {
      const k = await this.db.query<{ EvaluationKind: string; PreapprovalExpiresAt: Date | null; StudentUserId: string }>(
        `SELECT EvaluationKind, PreapprovalExpiresAt, StudentUserId FROM Transcripts WHERE Id = @t`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      const row = k.recordset[0];
      evaluationKind = row?.EvaluationKind ?? 'official';
      preapprovalExpiresAt = row?.PreapprovalExpiresAt ?? null;
      if (row) {
        [credit, student] = await Promise.all([
          this.policy.creditSummary(row.StudentUserId),
          staff ? this.studentProfile(row.StudentUserId) : Promise.resolve(null),
        ]);
      }
    }
    return { evaluationKind, preapprovalExpiresAt, student, credit };
  }

  async getTimeline(transcriptId: string, viewer: Viewer) {
    await this.assertCanView(transcriptId, viewer);
    const staff = !isOwnerRole(viewer.role);
    // Scoped staff (admin or faculty) of the SOURCE university only read: no approving, no internal notes or AI brief of the receiving university.
    const readOnly = staff && !(await this.scopeSvc.canWorkRequest(viewer, transcriptId));
    const mine = await this.myStageIds(viewer);
    const actsOn = (wsId: number | null) => (mine === null ? true : wsId != null && mine.has(wsId));

    const head = await this.db.query(
      `SELECT t.Id AS id, t.Status AS status, t.WorkflowStatus AS workflowStatus, t.ReceivedAt AS receivedAt, t.ProcessedAt AS processedAt,
              t.WorkflowId AS workflowId, w.Name AS workflowName, w.AllowBypass AS allowBypass, t.OriginalFileName AS documentFileName,
              u.FirstName + ' ' + u.LastName AS studentName, u.Email AS studentEmail,
              ei.Name AS institutionName, ti.Name AS targetInstitutionName
       FROM Transcripts t
       JOIN Users u ON u.Id = t.StudentUserId
       JOIN Institutions ei ON ei.Id = t.InstitutionId
       LEFT JOIN Institutions ti ON ti.Id = t.TargetInstitutionId
       LEFT JOIN WorkflowDefinitions w ON w.Id = t.WorkflowId
       WHERE t.Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const t = head.recordset[0];
    if (!t) throw new NotFoundException('Request not found');

    const stages = await this.db.query(
      `SELECT ts.Id, ts.WorkflowStageId, ts.StageOrder, ts.StageKey, ts.StageName, ts.StageType, ts.AgentTask, ts.Status,
              ts.ActivatedAt, ts.DueAt, ts.CompletedAt, ts.AiBrief, ts.AiRecommendation,
              u.FirstName + ' ' + u.LastName AS DecidedByName, r.Name AS DecidedByRole,
              ws.CanBypass, ws.RequiresComment, ws.Description
       FROM TranscriptStages ts
       LEFT JOIN Users u ON u.Id = ts.DecidedByUserId
       LEFT JOIN Roles r ON r.Id = u.RoleId
       LEFT JOIN WorkflowStages ws ON ws.Id = ts.WorkflowStageId
       WHERE ts.TranscriptId = @t ORDER BY ts.StageOrder`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );

    const avgMinutes = t.workflowId && t.workflowStatus === 'active' ? await this.stageAverages(t.workflowId) : new Map<number, number>();

    const approverRows = t.workflowId
      ? (
          await this.db.query(
            `SELECT a.StageId, a.ApproverType, a.RoleName, g.Name AS GroupName, u.FirstName + ' ' + u.LastName AS UserName
             FROM WorkflowStageApprovers a JOIN WorkflowStages s ON s.Id = a.StageId
             LEFT JOIN ApproverGroups g ON g.Id = a.GroupId LEFT JOIN Users u ON u.Id = a.UserId
             WHERE s.WorkflowId = @w`,
            [{ name: 'w', type: sql.Int, value: t.workflowId }],
          )
        ).recordset
      : [];
    const roleLabel: Record<string, string> = { faculty: 'Faculty', admin: 'Administrators', super_admin: 'Super administrators' };
    const approverLabels = (wsId: number | null) =>
      approverRows
        .filter((a) => a.StageId === wsId)
        .map((a) => (a.ApproverType === 'group' ? a.GroupName : a.ApproverType === 'role' ? roleLabel[a.RoleName] ?? a.RoleName : staff ? a.UserName : 'Assigned reviewer'));

    // Notes: students/agencies see only student-facing ones; admins see all; other staff see internal
    // notes only for stages they approve (or that they wrote).
    const noteRows = (
      await this.db.query(
        `SELECT n.Id, n.TranscriptStageId, n.Audience, n.Kind, n.AuthorUserId, n.AuthorRole, n.Body, n.CreatedAt,
                u.FirstName + ' ' + u.LastName AS AuthorName, ts.WorkflowStageId
         FROM TranscriptNotes n
         LEFT JOIN Users u ON u.Id = n.AuthorUserId
         LEFT JOIN TranscriptStages ts ON ts.Id = n.TranscriptStageId
         WHERE n.TranscriptId = @t ORDER BY n.CreatedAt, n.Id`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      )
    ).recordset;
    const requestStageIds = stages.recordset.map((s) => s.WorkflowStageId as number | null);
    const involved = mine === null || requestStageIds.some((id) => id != null && mine.has(id));
    const canSeeNote = (n: (typeof noteRows)[number]) => {
      if (n.Audience === 'student') return true;
      if (!staff) return false;
      if (readOnly) return !!n.AuthorUserId && String(n.AuthorUserId).toLowerCase() === viewer.id.toLowerCase();
      if (mine === null) return true;
      if (n.AuthorUserId && String(n.AuthorUserId).toLowerCase() === viewer.id.toLowerCase()) return true;
      return n.WorkflowStageId != null ? mine.has(n.WorkflowStageId) : involved;
    };
    const visibleNotes = noteRows.filter(canSeeNote);

    const active = stages.recordset.find((s) => s.Status === 'active');
    const canAct = !readOnly && !!active && active.StageType !== 'system' && staff && actsOn(active.WorkflowStageId);
    const admin = isAdminRole(viewer.role) && !readOnly;
    const workflowActive = t.workflowStatus === 'active';
    const now = Date.now();

    // These lookups are independent: run them together instead of one round trip after another.
    const [reminders, checklist, docs, policyExtras, deadlineMap] = await Promise.all([
      this.db.query<{ Direction: string; Last: Date }>(
        `SELECT Direction, MAX(CreatedAt) AS Last FROM StatusReminders WHERE TranscriptId = @t AND RequestedByUserId = @u GROUP BY Direction`,
        [
          { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
          { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
        ],
      ).catch(() => ({ recordset: [] as { Direction: string; Last: Date }[] })),
      t.workflowId ? this.engine.documentChecklist(transcriptId) : Promise.resolve([]),
      this.db.query(
        `SELECT d.Id AS id, d.DocTypeKey AS docTypeKey, dt.Label AS label, d.FileName AS fileName, d.UploadId AS uploadId,
                d.TranscriptCourseId AS transcriptCourseId, tc.CourseCode AS courseCode, d.Notes AS notes, d.CreatedAt AS createdAt
         FROM TranscriptDocuments d JOIN DocumentTypes dt ON dt.DocTypeKey = d.DocTypeKey
         LEFT JOIN TranscriptCourses tc ON tc.Id = d.TranscriptCourseId
         WHERE d.TranscriptId = @t ORDER BY d.CreatedAt`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      ).catch(() => ({ recordset: [] })),
      this.policyExtras(transcriptId, staff),
      this.deadlines.forTranscripts([transcriptId]).catch(() => new Map()),
    ]);
    const lastOf = (d: string) => reminders.recordset.find((r) => r.Direction === d)?.Last ?? null;
    const within = (d: Date | null, hours: number) => !!d && now - new Date(d).getTime() < hours * 3_600_000;
    const { evaluationKind, preapprovalExpiresAt, student, credit } = policyExtras;

    const parseBrief = (raw: string | null) => {
      try {
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };

    return {
      transcript: {
        id: t.id,
        status: t.status,
        workflowStatus: t.workflowStatus,
        receivedAt: t.receivedAt,
        processedAt: t.processedAt,
        studentName: t.studentName,
        studentEmail: staff ? t.studentEmail : undefined,
        institutionName: t.institutionName,
        targetInstitutionName: t.targetInstitutionName,
        documentFileName: t.documentFileName,
        workflow: t.workflowId ? { id: t.workflowId, name: t.workflowName, allowBypass: !!t.allowBypass } : null,
        evaluationKind,
        preapprovalExpiresAt,
        deadline: deadlineMap.get(String(transcriptId).toLowerCase()) ?? null,
      },
      student,
      credit,
      stages: stages.recordset.map((s) => ({
        id: s.Id,
        order: s.StageOrder,
        key: s.StageKey,
        name: s.StageName,
        description: s.Description,
        type: s.StageType,
        agentTask: s.AgentTask,
        status: s.Status,
        activatedAt: s.ActivatedAt,
        dueAt: s.DueAt,
        completedAt: s.CompletedAt,
        avgMinutes: s.WorkflowStageId != null ? avgMinutes.get(s.WorkflowStageId) ?? null : null,
        overdue: s.Status === 'active' && !!s.DueAt && new Date(s.DueAt).getTime() < now,
        decidedBy: s.DecidedByName ? { name: staff ? s.DecidedByName : s.DecidedByRole === 'faculty' ? 'Faculty reviewer' : 'Administrator', role: s.DecidedByRole } : null,
        approvers: s.StageType === 'system' ? [] : approverLabels(s.WorkflowStageId),
        canSkip: admin && workflowActive && s.Status === 'active' && s.StageType !== 'system' && s.CanBypass !== false,
        requiresComment: !!s.RequiresComment,
        aiRecommendation: staff && !readOnly ? s.AiRecommendation : null,
        // Every staff reviewer keeps the per-course detail of a stage they have reached, not just the
        // one that happens to be active right now - a faculty reviewer whose stage has moved on (or
        // who is waiting for an earlier one) still needs the full course list.
        aiBrief: staff && !readOnly ? parseBrief(s.AiBrief) : null,
        notes: visibleNotes
          .filter((n) => n.TranscriptStageId === s.Id)
          .map((n) => ({
            id: n.Id,
            audience: n.Audience,
            kind: n.Kind,
            author: n.AuthorName ? (staff || n.AuthorRole === 'student' || n.AuthorRole === 'agency' ? n.AuthorName : n.AuthorRole === 'faculty' ? 'Faculty reviewer' : 'Administrator') : 'TransferHub',
            authorRole: n.AuthorRole,
            body: n.Body,
            createdAt: n.CreatedAt,
          })),
      })),
      generalNotes: visibleNotes
        .filter((n) => n.TranscriptStageId == null)
        .map((n) => ({ id: n.Id, audience: n.Audience, kind: n.Kind, author: n.AuthorName ?? 'TransferHub', authorRole: n.AuthorRole, body: n.Body, createdAt: n.CreatedAt })),
      permissions: {
        isStaff: staff,
        canAct,
        canAccept: admin && workflowActive && (t.allowBypass == null || !!t.allowBypass),
        canStartWorkflow: admin && !t.workflowId && evaluationKind !== 'preview',
        canMakeOfficial: admin && evaluationKind === 'preview',
        canNoteInternal: staff && !readOnly && (admin || involved),
        readOnly,
        canNoteStudent: true,
        canSeeAiUsage: staff,
      },
      documents: { checklist, uploaded: docs.recordset },
      reminders: {
        canNudge: !staff && workflowActive && !within(lastOf('nudge_staff'), 24),
        canSendUpdate: staff && !readOnly && (admin || involved) && workflowActive && !within(lastOf('update_student'), 12),
        lastNudgeAt: lastOf('nudge_staff'),
        lastUpdateAt: lastOf('update_student'),
        emailConfigured: this.email.isConfigured,
      },
    };
  }

  /**
   * Average minutes a stage of this workflow took over the last 180 days (completed requests, at least 3 samples),
   * used for the student's "estimated finish". Aggregate only - no individual request data. Best-effort.
   */
  private async stageAverages(workflowId: number): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    try {
      const r = await this.db.query<{ WorkflowStageId: number; Mins: number; N: number }>(
        `SELECT ts.WorkflowStageId, AVG(CAST(DATEDIFF(MINUTE, ts.ActivatedAt, ts.CompletedAt) AS FLOAT)) AS Mins, COUNT(*) AS N
         FROM TranscriptStages ts JOIN WorkflowStages ws ON ws.Id = ts.WorkflowStageId
         WHERE ws.WorkflowId = @w AND ts.Status IN ('approved','bypassed') AND ts.ActivatedAt IS NOT NULL AND ts.CompletedAt IS NOT NULL
           AND ts.CompletedAt > DATEADD(DAY, -180, SYSUTCDATETIME())
         GROUP BY ts.WorkflowStageId`,
        [{ name: 'w', type: sql.Int, value: workflowId }],
      );
      for (const row of r.recordset) if (row.N >= 3 && row.Mins != null) out.set(row.WorkflowStageId, Math.max(0, Math.round(row.Mins)));
    } catch {
      // estimate is optional
    }
    return out;
  }

  // ── queue ───────────────────────────────────────────────────

  async queue(viewer: Viewer, scope: 'mine' | 'all') {
    const mine = await this.myStageIds(viewer);
    const qInputs: QueryInput[] = [];
    const adminScope = await this.scopeSvc.universityScope(viewer);
    const scopeSql = adminScope ? ` AND ${this.scopeSvc.transcriptInScope(adminScope, 't', qInputs)}` : '';
    const res = await this.db.query(
      `SELECT ts.Id AS stageId, ts.TranscriptId AS transcriptId, ts.WorkflowStageId, ts.StageName AS stageName, ts.ActivatedAt AS activatedAt,
              ts.DueAt AS dueAt, ts.AiRecommendation AS aiRecommendation, ts.AiBrief,
              t.ReceivedAt AS receivedAt, u.FirstName + ' ' + u.LastName AS studentName, i.Name AS institutionName,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id) AS courseCount
       FROM TranscriptStages ts
       JOIN Transcripts t ON t.Id = ts.TranscriptId
       JOIN Users u ON u.Id = t.StudentUserId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE ts.Status = 'active' AND ts.StageType <> 'system' AND t.WorkflowStatus = 'active'${scopeSql}
       ORDER BY CASE WHEN ts.DueAt IS NULL THEN 1 ELSE 0 END, ts.DueAt, ts.ActivatedAt`,
      qInputs,
    );
    const now = Date.now();
    const allRows = res.recordset.map((r) => {
      let flags = 0;
      try {
        flags = r.AiBrief ? (JSON.parse(r.AiBrief).flags?.length ?? 0) : 0;
      } catch {
        flags = 0;
      }
      const canAct = mine === null ? true : r.WorkflowStageId != null && mine.has(r.WorkflowStageId);
      const explicit = mine === null ? false : canAct;
      return {
        stageId: r.stageId,
        transcriptId: r.transcriptId,
        studentName: r.studentName,
        institutionName: r.institutionName,
        stageName: r.stageName,
        activatedAt: r.activatedAt,
        dueAt: r.dueAt,
        overdue: !!r.dueAt && new Date(r.dueAt).getTime() < now,
        aiRecommendation: r.aiRecommendation,
        flagCount: flags,
        courseCount: r.courseCount,
        canAct,
        assignedToMe: explicit,
      };
    });
    const dl = await this.deadlines.forTranscripts(allRows.map((r) => String(r.transcriptId))).catch(() => new Map());
    const rows = allRows.map((r) => {
      const d = dl.get(String(r.transcriptId).toLowerCase());
      return { ...r, deadline: d ? { state: d.state, daysLeft: d.daysLeft, deadlineOn: d.deadlineOn, isEstimate: d.isEstimate } : null };
    });
    const visible = scope === 'all' && isAdminRole(viewer.role) ? rows : rows.filter((r) => r.canAct);
    return {
      scope: scope === 'all' && isAdminRole(viewer.role) ? 'all' : 'mine',
      total: visible.length,
      overdue: visible.filter((r) => r.overdue).length,
      rows: visible,
    };
  }

  // ── notes ───────────────────────────────────────────────────

  async postNote(transcriptId: string, viewer: Viewer, dto: { audience: 'internal' | 'student'; body: string; stageId?: number }) {
    await this.assertCanWork(transcriptId, viewer);
    const owner = isOwnerRole(viewer.role);
    if (owner && dto.audience === 'internal') throw new ForbiddenException('Internal notes are for staff only.');

    const active = await this.db.query<{ Id: number; WorkflowStageId: number | null }>(
      `SELECT TOP 1 Id, WorkflowStageId FROM TranscriptStages WHERE TranscriptId = @t AND Status = 'active' ORDER BY StageOrder`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    let stageId: number | null = dto.stageId ?? active.recordset[0]?.Id ?? null;
    let stageWsId: number | null = active.recordset[0]?.WorkflowStageId ?? null;
    if (dto.stageId) {
      const s = await this.db.query<{ Id: number; WorkflowStageId: number | null }>(
        `SELECT Id, WorkflowStageId FROM TranscriptStages WHERE Id = @s AND TranscriptId = @t`,
        [
          { name: 's', type: sql.Int, value: dto.stageId },
          { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        ],
      );
      if (!s.recordset[0]) throw new BadRequestException('That stage does not belong to this request.');
      stageId = s.recordset[0].Id;
      stageWsId = s.recordset[0].WorkflowStageId;
    }

    if (!owner) {
      const mine = await this.myStageIds(viewer);
      const allowed =
        mine === null ||
        (stageWsId != null && mine.has(stageWsId)) ||
        (stageWsId == null && (await this.involvedIn(transcriptId, mine)));
      if (!allowed) throw new ForbiddenException('You are not an approver for this request.');
    }
    await this.engine.addNote(transcriptId, stageId, dto.audience, 'note', viewer.id, viewer.role, dto.body.trim());
    return this.getTimeline(transcriptId, viewer);
  }

  private async involvedIn(transcriptId: string, mine: Set<number> | null): Promise<boolean> {
    if (mine === null) return true;
    const res = await this.db.query<{ WorkflowStageId: number | null }>(
      `SELECT WorkflowStageId FROM TranscriptStages WHERE TranscriptId = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    return res.recordset.some((r) => r.WorkflowStageId != null && mine.has(r.WorkflowStageId));
  }

  // ── documents ───────────────────────────────────────────────

  async addDocument(
    transcriptId: string,
    viewer: Viewer,
    dto: { docTypeKey: string; uploadId: string; transcriptCourseId?: string; notes?: string },
  ) {
    await this.assertCanView(transcriptId, viewer);
    // Re-checks that the caller owns (or, for staff, may read) the upload — an id alone is never trusted.
    const up = await this.uploads.getForAuthenticatedUser(dto.uploadId, { id: viewer.id, role: viewer.role });
    await this.db.query(
      `INSERT INTO TranscriptDocuments (TranscriptId, TranscriptCourseId, DocTypeKey, UploadId, FileName, Notes, CreatedBy)
       VALUES (@t, @c, @k, @u, @f, @n, @by)`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 'c', type: sql.UniqueIdentifier, value: dto.transcriptCourseId ?? null },
        { name: 'k', type: sql.VarChar(40), value: dto.docTypeKey },
        { name: 'u', type: sql.UniqueIdentifier, value: dto.uploadId },
        { name: 'f', type: sql.NVarChar(300), value: up.fileName },
        { name: 'n', type: sql.NVarChar(500), value: dto.notes ?? null },
        { name: 'by', type: sql.UniqueIdentifier, value: viewer.id },
      ],
    );
    await this.engine.addNote(transcriptId, null, 'internal', 'system', null, null, `${viewer.role === 'student' || viewer.role === 'agency' ? 'The student' : 'Staff'} added a document: ${up.fileName}.`);
    this.bus?.emit({ type: 'document_added', transcriptId, text: 'A document was added to the request' });
    return this.getTimeline(transcriptId, viewer);
  }

  async removeDocument(transcriptId: string, docId: number, viewer: Viewer) {
    await this.assertCanView(transcriptId, viewer);
    const doc = await this.db.query<{ CreatedBy: string }>(
      `SELECT CreatedBy FROM TranscriptDocuments WHERE Id = @d AND TranscriptId = @t`,
      [
        { name: 'd', type: sql.Int, value: docId },
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
      ],
    );
    if (!doc.recordset[0]) throw new NotFoundException('Document not found');
    if (!isAdminRole(viewer.role) && String(doc.recordset[0].CreatedBy).toLowerCase() !== viewer.id.toLowerCase()) {
      throw new ForbiddenException('You can only remove documents you added.');
    }
    await this.db.query(`DELETE FROM TranscriptDocuments WHERE Id = @d`, [{ name: 'd', type: sql.Int, value: docId }]);
    return this.getTimeline(transcriptId, viewer);
  }

  // ── reminders ───────────────────────────────────────────────

  /**
   * Student/agency -> nudges whoever owns the current stage. Staff -> emails
   * the student a status update. Rate-limited (24h / 12h) and always logged.
   */
  async remind(transcriptId: string, viewer: Viewer, message?: string) {
    await this.assertCanWork(transcriptId, viewer);
    const t = await this.db.query<{ WorkflowStatus: string | null; Email: string; FirstName: string; StudentName: string }>(
      `SELECT t.WorkflowStatus, u.Email, u.FirstName, u.FirstName + ' ' + u.LastName AS StudentName
       FROM Transcripts t JOIN Users u ON u.Id = t.StudentUserId WHERE t.Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const info = t.recordset[0];
    if (!info) throw new NotFoundException('Request not found');
    if (info.WorkflowStatus !== 'active') throw new BadRequestException('This request is not waiting on anyone.');

    const owner = isOwnerRole(viewer.role);
    const direction = owner ? 'nudge_staff' : 'update_student';
    const windowHours = owner ? 24 : 12;
    const recent = await this.db.query(
      `SELECT TOP 1 1 AS x FROM StatusReminders
       WHERE TranscriptId = @t AND RequestedByUserId = @u AND Direction = @d AND CreatedAt > DATEADD(HOUR, -@h, SYSUTCDATETIME())`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
        { name: 'd', type: sql.VarChar(14), value: direction },
        { name: 'h', type: sql.Int, value: windowHours },
      ],
    );
    if (recent.recordset[0]) {
      throw new HttpException(`You already sent a reminder recently. You can send another every ${windowHours} hours.`, 429);
    }

    const active = await this.db.query<{ Id: number; WorkflowStageId: number | null; StageName: string; ActivatedAt: Date | null }>(
      `SELECT TOP 1 Id, WorkflowStageId, StageName, ActivatedAt FROM TranscriptStages WHERE TranscriptId = @t AND Status = 'active' ORDER BY StageOrder`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const stage = active.recordset[0];
    const text = message?.trim();
    let recipients = 0;

    if (owner) {
      let people = await this.workflows.resolveApprovers(stage?.WorkflowStageId ?? null);
      if (!people.length) people = await this.workflows.admins();
      const waiting = stage?.ActivatedAt ? Math.max(0, Math.floor((Date.now() - new Date(stage.ActivatedAt).getTime()) / 86_400_000)) : 0;
      for (const p of people) {
        await this.email.sendEmail(p.email, templates.studentAskedForUpdate(this.email.context, {
          name: p.name, student: info.StudentName, stage: stage?.StageName ?? 'review', waitingDays: waiting, message: text, transcriptId,
        }));
        recipients++;
      }
      await this.engine.addNote(transcriptId, stage?.Id ?? null, 'student', 'system', null, null, `You asked for an update on "${stage?.StageName ?? 'your request'}".`);
      await this.engine.addNote(transcriptId, stage?.Id ?? null, 'internal', 'system', null, null, `The student asked for an update${text ? `: ${text}` : '.'}`);
    } else {
      const mine = await this.myStageIds(viewer);
      if (!(mine === null || (await this.involvedIn(transcriptId, mine)))) throw new ForbiddenException('You are not an approver for this request.');
      const latest = await this.db.query<{ Body: string }>(
        `SELECT TOP 1 Body FROM TranscriptNotes WHERE TranscriptId = @t AND Audience = 'student' AND Kind IN ('note','decision') ORDER BY Id DESC`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      await this.email.sendEmail(info.Email, templates.statusUpdate(this.email.context, {
        firstName: info.FirstName,
        stage: stage?.StageName ?? 'review',
        message: text || latest.recordset[0]?.Body || null,
        messageLabel: text ? 'Message from the reviewer' : 'Latest comment',
        transcriptId,
      }));
      recipients = 1;
      await this.engine.addNote(transcriptId, stage?.Id ?? null, 'student', 'system', null, null, `A status update was emailed to you${text ? `: ${text}` : '.'}`);
    }

    await this.db.query(
      `INSERT INTO StatusReminders (TranscriptId, Direction, RequestedByUserId, TranscriptStageId, RecipientCount, Message, Success)
       VALUES (@t, @d, @u, @s, @n, @m, @ok)`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 'd', type: sql.VarChar(14), value: direction },
        { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
        { name: 's', type: sql.Int, value: stage?.Id ?? null },
        { name: 'n', type: sql.Int, value: recipients },
        { name: 'm', type: sql.NVarChar(500), value: text ?? null },
        { name: 'ok', type: sql.Bit, value: this.email.isConfigured ? 1 : 0 },
      ],
    );
    this.bus?.emit({ type: 'reminder_sent', transcriptId, audience: direction === 'update_student' ? 'all' : 'staff', text: 'A status reminder was sent' });
    return { sent: recipients, direction, emailConfigured: this.email.isConfigured };
  }

  usageForRequest(transcriptId: string) {
    return this.aiUsage.forTranscript(transcriptId);
  }
}
