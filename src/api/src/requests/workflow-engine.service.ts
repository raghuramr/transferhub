import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { AiService } from '../ai/ai.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import { SchemaService } from '../policy/schema.service';
import { TransferPolicyService, parseFlags, type PolicyFlag } from '../policy/transfer-policy.service';

export interface Actor {
  id: string;
  role: string;
  firstName?: string;
  lastName?: string;
}

export interface StageRow {
  Id: number;
  TranscriptId: string;
  WorkflowStageId: number | null;
  StageOrder: number;
  StageKey: string;
  StageName: string;
  StageType: 'system' | 'review' | 'approval';
  AgentTask: string;
  Status: string;
  SlaDays: number | null;
  RequiresComment: boolean | null;
  CanBypass: boolean | null;
}

export interface ChecklistItem {
  docTypeKey: string;
  label: string;
  perCourse: boolean;
  required: boolean;
  uploaded: number;
  /** How many uploads satisfy it (per-course syllabi: one per course still under review). */
  needed: number;
}

const STAFF_ADMIN = ['admin', 'super_admin'];
export const isAdminRole = (role: string) => STAFF_ADMIN.includes(role);

const STAGE_SELECT = `
  SELECT ts.Id, ts.TranscriptId, ts.WorkflowStageId, ts.StageOrder, ts.StageKey, ts.StageName, ts.StageType, ts.AgentTask, ts.Status,
         ws.SlaDays, ws.RequiresComment, ws.CanBypass
  FROM TranscriptStages ts LEFT JOIN WorkflowStages ws ON ws.Id = ts.WorkflowStageId`;

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private db: DatabaseService,
    private workflows: WorkflowsService,
    private ai: AiService,
    private email: EmailService,
    private schema: SchemaService,
    private policy: TransferPolicyService,
  ) {}

  // ── starting ────────────────────────────────────────────────

  /**
   * Puts a freshly submitted request into the intaking university's
   * workflow (or the global default) and runs it up to the first human
   * stage. Safe to call twice: a request already in a workflow is left alone.
   */
  async startWorkflow(transcriptId: string, actorUserId: string): Promise<boolean> {
    const t = await this.db.query<{ StudentUserId: string; WorkflowId: number | null }>(
      `SELECT StudentUserId, WorkflowId FROM Transcripts WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    if (!t.recordset[0]) throw new NotFoundException('Transcript not found');
    if (t.recordset[0].WorkflowId) return false;

    let target: number | null = null;
    try {
      const sp = await this.db.query<{ T: number | null }>(
        `SELECT TargetInstitutionId AS T FROM StudentProfiles WHERE UserId = @u`,
        [{ name: 'u', type: sql.UniqueIdentifier, value: t.recordset[0].StudentUserId }],
      );
      target = sp.recordset[0]?.T ?? null;
    } catch {
      // StudentProfiles.TargetInstitutionId predates nothing important — fall back to BU below.
    }
    if (!target) {
      const bu = await this.db.query<{ Id: number }>(`SELECT TOP 1 Id FROM Institutions WHERE Code = 'BU'`);
      target = bu.recordset[0]?.Id ?? null;
    }

    const wf = await this.workflows.resolveForInstitution(target);
    if (!wf) return false;
    const stages = (await this.workflows.getStages(wf.id)).filter((s) => s.isEnabled);
    if (!stages.length) return false;

    await this.db.query(
      `UPDATE Transcripts SET TargetInstitutionId = @t, WorkflowId = @w, WorkflowStatus = 'active', CurrentStageOrder = NULL WHERE Id = @id`,
      [
        { name: 't', type: sql.Int, value: target },
        { name: 'w', type: sql.Int, value: wf.id },
        { name: 'id', type: sql.UniqueIdentifier, value: transcriptId },
      ],
    );
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      await this.db.query(
        `INSERT INTO TranscriptStages (TranscriptId, WorkflowStageId, StageOrder, StageKey, StageName, StageType, AgentTask)
         VALUES (@t, @ws, @o, @k, @n, @ty, @a)`,
        [
          { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
          { name: 'ws', type: sql.Int, value: s.id },
          { name: 'o', type: sql.Int, value: i + 1 },
          { name: 'k', type: sql.VarChar(40), value: s.stageKey },
          { name: 'n', type: sql.NVarChar(120), value: s.name },
          { name: 'ty', type: sql.VarChar(12), value: s.stageType },
          { name: 'a', type: sql.VarChar(12), value: s.agentTask },
        ],
      );
    }
    // The AI pre-match can take a while (one model call per unmatched course), so it must not hold up
    // the student's submit request: system stages after the first human-visible state run in the background.
    await this.advance(transcriptId, 0, actorUserId, 'approved', true);
    return true;
  }

  /** Admin: re-run an automatic stage that stalled (e.g. the app restarted mid-match). Safe to repeat. */
  async resume(transcriptId: string, actor: Actor) {
    if (!isAdminRole(actor.role)) throw new ForbiddenException('Only an admin can resume automation.');
    const { stage } = await this.loadActive(transcriptId);
    if (stage.StageType !== 'system') throw new BadRequestException('The current stage is waiting for a person, not for automation.');
    await this.runAgentTask(transcriptId, stage, actor.id, 'approved');
    await this.completeStage(stage.Id, 'approved', null);
    await this.advance(transcriptId, stage.StageOrder, actor.id);
    return { message: 'Automation resumed' };
  }

  /**
   * Admin: the student has been admitted, so their preview request(s) become official evaluations
   * and enter the approval workflow (BU only evaluates after admission).
   */
  async makeOfficial(transcriptId: string, actor: Actor) {
    if (!isAdminRole(actor.role)) throw new ForbiddenException('Only an admin can mark a student admitted.');
    if (!(await this.schema.policyReady())) throw new BadRequestException('Database migration 015 is not applied yet.');
    const t = await this.db.query<{ StudentUserId: string; EvaluationKind: string }>(
      `SELECT StudentUserId, EvaluationKind FROM Transcripts WHERE Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const row = t.recordset[0];
    if (!row) throw new NotFoundException('Transcript not found');
    if (row.EvaluationKind !== 'preview') throw new BadRequestException('This request is already an official evaluation.');

    await this.db.query(
      `IF EXISTS (SELECT 1 FROM StudentProfiles WHERE UserId = @u)
         UPDATE StudentProfiles SET AdmissionStatus = 'admitted',
                ApplicantType = CASE WHEN ApplicantType = 'transfer_applicant' THEN 'admitted_transfer' ELSE ApplicantType END,
                UpdatedAt = SYSUTCDATETIME()
         WHERE UserId = @u
       ELSE INSERT INTO StudentProfiles (UserId, AdmissionStatus) VALUES (@u, 'admitted')`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: row.StudentUserId }],
    );
    const previews = await this.db.query<{ Id: string }>(
      `SELECT Id FROM Transcripts WHERE StudentUserId = @u AND EvaluationKind = 'preview'`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: row.StudentUserId }],
    );
    for (const p of previews.recordset) {
      await this.db.query(`UPDATE Transcripts SET EvaluationKind = 'official', Status = 'processing' WHERE Id = @t`, [
        { name: 't', type: sql.UniqueIdentifier, value: p.Id },
      ]);
      await this.policy.applyToTranscript(p.Id).catch(() => undefined);
      await this.addNote(p.Id, null, 'student', 'system', null, null,
        'You have been admitted, so this is now an official credit evaluation. Your request has entered the review process.');
      await this.startWorkflow(p.Id, actor.id);
    }
    return { message: `Student marked admitted; ${previews.recordset.length} request(s) moved to official evaluation.` };
  }

  // ── stage progression ───────────────────────────────────────

  private async nextStage(transcriptId: string, afterOrder: number): Promise<StageRow | null> {
    const res = await this.db.query<StageRow>(
      `${STAGE_SELECT}
       WHERE ts.TranscriptId = @t AND ts.StageOrder > @o AND ts.Status IN ('pending','returned')
       ORDER BY ts.StageOrder OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 'o', type: sql.Int, value: afterOrder },
      ],
    );
    return res.recordset[0] ?? null;
  }

  /** Activates the next stage; system stages run inline until a human stage (or the end of the chain). */
  private async advance(
    transcriptId: string,
    afterOrder: number,
    actorUserId: string,
    outcome: 'approved' | 'bypassed' = 'approved',
    background = false,
  ) {
    let order = afterOrder;
    for (let guard = 0; guard < 50; guard++) {
      const next = await this.nextStage(transcriptId, order);
      if (!next) {
        await this.finalize(transcriptId, outcome, actorUserId);
        return;
      }
      await this.activate(next);
      if (next.StageType !== 'system') {
        await this.onHumanStageActivated(transcriptId, next, actorUserId);
        return;
      }
      if (background && next.AgentTask === 'match') {
        void (async () => {
          await this.runAgentTask(transcriptId, next, actorUserId, outcome);
          await this.completeStage(next.Id, 'approved', null);
          await this.advance(transcriptId, next.StageOrder, actorUserId, outcome);
        })().catch((e) => this.logger.error(`Background pipeline failed for ${transcriptId}: ${(e as Error).message}`));
        return;
      }
      await this.runAgentTask(transcriptId, next, actorUserId, outcome);
      await this.completeStage(next.Id, 'approved', null);
      order = next.StageOrder;
    }
  }

  private async activate(s: StageRow) {
    await this.db.query(
      `UPDATE TranscriptStages
       SET Status = 'active', ActivatedAt = SYSUTCDATETIME(),
           DueAt = CASE WHEN @sla IS NULL THEN NULL ELSE DATEADD(DAY, @sla, SYSUTCDATETIME()) END,
           CompletedAt = NULL, DecidedByUserId = NULL
       WHERE Id = @id`,
      [
        { name: 'sla', type: sql.Int, value: s.SlaDays },
        { name: 'id', type: sql.Int, value: s.Id },
      ],
    );
    await this.db.query(`UPDATE Transcripts SET CurrentStageOrder = @o WHERE Id = @t`, [
      { name: 'o', type: sql.Int, value: s.StageOrder },
      { name: 't', type: sql.UniqueIdentifier, value: s.TranscriptId },
    ]);
  }

  private async completeStage(stageId: number, status: string, decidedBy: string | null) {
    await this.db.query(
      `UPDATE TranscriptStages SET Status = @s, CompletedAt = SYSUTCDATETIME(), DecidedByUserId = @u WHERE Id = @id`,
      [
        { name: 's', type: sql.VarChar(10), value: status },
        { name: 'u', type: sql.UniqueIdentifier, value: decidedBy },
        { name: 'id', type: sql.Int, value: stageId },
      ],
    );
  }

  // ── agent tasks ─────────────────────────────────────────────

  private async runAgentTask(transcriptId: string, stage: StageRow, actorUserId: string, outcome: 'approved' | 'bypassed') {
    try {
      if (stage.AgentTask === 'intake') {
        const missing = (await this.documentChecklist(transcriptId)).filter((c) => c.required && c.uploaded < c.needed);
        if (missing.length) {
          await this.addNote(transcriptId, stage.Id, 'internal', 'system', null, null,
            `Document check: still missing ${missing.map((m) => m.label).join(', ')}.`);
          await this.addNote(transcriptId, stage.Id, 'student', 'system', null, null,
            `We still need: ${missing.map((m) => m.label).join(', ')}. Please add them to your request.`);
        }
      } else if (stage.AgentTask === 'match') {
        const r = await this.ai.matchQueuedForTranscript(transcriptId, actorUserId);
        const parts = [`${r.matched} matched`, `${r.fromCache} of those reused from earlier requests`];
        if (r.skipped) parts.push(`${r.skipped} skipped${r.reasons.length ? ` (${r.reasons.join('; ')})` : ''}`);
        if (r.failed) parts.push(`${r.failed} failed`);
        await this.addNote(transcriptId, stage.Id, 'internal', 'system', null, null, `AI pre-match: ${parts.join(', ')}.`);
      } else if (stage.AgentTask === 'finalize') {
        await this.finalize(transcriptId, outcome, actorUserId);
      }
    } catch (err) {
      this.logger.error(`Agent task ${stage.AgentTask} failed for ${transcriptId}: ${(err as Error).message}`);
      await this.addNote(transcriptId, stage.Id, 'internal', 'system', null, null,
        `Automated step "${stage.AgentTask}" failed (${(err as Error).message}). A reviewer can continue manually.`).catch(() => undefined);
    }
  }

  // ── human stage hooks ───────────────────────────────────────

  private async onHumanStageActivated(transcriptId: string, stage: StageRow, actorUserId: string) {
    try {
      const { brief, recommendation } = await this.buildBrief(transcriptId);
      await this.db.query(
        `UPDATE TranscriptStages SET AiBrief = @b, AiRecommendation = @r, BriefGeneratedAt = SYSUTCDATETIME() WHERE Id = @id`,
        [
          { name: 'b', type: sql.NVarChar(sql.MAX), value: JSON.stringify(brief) },
          { name: 'r', type: sql.VarChar(10), value: recommendation },
          { name: 'id', type: sql.Int, value: stage.Id },
        ],
      );
    } catch (err) {
      this.logger.warn(`Could not build brief for ${transcriptId}: ${(err as Error).message}`);
    }
    try {
      if (await this.tryAutoApprove(transcriptId, stage, actorUserId)) return;
    } catch (err) {
      this.logger.warn(`Auto-approve failed for ${transcriptId}; leaving the stage for a person: ${(err as Error).message}`);
    }
    await this.addNote(transcriptId, stage.Id, 'student', 'system', null, null, `Your request is now in "${stage.StageName}".`);
    void this.notifyApprovers(transcriptId, stage).catch((e) => this.logger.warn(`Approver email failed: ${(e as Error).message}`));
  }

  // ── automation: accepting AI suggestions, auto-approving clean stages ──

  /** Records the AI's suggested course as the decision for every undecided course at or above `minConfidence`. */
  private async applySuggestions(transcriptId: string, userId: string, minConfidence: number, by: string) {
    const rows = await this.db.query<{ EvalId: string; Conf: number; SugId: number; BuCredits: number }>(
      `SELECT e.Id AS EvalId, e.AIConfidence AS Conf, e.AISuggestedCourseId AS SugId, c.Credits AS BuCredits
       FROM Evaluations e
       JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       JOIN Courses c ON c.Id = e.AISuggestedCourseId
       WHERE tc.TranscriptId = @t AND e.Status IN ('queued','in_progress') AND e.AISuggestedCourseId IS NOT NULL`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    let accepted = 0;
    let belowThreshold = 0;
    for (const r of rows.recordset) {
      if (r.Conf == null || Number(r.Conf) < minConfidence) {
        belowThreshold++;
        continue;
      }
      await this.db.execute('sp_RecordDecision', [
        { name: 'EvaluationId', type: sql.UniqueIdentifier, value: r.EvalId },
        { name: 'DecidedBy', type: sql.UniqueIdentifier, value: userId },
        { name: 'Outcome', type: sql.VarChar(20), value: 'equivalent' },
        { name: 'BUCourseId', type: sql.Int, value: r.SugId },
        { name: 'AwardedCredits', type: sql.Decimal(5, 2), value: r.BuCredits },
        { name: 'EvaluatorNotes', type: sql.NVarChar(sql.MAX), value: `Accepted the AI suggestion (${Math.round(Number(r.Conf) * 100)}% confidence) - ${by}` },
      ]);
      accepted++;
    }
    return { accepted, belowThreshold };
  }

  /** An approver accepts every AI suggestion that is confident enough in one click, then reviews only what is left. */
  async acceptSuggestions(transcriptId: string, actor: Actor, minConfidence: number) {
    const { stage } = await this.loadActive(transcriptId);
    if (stage.StageType === 'system') throw new BadRequestException('This stage is automatic.');
    if (!(await this.canAct(actor, stage))) throw new ForbiddenException('You are not an approver for this stage.');
    const r = await this.applySuggestions(transcriptId, actor.id, minConfidence, `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || 'reviewer');
    if (r.accepted) {
      await this.addNote(transcriptId, stage.Id, 'internal', 'decision', actor.id, actor.role,
        `Accepted ${r.accepted} AI suggestion(s) at ${Math.round(minConfidence * 100)}% confidence or higher${r.belowThreshold ? `; ${r.belowThreshold} left for review` : ''}.`);
      // Refresh the brief so the page shows the new state.
      const { brief, recommendation } = await this.buildBrief(transcriptId);
      await this.db.query(
        `UPDATE TranscriptStages SET AiBrief = @b, AiRecommendation = @r, BriefGeneratedAt = SYSUTCDATETIME() WHERE Id = @id`,
        [
          { name: 'b', type: sql.NVarChar(sql.MAX), value: JSON.stringify(brief) },
          { name: 'r', type: sql.VarChar(10), value: recommendation },
          { name: 'id', type: sql.Int, value: stage.Id },
        ],
      );
    }
    return r;
  }

  /**
   * If the stage is set to auto-approve: accept confident AI suggestions, and when that leaves nothing
   * flagged, approve the stage as the agent. Otherwise explains why a person is still needed.
   * Never rejects, and never runs when the setting (migration 014) is absent.
   */
  private async tryAutoApprove(transcriptId: string, stage: StageRow, actorUserId: string): Promise<boolean> {
    if (!stage.WorkflowStageId) return false;
    let cfg: { AutoApprove: boolean; AutoApproveMinConfidence: number | null } | undefined;
    try {
      const r = await this.db.query<{ AutoApprove: boolean; AutoApproveMinConfidence: number | null }>(
        `SELECT AutoApprove, AutoApproveMinConfidence FROM WorkflowStages WHERE Id = @id`,
        [{ name: 'id', type: sql.Int, value: stage.WorkflowStageId }],
      );
      cfg = r.recordset[0];
    } catch {
      return false; // migration 014 not applied
    }
    if (!cfg?.AutoApprove) return false;
    const min = cfg.AutoApproveMinConfidence != null ? Number(cfg.AutoApproveMinConfidence) : 0.85;
    const pct = Math.round(min * 100);

    await this.applySuggestions(transcriptId, actorUserId, min, 'the agent');
    const { brief, recommendation } = await this.buildBrief(transcriptId);
    await this.db.query(
      `UPDATE TranscriptStages SET AiBrief = @b, AiRecommendation = @r, BriefGeneratedAt = SYSUTCDATETIME() WHERE Id = @id`,
      [
        { name: 'b', type: sql.NVarChar(sql.MAX), value: JSON.stringify(brief) },
        { name: 'r', type: sql.VarChar(10), value: recommendation },
        { name: 'id', type: sql.Int, value: stage.Id },
      ],
    );
    if (recommendation !== 'approve' || brief.totals.courses === 0) {
      const why = brief.flags.length ? brief.flags.join('; ') : 'there is nothing to approve yet';
      await this.addNote(transcriptId, stage.Id, 'internal', 'system', null, null, `Auto-approve (${pct}%) did not apply, so a person needs to review: ${why}.`);
      return false;
    }

    await this.completeStage(stage.Id, 'approved', null);
    try {
      await this.db.query(`UPDATE TranscriptStages SET AutoApproved = 1 WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: stage.Id }]);
    } catch {
      // flag column missing: the note below still records it
    }
    await this.addNote(transcriptId, stage.Id, 'internal', 'decision', null, null,
      `Auto-approved by the agent: ${brief.totals.courses} course(s), every match at ${pct}% confidence or higher, documents complete, nothing flagged.`);
    await this.addNote(transcriptId, stage.Id, 'student', 'system', null, null, `"${stage.StageName}" was completed automatically.`);
    await this.advance(transcriptId, stage.StageOrder, actorUserId);
    return true;
  }

  async notifyApprovers(transcriptId: string, stage: Pick<StageRow, 'WorkflowStageId' | 'StageName'>) {
    let people = await this.workflows.resolveApprovers(stage.WorkflowStageId);
    if (!people.length) people = await this.workflows.admins();
    const info = await this.db.query<{ Student: string }>(
      `SELECT u.FirstName + ' ' + u.LastName AS Student FROM Transcripts t JOIN Users u ON u.Id = t.StudentUserId WHERE t.Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    for (const p of people) {
      await this.email.sendEmail(p.email, templates.approverAction(this.email.context, {
        name: p.name, student: info.recordset[0]?.Student ?? 'a student', stage: stage.StageName, transcriptId,
      }));
    }
  }

  // ── decisions ───────────────────────────────────────────────

  private async loadActive(transcriptId: string): Promise<{ stage: StageRow; wfStatus: string | null }> {
    const t = await this.db.query<{ WorkflowStatus: string | null }>(`SELECT WorkflowStatus FROM Transcripts WHERE Id = @t`, [
      { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
    ]);
    if (!t.recordset[0]) throw new NotFoundException('Transcript not found');
    if (t.recordset[0].WorkflowStatus !== 'active') throw new BadRequestException('This request is not in an active workflow.');
    const res = await this.db.query<StageRow>(
      `${STAGE_SELECT} WHERE ts.TranscriptId = @t AND ts.Status = 'active' ORDER BY ts.StageOrder`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const stage = res.recordset[0];
    if (!stage) throw new BadRequestException('This request has no active stage.');
    return { stage, wfStatus: t.recordset[0].WorkflowStatus };
  }

  async canAct(actor: Actor, stage: Pick<StageRow, 'WorkflowStageId'>): Promise<boolean> {
    if (isAdminRole(actor.role)) return true;
    return this.workflows.isApprover(actor.id, stage.WorkflowStageId);
  }

  async decide(
    transcriptId: string,
    actor: Actor,
    dto: { decision: 'approve' | 'reject' | 'return'; comment?: string; studentComment?: string },
  ) {
    const { stage } = await this.loadActive(transcriptId);
    if (stage.StageType === 'system') throw new BadRequestException('This stage is automatic.');
    if (!(await this.canAct(actor, stage))) throw new ForbiddenException('You are not an approver for this stage.');

    const internal = dto.comment?.trim() || '';
    const forStudent = dto.studentComment?.trim() || '';
    if (dto.decision === 'reject' && !forStudent && !internal) {
      throw new BadRequestException('Give a reason when rejecting — the student sees the student-facing comment.');
    }
    if (dto.decision === 'approve' && stage.RequiresComment && !internal && !forStudent) {
      throw new BadRequestException(`"${stage.StageName}" requires a comment.`);
    }

    const verb = dto.decision === 'approve' ? 'approved' : dto.decision === 'reject' ? 'rejected' : 'returned';
    if (dto.decision === 'return') {
      const prev = await this.db.query<{ Id: number; StageOrder: number }>(
        `SELECT TOP 1 Id, StageOrder FROM TranscriptStages
         WHERE TranscriptId = @t AND StageOrder < @o AND StageType <> 'system' AND Status IN ('approved','bypassed')
         ORDER BY StageOrder DESC`,
        [
          { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
          { name: 'o', type: sql.Int, value: stage.StageOrder },
        ],
      );
      if (!prev.recordset[0]) throw new BadRequestException('There is no earlier review stage to send this back to.');
      if (!internal && !forStudent) throw new BadRequestException('Say what needs another look when returning a request.');
      await this.completeStage(stage.Id, 'returned', actor.id);
      await this.addDecisionNotes(transcriptId, stage.Id, actor, `Returned to the previous stage. ${internal}`.trim(), forStudent);
      const prevRow = await this.db.query<StageRow>(`${STAGE_SELECT} WHERE ts.Id = @id`, [
        { name: 'id', type: sql.Int, value: prev.recordset[0].Id },
      ]);
      await this.activate(prevRow.recordset[0]);
      await this.onHumanStageActivated(transcriptId, prevRow.recordset[0], actor.id);
      return { message: 'Returned to the previous stage', workflowStatus: 'active' };
    }

    const changed = await this.db.query(
      `UPDATE TranscriptStages SET Status = @s, CompletedAt = SYSUTCDATETIME(), DecidedByUserId = @u
       WHERE Id = @id AND Status = 'active'`,
      [
        { name: 's', type: sql.VarChar(10), value: verb },
        { name: 'u', type: sql.UniqueIdentifier, value: actor.id },
        { name: 'id', type: sql.Int, value: stage.Id },
      ],
    );
    if (!changed.rowsAffected[0]) throw new BadRequestException('Someone else already decided this stage.');
    await this.addDecisionNotes(transcriptId, stage.Id, actor, `${stage.StageName} ${verb}. ${internal}`.trim(), forStudent);

    if (dto.decision === 'reject') {
      await this.db.query(
        `UPDATE TranscriptStages SET Status = 'skipped' WHERE TranscriptId = @t AND Status IN ('pending','returned')`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      await this.db.query(
        `UPDATE Transcripts SET WorkflowStatus = 'rejected', Status = 'complete', ProcessedAt = SYSUTCDATETIME(), ProcessedBy = @u WHERE Id = @t`,
        [
          { name: 'u', type: sql.UniqueIdentifier, value: actor.id },
          { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        ],
      );
      await this.emailStudent(transcriptId, 'rejected', forStudent || internal, stage.StageName);
      return { message: 'Request rejected', workflowStatus: 'rejected' };
    }

    await this.advance(transcriptId, stage.StageOrder, actor.id);
    const after = await this.db.query<{ WorkflowStatus: string }>(`SELECT WorkflowStatus FROM Transcripts WHERE Id = @t`, [
      { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
    ]);
    return { message: 'Stage approved', workflowStatus: after.recordset[0]?.WorkflowStatus ?? 'active' };
  }

  /** Admin: skip just the current stage (only where the workflow lets that stage be bypassed). */
  async skipStage(transcriptId: string, actor: Actor, reason: string) {
    if (!isAdminRole(actor.role)) throw new ForbiddenException('Only an admin can skip a stage.');
    if (!reason || reason.trim().length < 5) throw new BadRequestException('Give a reason (at least a few words) for skipping.');
    const { stage } = await this.loadActive(transcriptId);
    if (stage.StageType === 'system') throw new BadRequestException('Automatic stages run by themselves.');
    if (stage.CanBypass === false) throw new BadRequestException(`"${stage.StageName}" cannot be skipped in this workflow.`);
    await this.completeStage(stage.Id, 'bypassed', actor.id);
    await this.addNote(transcriptId, stage.Id, 'internal', 'decision', actor.id, actor.role, `Stage skipped by an admin: ${reason.trim()}`);
    await this.addNote(transcriptId, stage.Id, 'student', 'system', null, null, `"${stage.StageName}" was not needed for your request.`);
    await this.advance(transcriptId, stage.StageOrder, actor.id);
    return { message: 'Stage skipped' };
  }

  /** Admin: accept the whole request now, bypassing every remaining stage (if the workflow allows it). */
  async acceptRequest(transcriptId: string, actor: Actor, reason: string) {
    if (!isAdminRole(actor.role)) throw new ForbiddenException('Only an admin can accept a request directly.');
    if (!reason || reason.trim().length < 5) throw new BadRequestException('Give a reason (at least a few words) for accepting directly.');
    const { stage } = await this.loadActive(transcriptId);
    const wf = await this.db.query<{ AllowBypass: boolean | null }>(
      `SELECT w.AllowBypass FROM Transcripts t LEFT JOIN WorkflowDefinitions w ON w.Id = t.WorkflowId WHERE t.Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    if (wf.recordset[0]?.AllowBypass === false) throw new BadRequestException('This university does not allow bypassing its workflow.');

    await this.db.query(
      `UPDATE TranscriptStages SET Status = 'bypassed', CompletedAt = SYSUTCDATETIME(), DecidedByUserId = @u
       WHERE TranscriptId = @t AND StageType <> 'system' AND Status IN ('active','pending','returned')`,
      [
        { name: 'u', type: sql.UniqueIdentifier, value: actor.id },
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
      ],
    );
    await this.addNote(transcriptId, stage.Id, 'internal', 'decision', actor.id, actor.role,
      `Request accepted directly by an admin, bypassing the remaining stages: ${reason.trim()}`);
    await this.advance(transcriptId, stage.StageOrder, actor.id, 'bypassed');
    return { message: 'Request accepted', workflowStatus: 'bypassed' };
  }

  // ── finishing ───────────────────────────────────────────────

  /** Posts every decided evaluation, marks the request complete, tells the student. Idempotent. */
  private async finalize(transcriptId: string, outcome: 'approved' | 'bypassed', actorUserId: string) {
    const cur = await this.db.query<{ WorkflowStatus: string | null }>(`SELECT WorkflowStatus FROM Transcripts WHERE Id = @t`, [
      { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
    ]);
    if (cur.recordset[0]?.WorkflowStatus !== 'active') return;

    await this.db.query(
      `UPDATE e SET e.Status = 'posted', e.PostedAt = SYSUTCDATETIME(), e.PostedBy = @u, e.UpdatedAt = SYSUTCDATETIME()
       FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       WHERE tc.TranscriptId = @t AND e.Status = 'decided'`,
      [
        { name: 'u', type: sql.UniqueIdentifier, value: actorUserId },
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
      ],
    );
    await this.db.query(
      `UPDATE tc SET tc.Status = 'posted'
       FROM TranscriptCourses tc JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
       WHERE tc.TranscriptId = @t AND e.Status = 'posted'`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    if (await this.schema.policyReady()) {
      // A pre-approval (current BU student, course taken elsewhere) is valid for a year.
      await this.db.query(
        `UPDATE Transcripts SET PreapprovalExpiresAt = DATEADD(YEAR, 1, SYSUTCDATETIME()) WHERE Id = @t AND EvaluationKind = 'preapproval'`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
    }
    await this.db.query(
      `UPDATE Transcripts SET WorkflowStatus = @o, Status = 'complete', ProcessedAt = SYSUTCDATETIME(), ProcessedBy = @u WHERE Id = @t`,
      [
        { name: 'o', type: sql.VarChar(12), value: outcome },
        { name: 'u', type: sql.UniqueIdentifier, value: actorUserId },
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
      ],
    );
    const undecided = await this.db.query<{ N: number }>(
      `SELECT COUNT(*) AS N FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       WHERE tc.TranscriptId = @t AND e.Status IN ('queued','in_progress')`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    if (undecided.recordset[0]?.N) {
      await this.addNote(transcriptId, null, 'internal', 'system', null, null,
        `${undecided.recordset[0].N} course(s) had no decision when the request was completed, so no credit was posted for them.`);
    }
    await this.emailStudent(transcriptId, outcome, '', 'Completed');
  }

  private async emailStudent(transcriptId: string, outcome: string, reason: string, stageName: string) {
    try {
      const r = await this.db.query<{ Email: string; FirstName: string }>(
        `SELECT u.Email, u.FirstName FROM Transcripts t JOIN Users u ON u.Id = t.StudentUserId WHERE t.Id = @t`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      const u = r.recordset[0];
      if (!u) return;
      const rejected = outcome === 'rejected';
      await this.email.sendEmail(u.Email, templates.requestDecided(this.email.context, {
        firstName: u.FirstName, transcriptId, rejected, stageName, reason,
      }));
    } catch (err) {
      this.logger.warn(`Student email failed: ${(err as Error).message}`);
    }
  }

  // ── notes ───────────────────────────────────────────────────

  async addNote(
    transcriptId: string,
    stageId: number | null,
    audience: 'internal' | 'student',
    kind: 'note' | 'decision' | 'system',
    authorId: string | null,
    authorRole: string | null,
    body: string,
  ) {
    await this.db.query(
      `INSERT INTO TranscriptNotes (TranscriptId, TranscriptStageId, Audience, Kind, AuthorUserId, AuthorRole, Body)
       VALUES (@t, @s, @a, @k, @u, @r, @b)`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 's', type: sql.Int, value: stageId },
        { name: 'a', type: sql.VarChar(8), value: audience },
        { name: 'k', type: sql.VarChar(10), value: kind },
        { name: 'u', type: sql.UniqueIdentifier, value: authorId },
        { name: 'r', type: sql.VarChar(20), value: authorRole },
        { name: 'b', type: sql.NVarChar(sql.MAX), value: body },
      ],
    );
  }

  private async addDecisionNotes(transcriptId: string, stageId: number, actor: Actor, internal: string, forStudent: string) {
    if (internal) await this.addNote(transcriptId, stageId, 'internal', 'decision', actor.id, actor.role, internal);
    if (forStudent) await this.addNote(transcriptId, stageId, 'student', 'decision', actor.id, actor.role, forStudent);
  }

  // ── documents ───────────────────────────────────────────────

  async documentChecklist(transcriptId: string): Promise<ChecklistItem[]> {
    const res = await this.db.query<{ DocTypeKey: string; Label: string; PerCourse: boolean; IsRequired: boolean; Uploaded: number; HasLegacyFile: number }>(
      `SELECT d.DocTypeKey, d.Label, d.PerCourse, r.IsRequired,
              (SELECT COUNT(*) FROM TranscriptDocuments x WHERE x.TranscriptId = t.Id AND x.DocTypeKey = d.DocTypeKey) AS Uploaded,
              CASE WHEN t.FileStoragePath IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyFile
       FROM Transcripts t
       JOIN WorkflowRequiredDocs r ON r.WorkflowId = t.WorkflowId
       JOIN DocumentTypes d ON d.DocTypeKey = r.DocTypeKey
       WHERE t.Id = @t ORDER BY d.SortOrder`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );

    // Which BU documents apply depends on who the student is (doc 12): English test only for non-native
    // speakers, the dual-enrollment form only for dual-enrollment students, transfer reports only for
    // transfers, and syllabi only for courses that are not an existing match (BU-EV-04).
    let profile: { ApplicantType: string | null; IsNativeEnglish: boolean | null; EvaluationKind: string } | null = null;
    let reviewCourses = 0;
    if (await this.schema.policyReady()) {
      const p = await this.db.query<{ ApplicantType: string | null; IsNativeEnglish: boolean | null; EvaluationKind: string }>(
        `SELECT sp.ApplicantType, sp.IsNativeEnglish, t.EvaluationKind
         FROM Transcripts t LEFT JOIN StudentProfiles sp ON sp.UserId = t.StudentUserId WHERE t.Id = @t`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      profile = p.recordset[0] ?? null;
      const rc = await this.db.query<{ N: number }>(
        `SELECT COUNT(*) AS N FROM TranscriptCourses
         WHERE TranscriptId = @t AND Lane IN ('pending','needs_syllabus','likely') AND IsOutsideUS = 0`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      reviewCourses = rc.recordset[0]?.N ?? 0;
    }
    const type = profile?.ApplicantType ?? null;
    const transfer = type === 'transfer_applicant' || type === 'admitted_transfer';
    const applies = (key: string): boolean => {
      switch (key) {
        case 'english_test': return profile?.IsNativeEnglish === false;
        case 'dual_enrollment_form': return type === 'dual_enrollment';
        case 'transfer_college_report':
        case 'hs_transcript': return transfer;
        case 'final_transcript': return transfer && profile?.EvaluationKind !== 'preview';
        default: return true;
      }
    };

    return res.recordset
      .filter((r) => applies(r.DocTypeKey))
      .map((r) => {
        const uploaded = r.Uploaded + (r.DocTypeKey === 'transcript' && r.HasLegacyFile ? 1 : 0);
        const isSyllabus = r.DocTypeKey === 'syllabus' && profile !== null;
        const needed = isSyllabus ? reviewCourses : 1;
        return {
          docTypeKey: r.DocTypeKey,
          label: r.Label,
          perCourse: !!r.PerCourse,
          required: !!r.IsRequired && needed > 0,
          uploaded,
          needed,
        };
      });
  }

  // ── the brief (zero tokens unless AI Controls turns the narrative on) ──

  async buildBrief(transcriptId: string) {
    const rows = await this.db.query<{
      TcId: string; EvalId: string | null; CourseCode: string; CourseTitle: string; Grade: string; Lane: string; OriginalCredits: number; NormalisedCredits: number | null;
      EvalStatus: string | null; Outcome: string | null; AwardedCredits: number | null; AIConfidence: number | null;
      SugCode: string | null; SugTitle: string | null; DecCode: string | null; DecTitle: string | null;
    }>(
      `SELECT tc.Id AS TcId, e.Id AS EvalId, tc.CourseCode, tc.CourseTitle, tc.Grade, tc.Lane, tc.OriginalCredits, tc.NormalisedCredits,
              e.Status AS EvalStatus, e.Outcome, e.AwardedCredits, e.AIConfidence,
              sc.Code AS SugCode, sc.Title AS SugTitle, dc.Code AS DecCode, dc.Title AS DecTitle
       FROM TranscriptCourses tc
       LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
       LEFT JOIN Courses sc ON sc.Id = e.AISuggestedCourseId
       LEFT JOIN Courses dc ON dc.Id = e.DecidedBUCourseId
       WHERE tc.TranscriptId = @t ORDER BY tc.SortOrder, tc.CourseCode`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const courses = rows.recordset;
    const count = (lane: string) => courses.filter((c) => c.Lane === lane).length;
    const openEvals = courses.filter((c) => c.EvalStatus === 'queued' || c.EvalStatus === 'in_progress').length;
    const credit = (c: (typeof courses)[number]) => Number(c.NormalisedCredits ?? c.OriginalCredits ?? 0);
    const appliedCredits =
      courses.filter((c) => c.Lane === 'applied').reduce((n, c) => n + credit(c), 0) +
      courses.filter((c) => c.Lane !== 'applied' && c.AwardedCredits != null).reduce((n, c) => n + Number(c.AwardedCredits), 0);
    const atStake = courses.filter((c) => ['likely', 'needs_syllabus', 'pending'].includes(c.Lane) && c.AwardedCredits == null)
      .reduce((n, c) => n + credit(c), 0);

    const missingDocs = (await this.documentChecklist(transcriptId))
      .filter((d) => d.required && d.uploaded < d.needed)
      .map((d) => (d.needed > 1 ? `${d.label} (${d.uploaded} of ${d.needed})` : d.label));
    const lowConfidence = courses.filter((c) => c.AIConfidence != null && Number(c.AIConfidence) < 0.6 && c.Outcome == null);

    const flags: string[] = [];
    if (count('not_eligible')) flags.push(`${count('not_eligible')} course(s) below the grade/eligibility rules`);
    if (count('needs_syllabus')) flags.push(`${count('needs_syllabus')} course(s) still need a syllabus or a match`);
    if (openEvals) flags.push(`${openEvals} course evaluation(s) not yet decided`);
    if (lowConfidence.length) flags.push(`Low AI confidence on ${lowConfidence.map((c) => c.CourseCode).join(', ')}`);
    if (missingDocs.length) flags.push(`Missing document(s): ${missingDocs.join(', ')}`);

    // BU transfer policy (migration 015): per-course flags, plus the notes every reviewer should see.
    const courseFlags = new Map<string, PolicyFlag[]>();
    const notes: string[] = [];
    if (await this.schema.policyReady()) {
      const pf = await this.db.query<{ Id: string; PolicyFlags: string | null; StudentUserId: string }>(
        `SELECT tc.Id, tc.PolicyFlags, t.StudentUserId FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId WHERE tc.TranscriptId = @t`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      const grouped = new Map<string, { message: string; codes: string[]; severity: string }>();
      for (const r of pf.recordset) {
        const f = parseFlags(r.PolicyFlags);
        courseFlags.set(String(r.Id).toLowerCase(), f);
        const code = courses.find((c) => String(c.TcId).toLowerCase() === String(r.Id).toLowerCase())?.CourseCode ?? '';
        for (const x of f) {
          if (x.severity === 'info' && x.code !== 'international') continue;
          const g = grouped.get(x.code) ?? { message: x.message, codes: [], severity: x.severity };
          g.codes.push(code);
          grouped.set(x.code, g);
        }
      }
      for (const [code, g] of grouped) {
        const line = `${g.codes.join(', ')}: ${g.message}`;
        if (code === 'international') notes.push(line);
        else if (code !== 'below_min_grade' && code !== 'no_credit_type' && code !== 'unaccredited') flags.push(line);
        else notes.push(line); // already counted as "not eligible" above
      }
      const studentId = pf.recordset[0]?.StudentUserId;
      if (studentId) {
        const cs = await this.policy.creditSummary(studentId);
        notes.push(`External credit: ${cs.used} of ${cs.cap} allowed credits counted so far (transfer, AP, IB and A-level combined).`);
        notes.push(`BU Hub: transfer courses never satisfy Hub requirements; this student still owes ${cs.hubRequirements} Hub requirements (up to ${cs.hubCocurricularAllowed} via a cocurricular).`);
      }
    }

    const prior = await this.db.query<{ StageName: string; Status: string; Body: string | null; CompletedAt: Date | null }>(
      `SELECT ts.StageName, ts.Status, ts.CompletedAt,
              (SELECT TOP 1 n.Body FROM TranscriptNotes n WHERE n.TranscriptStageId = ts.Id AND n.Kind = 'decision' ORDER BY n.Id DESC) AS Body
       FROM TranscriptStages ts
       WHERE ts.TranscriptId = @t AND ts.StageType <> 'system' AND ts.Status IN ('approved','bypassed','returned') ORDER BY ts.StageOrder`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );

    const totals = {
      courses: courses.length,
      applied: count('applied'),
      likely: count('likely'),
      needsSyllabus: count('needs_syllabus'),
      electiveOnly: count('elective_only'),
      notEligible: count('not_eligible'),
      pending: count('pending'),
    };
    const recommendation: 'approve' | 'review' | 'reject' =
      courses.length > 0 && totals.notEligible === courses.length
        ? 'reject'
        : flags.some((f) => !f.startsWith('Low AI')) || lowConfidence.length
          ? 'review'
          : 'approve';

    const brief = {
      generatedAt: new Date().toISOString(),
      totals,
      credits: { applied: appliedCredits, atStake },
      flags,
      notes,
      courses: courses.map((c) => ({
        courseId: c.TcId,
        flags: courseFlags.get(String(c.TcId).toLowerCase()) ?? [],
        evaluationId: c.EvalId,
        code: c.CourseCode,
        title: c.CourseTitle,
        grade: c.Grade,
        lane: c.Lane,
        credits: credit(c),
        suggested: c.SugCode ? { code: c.SugCode, title: c.SugTitle, confidence: c.AIConfidence == null ? null : Number(c.AIConfidence) } : null,
        decided: c.DecCode ? { code: c.DecCode, title: c.DecTitle, outcome: c.Outcome, awardedCredits: c.AwardedCredits } : c.Outcome ? { code: null, title: null, outcome: c.Outcome, awardedCredits: c.AwardedCredits } : null,
      })),
      previousStages: prior.recordset.map((p) => ({ stage: p.StageName, status: p.Status, comment: p.Body, at: p.CompletedAt })),
      narrative: null as string | null,
    };
    brief.narrative = await this.ai.writeBriefNarrative(transcriptId, { totals, credits: brief.credits, flags, recommendation });
    return { brief, recommendation };
  }
}
