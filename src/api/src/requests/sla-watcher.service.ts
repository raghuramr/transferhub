import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import { SchemaService } from '../policy/schema.service';
import { CreditDeadlineService } from '../policy/credit-deadline.service';
import { thresholdFor } from '../policy/credit-deadline';
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
    private schema: SchemaService,
    private deadlines: CreditDeadlineService,
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
    }
    // PRG-02 credit-deadline reminders: independent of the stage sweep (runs even if that one failed), never breaks it.
    try {
      await this.deadlineSweep();
    } catch (e) {
      this.logger.warn(`Credit-deadline sweep failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return escalated;
  }

  /**
   * Emails the student and the approvers once per threshold (90, 30, 7 days before the credit deadline, and once it
   * has passed) for requests that still have courses waiting on a decision. The (request, threshold) row in
   * CreditDeadlineNotices is claimed BEFORE sending, so restarts and a second instance never repeat a notice.
   * Requests whose deadline is only an estimate (no entry term on file) and previews are skipped.
   * Returns how many requests were notified. Does nothing until migration 024 is applied.
   */
  async deadlineSweep(now: Date = new Date()): Promise<number> {
    if (!(await this.schema.deadlineReady()) || !(await this.schema.policyReady())) return 0;
    const cand = await this.db.query<{ Id: string; StudentUserId: string; Email: string; FirstName: string; LastName: string; Pending: number; StageId: number | null }>(
      `SELECT TOP 500 x.* FROM (
         SELECT t.Id, t.StudentUserId, u.Email, u.FirstName, u.LastName,
                (SELECT COUNT(*) FROM TranscriptCourses tc
                  WHERE tc.TranscriptId = t.Id AND tc.Lane NOT IN ('not_eligible', 'applied') AND ISNULL(tc.IsOutsideUS, 0) = 0
                    AND tc.Status NOT IN ('decided', 'posted')
                    AND NOT EXISTS (SELECT 1 FROM Evaluations e WHERE e.TranscriptCourseId = tc.Id AND e.Status IN ('decided', 'posted'))) AS Pending,
                (SELECT TOP 1 ts.WorkflowStageId FROM TranscriptStages ts
                  WHERE ts.TranscriptId = t.Id AND ts.Status = 'active' AND ts.StageType <> 'system' ORDER BY ts.StageOrder) AS StageId
         FROM Transcripts t JOIN Users u ON u.Id = t.StudentUserId
         WHERE ISNULL(t.EvaluationKind, 'official') <> 'preview' AND ISNULL(t.WorkflowStatus, 'active') NOT IN ('approved', 'rejected', 'bypassed')
       ) x WHERE x.Pending > 0 ORDER BY x.Id`,
    );
    if (!cand.recordset.length) return 0;
    const dl = await this.deadlines.forStudents(cand.recordset.map((c) => c.StudentUserId), now);
    let notified = 0;
    for (const c of cand.recordset) {
      try {
        const d = dl.get(String(c.StudentUserId).toLowerCase());
        if (!d || d.isEstimate || !d.deadlineOn || d.daysLeft == null) continue;
        const key = thresholdFor(d.daysLeft);
        if (!key) continue;
        const claim = await this.db.query(
          `INSERT INTO CreditDeadlineNotices (TranscriptId, ThresholdKey)
           SELECT @t, @k WHERE NOT EXISTS (SELECT 1 FROM CreditDeadlineNotices WHERE TranscriptId = @t AND ThresholdKey = @k)`,
          [
            { name: 't', type: sql.UniqueIdentifier, value: c.Id },
            { name: 'k', type: sql.VarChar(10), value: key },
          ],
        );
        if (!claim.rowsAffected[0]) continue;
        notified++;
        const student = `${c.FirstName} ${c.LastName}`;
        const staff = (await this.workflows.resolveApprovers(c.StageId)).concat(c.StageId ? [] : await this.workflows.admins());
        const people: { email: string; name: string; audience: 'student' | 'staff' }[] = [{ email: c.Email, name: c.FirstName, audience: 'student' }];
        const seen = new Set([c.Email.toLowerCase()]);
        for (const p of staff) if (!seen.has(p.email.toLowerCase())) { seen.add(p.email.toLowerCase()); people.push({ email: p.email, name: p.name, audience: 'staff' }); }
        let sent = 0;
        for (const p of people) {
          try {
            const base = { name: p.name, audience: p.audience, student, deadlineOn: d.deadlineOn, pendingCourses: c.Pending, months: d.months, transcriptId: c.Id };
            await this.email.sendEmail(p.email, key === 'overdue'
              ? templates.deadlineOverdue(this.email.context, { ...base, daysOver: Math.abs(d.daysLeft) })
              : templates.deadlineApproaching(this.email.context, { ...base, daysLeft: d.daysLeft }));
            sent++;
          } catch (e) {
            this.logger.warn(`Deadline email to ${p.email} failed: ${(e as Error).message}`);
          }
        }
        await this.db.query(`UPDATE CreditDeadlineNotices SET Recipients = @n WHERE TranscriptId = @t AND ThresholdKey = @k`, [
          { name: 'n', type: sql.Int, value: sent },
          { name: 't', type: sql.UniqueIdentifier, value: c.Id },
          { name: 'k', type: sql.VarChar(10), value: key },
        ]).catch(() => undefined);
      } catch (e) {
        this.logger.warn(`Deadline notice failed for request ${c.Id}: ${(e as Error).message}`);
      }
    }
    if (notified) this.logger.log(`Sent credit-deadline notices for ${notified} request(s)`);
    return notified;
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
