import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { AiSettingsService } from './ai-settings.service';
import { AiUsageService } from './ai-usage.service';

export interface ReadinessItem {
  key: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
  hint?: string;
}

/**
 * "Is this installation actually ready to run requests end to end?" - the
 * things that otherwise fail silently (missing keys, unapplied migrations,
 * stages nobody can approve, automation that stalled).
 */
@Injectable()
export class ReadinessService {
  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private email: EmailService,
    private settings: AiSettingsService,
    private usage: AiUsageService,
  ) {}

  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  async check(): Promise<{ ready: boolean; items: ReadinessItem[] }> {
    const items: ReadinessItem[] = [];

    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    const keyOk = !!key && !key.startsWith('REPLACE_WITH');
    items.push({
      key: 'anthropic',
      label: 'AI provider key',
      status: keyOk ? 'ok' : 'warn',
      detail: keyOk ? 'ANTHROPIC_API_KEY is set.' : 'ANTHROPIC_API_KEY is missing, so AI cannot run; the built-in rules engine is used instead (if enabled in AI Controls).',
      hint: keyOk ? undefined : 'Add ANTHROPIC_API_KEY under App Service > Environment variables, then restart the app.',
    });

    const global = await this.safe(() => this.settings.getEffective(null), null);
    if (global) {
      items.push({
        key: 'ai_enabled',
        label: 'AI matching switch',
        status: global.isEnabled ? 'ok' : 'warn',
        detail: global.isEnabled ? 'AI matching is on.' : 'AI matching is switched off, so reviewers match courses by hand.',
        hint: global.isEnabled ? undefined : 'Turn it on in AI Controls > Settings.',
      });
      if (global.monthlyTokenBudget != null) {
        const used = await this.safe(() => this.usage.tokensThisMonth(), 0);
        const pct = Math.round((used / Math.max(1, global.monthlyTokenBudget)) * 100);
        items.push({
          key: 'budget',
          label: 'Monthly token budget',
          status: pct >= 100 ? 'error' : pct >= 80 ? 'warn' : 'ok',
          detail: `${used.toLocaleString()} of ${global.monthlyTokenBudget.toLocaleString()} tokens used this month (${pct}%).`,
          hint: pct >= 80 ? 'Raise the budget in AI Controls > Settings, or AI pauses when it is reached.' : undefined,
        });
      }
    }

    const mail = this.email.status();
    const lastFailure = mail.recent.find((r) => !r.ok);
    const lastOk = mail.recent.find((r) => r.ok);
    const failing = mail.configured && !!lastFailure && (!lastOk || lastOk.at < lastFailure.at);
    items.push({
      key: 'email',
      label: 'Email delivery',
      status: !mail.configured || failing ? 'warn' : 'ok',
      detail: !mail.configured
        ? 'RESEND_API_KEY is not set, so no emails are sent (reminders, approver alerts, partner reports).'
        : failing
          ? `The last email (to ${lastFailure!.to}) was rejected by Resend: ${lastFailure!.error}`
          : `Resend is configured; emails are sent from ${mail.fromAddress}.`,
      hint: !mail.configured
        ? 'Add RESEND_API_KEY (and RESEND_FROM_EMAIL) under App Service > Environment variables.'
        : failing
          ? `Verify the domain ${mail.fromDomain} in Resend (Domains), or set RESEND_FROM_EMAIL to an address on a verified domain. Use System Settings > Email > Send test email to check.`
          : undefined,
    });

    const hasMigration014 = await this.safe(
      async () =>
        (await this.db.query<{ N: number }>(`SELECT CASE WHEN OBJECT_ID('ImportBatches') IS NOT NULL AND COL_LENGTH('WorkflowStages','AutoApprove') IS NOT NULL AND OBJECT_ID('CourseAppeals') IS NOT NULL THEN 1 ELSE 0 END AS N`))
          .recordset[0].N === 1,
      false,
    );
    items.push({
      key: 'migration',
      label: 'Database up to date',
      status: hasMigration014 ? 'ok' : 'error',
      detail: hasMigration014 ? 'Migrations 014 and 015 are applied.' : 'Migration 014 or 015 (partner intake, auto-approve, BU transfer policy, appeals) is not applied yet.',
      hint: hasMigration014 ? undefined : 'Run `npm run apply:all` in tools/db-mcp-server from a machine the SQL firewall allows.',
    });

    const defaults = await this.safe(
      async () =>
        (await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM WorkflowDefinitions WHERE InstitutionId IS NULL AND IsActive = 1`)).recordset[0].N,
      0,
    );
    items.push({
      key: 'default_workflow',
      label: 'Default workflow',
      status: defaults > 0 ? 'ok' : 'error',
      detail: defaults > 0 ? 'An active global default workflow exists.' : 'There is no active default workflow, so requests from universities without their own workflow will not be routed.',
      hint: defaults > 0 ? undefined : 'Activate or recreate it in Workflows.',
    });

    const orphaned = await this.safe(
      async () =>
        (
          await this.db.query<{ Wf: string; Stage: string }>(
            `SELECT w.Name AS Wf, s.Name AS Stage
             FROM WorkflowStages s JOIN WorkflowDefinitions w ON w.Id = s.WorkflowId AND w.IsActive = 1
             WHERE s.IsEnabled = 1 AND s.StageType <> 'system' AND NOT EXISTS (
               SELECT 1 FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE u.IsActive = 1 AND (
                 EXISTS (SELECT 1 FROM WorkflowStageApprovers a WHERE a.StageId = s.Id AND a.ApproverType = 'role' AND a.RoleName = r.Name)
                 OR EXISTS (SELECT 1 FROM WorkflowStageApprovers a JOIN ApproverGroupMembers m ON m.GroupId = a.GroupId
                            JOIN ApproverGroups g ON g.Id = a.GroupId AND g.IsActive = 1
                            WHERE a.StageId = s.Id AND a.ApproverType = 'group' AND m.UserId = u.Id)
                 OR EXISTS (SELECT 1 FROM WorkflowStageApprovers a WHERE a.StageId = s.Id AND a.ApproverType = 'user' AND a.UserId = u.Id)))`,
          )
        ).recordset,
      [] as { Wf: string; Stage: string }[],
    );
    items.push({
      key: 'approvers',
      label: 'Every stage has someone who can act',
      status: orphaned.length ? 'warn' : 'ok',
      detail: orphaned.length
        ? `${orphaned.length} stage(s) have no active approver, so only admins can act: ${orphaned.slice(0, 6).map((o) => `${o.Wf} > ${o.Stage}`).join(', ')}${orphaned.length > 6 ? '…' : ''}.`
        : 'All approval stages have at least one active approver.',
      hint: orphaned.length ? 'Add members to the approver group (Workflows > Approver groups) or assign people to the stage.' : undefined,
    });

    const stalled = await this.safe(
      async () =>
        (
          await this.db.query<{ N: number }>(
            `SELECT COUNT(*) AS N FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
             WHERE ts.Status = 'active' AND ts.StageType = 'system' AND t.WorkflowStatus = 'active' AND ts.ActivatedAt < DATEADD(MINUTE, -15, SYSUTCDATETIME())`,
          )
        ).recordset[0].N,
      0,
    );
    items.push({
      key: 'stalled',
      label: 'Automation running smoothly',
      status: stalled ? 'warn' : 'ok',
      detail: stalled ? `${stalled} request(s) have been stuck in an automatic step for over 15 minutes.` : 'No requests are stuck in an automatic step.',
      hint: stalled ? 'Open each request and press "Resume automation" (usually the app restarted mid-run, or the AI key is missing).' : undefined,
    });

    const overdue = await this.safe(
      async () =>
        (
          await this.db.query<{ N: number }>(
            `SELECT COUNT(*) AS N FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
             WHERE ts.Status = 'active' AND ts.StageType <> 'system' AND ts.DueAt < SYSUTCDATETIME() AND t.WorkflowStatus = 'active'`,
          )
        ).recordset[0].N,
      0,
    );
    items.push({
      key: 'overdue',
      label: 'Requests on time',
      status: overdue ? 'warn' : 'ok',
      detail: overdue ? `${overdue} stage(s) are past their due date.` : 'No stage is overdue.',
      hint: overdue ? 'Approvers are alerted automatically (once per stage); see the Approval queue.' : undefined,
    });

    return { ready: !items.some((i) => i.status === 'error'), items };
  }
}
