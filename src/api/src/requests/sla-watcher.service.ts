import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowEngineService } from './workflow-engine.service';

const HOUR = 60 * 60 * 1000;

/**
 * Hourly sweep for approval stages that have passed their due date. Each
 * overdue stage is escalated exactly once: the approvers (and admins) get an
 * email, the reviewers see a system note, and the student sees a gentle
 * "we are chasing it" update. No external scheduler is needed - it runs
 * inside the API process. Set SLA_WATCHER=off to disable.
 */
@Injectable()
export class SlaWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaWatcherService.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private warnedMissingColumn = false;
  private running = false;

  constructor(
    private db: DatabaseService,
    private email: EmailService,
    private workflows: WorkflowsService,
    private engine: WorkflowEngineService,
  ) {}

  onModuleInit() {
    if ((process.env.SLA_WATCHER ?? '').toLowerCase() === 'off') return;
    this.first = setTimeout(() => void this.sweep(), 2 * 60 * 1000);
    this.timer = setInterval(() => void this.sweep(), HOUR);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  /** Returns how many stages were escalated (also callable from tests). */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let escalated = 0;
    try {
      const due = await this.db.query<{ Id: number; TranscriptId: string; WorkflowStageId: number | null; StageName: string; DueAt: Date; Student: string }>(
        `SELECT TOP 200 ts.Id, ts.TranscriptId, ts.WorkflowStageId, ts.StageName, ts.DueAt, u.FirstName + ' ' + u.LastName AS Student
         FROM TranscriptStages ts
         JOIN Transcripts t ON t.Id = ts.TranscriptId
         JOIN Users u ON u.Id = t.StudentUserId
         WHERE ts.Status = 'active' AND ts.StageType <> 'system' AND ts.DueAt IS NOT NULL AND ts.DueAt < SYSUTCDATETIME()
           AND ts.OverdueNotifiedAt IS NULL AND t.WorkflowStatus = 'active'
         ORDER BY ts.DueAt`,
      );
      for (const s of due.recordset) {
        // Claim the stage first so a restart or a second instance never double-sends.
        const claim = await this.db.query(`UPDATE TranscriptStages SET OverdueNotifiedAt = SYSUTCDATETIME() WHERE Id = @id AND OverdueNotifiedAt IS NULL`, [
          { name: 'id', type: sql.Int, value: s.Id },
        ]);
        if (!claim.rowsAffected[0]) continue;
        escalated++;
        try {
          await this.escalate(s);
        } catch (e) {
          this.logger.warn(`Overdue alert failed for stage ${s.Id}: ${(e as Error).message}`);
        }
      }
      if (escalated) this.logger.log(`Escalated ${escalated} overdue stage(s)`);
    } catch (e) {
      // Most likely migration 014 (OverdueNotifiedAt) is not applied yet; say so once, not every hour.
      if (!this.warnedMissingColumn) {
        this.warnedMissingColumn = true;
        this.logger.warn(`Overdue sweep skipped: ${(e as Error).message}`);
      }
    } finally {
      this.running = false;
    }
    return escalated;
  }

  private async escalate(s: { Id: number; TranscriptId: string; WorkflowStageId: number | null; StageName: string; DueAt: Date; Student: string }) {
    const days = Math.max(1, Math.round((Date.now() - new Date(s.DueAt).getTime()) / (24 * HOUR)));
    const approvers = await this.workflows.resolveApprovers(s.WorkflowStageId);
    const recipients = new Map<string, { email: string; name: string }>();
    for (const p of [...approvers, ...(await this.workflows.admins())]) recipients.set(p.email.toLowerCase(), { email: p.email, name: p.name });

    await this.engine.addNote(s.TranscriptId, s.Id, 'internal', 'system', null, null,
      `Overdue: "${s.StageName}" passed its due date (${new Date(s.DueAt).toLocaleDateString()}). Approvers and admins were alerted.`);
    await this.engine.addNote(s.TranscriptId, s.Id, 'student', 'system', null, null,
      `Your request is taking a little longer than planned at "${s.StageName}". We have reminded the reviewers.`);

    for (const r of recipients.values()) {
      await this.email.sendEmail(r.email, templates.stageOverdue(this.email.context, {
        name: r.name, student: s.Student, stage: s.StageName, days, dueAt: s.DueAt, transcriptId: s.TranscriptId,
      }));
    }
  }
}
