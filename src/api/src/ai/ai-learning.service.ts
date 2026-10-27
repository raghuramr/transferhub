import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { AiSettingsService } from './ai-settings.service';

export interface LearnedSuggestion {
  /** Stable key so the UI can track which suggestions were added. */
  key: string;
  kind: 'override' | 'elective' | 'no_credit';
  title: string;
  /** Ready-to-save playbook text (<= 2000 chars). */
  instructions: string;
  /** How many faculty decisions back this rule. */
  count: number;
  evidence: string;
  alreadyInPlaybook: boolean;
}

export interface LearnedSkills {
  stats: { decided: number; withAiPick: number; agreed: number; overridden: number; agreementRate: number | null };
  suggestions: LearnedSuggestion[];
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Turns faculty decisions into suggested playbook rules. Deterministic (no model call, no tokens): it
 * looks for patterns that repeat - the same external course mapped somewhere other than the matcher's
 * top pick, or the same course repeatedly awarded elective / no credit - and proposes them as skills
 * an administrator can review and add. Nothing is saved automatically.
 */
@Injectable()
export class AiLearningService {
  private readonly logger = new Logger(AiLearningService.name);

  constructor(private db: DatabaseService, private settings: AiSettingsService) {}

  async learn(minCount = 2): Promise<LearnedSkills> {
    const min = Math.max(1, Math.min(20, Math.trunc(minCount) || 2));
    const out: LearnedSkills = { stats: { decided: 0, withAiPick: 0, agreed: 0, overridden: 0, agreementRate: null }, suggestions: [] };
    try {
      const st = await this.db.query<{ Decided: number; WithAi: number; Agreed: number }>(
        `SELECT COUNT(*) AS Decided,
                SUM(CASE WHEN ai.BUCourseId IS NOT NULL THEN 1 ELSE 0 END) AS WithAi,
                SUM(CASE WHEN ai.BUCourseId IS NOT NULL AND e.DecidedBUCourseId = ai.BUCourseId THEN 1 ELSE 0 END) AS Agreed
         FROM Evaluations e
         OUTER APPLY (SELECT TOP 1 BUCourseId FROM AIMatchCandidates c WHERE c.EvaluationId = e.Id ORDER BY c.Rank) ai
         WHERE e.Status IN ('decided','posted') AND e.Outcome = 'equivalent' AND e.DecidedBUCourseId IS NOT NULL`,
      );
      const r = st.recordset[0];
      if (r) {
        out.stats.decided = Number(r.Decided ?? 0);
        out.stats.withAiPick = Number(r.WithAi ?? 0);
        out.stats.agreed = Number(r.Agreed ?? 0);
        out.stats.overridden = out.stats.withAiPick - out.stats.agreed;
        out.stats.agreementRate = out.stats.withAiPick ? Math.round((out.stats.agreed / out.stats.withAiPick) * 1000) / 10 : null;
      }

      // 1) Faculty chose a different BU course than the matcher's top pick, repeatedly.
      const ov = await this.db.query<{
        ExtCode: string; ExtTitle: string; ExtInst: string; DecCode: string; DecTitle: string; AiCode: string; AiTitle: string; N: number;
      }>(
        `SELECT ec.Code AS ExtCode, ec.Title AS ExtTitle, ei.Name AS ExtInst,
                dbu.Code AS DecCode, dbu.Title AS DecTitle, abu.Code AS AiCode, abu.Title AS AiTitle, COUNT(*) AS N
         FROM Evaluations e
         JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
         JOIN Courses ec ON ec.Id = tc.ExternalCourseId
         JOIN Institutions ei ON ei.Id = ec.InstitutionId
         JOIN Courses dbu ON dbu.Id = e.DecidedBUCourseId
         OUTER APPLY (SELECT TOP 1 BUCourseId FROM AIMatchCandidates c WHERE c.EvaluationId = e.Id ORDER BY c.Rank) ai
         JOIN Courses abu ON abu.Id = ai.BUCourseId
         WHERE e.Status IN ('decided','posted') AND e.Outcome = 'equivalent' AND e.DecidedBUCourseId <> ai.BUCourseId
         GROUP BY ec.Code, ec.Title, ei.Name, dbu.Code, dbu.Title, abu.Code, abu.Title
         HAVING COUNT(*) >= @min
         ORDER BY COUNT(*) DESC`,
        [{ name: 'min', type: sql.Int, value: min }],
      );
      for (const x of ov.recordset) {
        out.suggestions.push({
          key: `ov:${x.ExtInst}|${x.ExtCode}|${x.DecCode}`,
          kind: 'override',
          title: cut(`Prefer ${x.DecCode} for ${x.ExtInst} ${x.ExtCode}`, 150),
          instructions: cut(
            `For ${x.ExtInst} "${x.ExtCode} ${x.ExtTitle}" (and very similar courses), faculty have mapped it to ${x.DecCode} ${x.DecTitle}, ` +
            `not ${x.AiCode} ${x.AiTitle}. Rank ${x.DecCode} first for this kind of course.`, 2000),
          count: Number(x.N),
          evidence: `Faculty overrode the top pick (${x.AiCode}) with ${x.DecCode} in ${x.N} decision${x.N === 1 ? '' : 's'}.`,
          alreadyInPlaybook: false,
        });
      }

      // 2) The same external course repeatedly awarded only elective credit / no credit.
      const oc = await this.db.query<{ ExtCode: string; ExtTitle: string; ExtInst: string; Outcome: string; N: number }>(
        `SELECT ec.Code AS ExtCode, ec.Title AS ExtTitle, ei.Name AS ExtInst, e.Outcome, COUNT(*) AS N
         FROM Evaluations e
         JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
         JOIN Courses ec ON ec.Id = tc.ExternalCourseId
         JOIN Institutions ei ON ei.Id = ec.InstitutionId
         WHERE e.Status IN ('decided','posted') AND e.Outcome IN ('elective','no_credit')
         GROUP BY ec.Code, ec.Title, ei.Name, e.Outcome
         HAVING COUNT(*) >= @min
         ORDER BY COUNT(*) DESC`,
        [{ name: 'min', type: sql.Int, value: min }],
      );
      for (const x of oc.recordset) {
        const noCredit = x.Outcome === 'no_credit';
        out.suggestions.push({
          key: `${x.Outcome}:${x.ExtInst}|${x.ExtCode}`,
          kind: noCredit ? 'no_credit' : 'elective',
          title: cut(`${noCredit ? 'No credit' : 'Elective only'}: ${x.ExtInst} ${x.ExtCode}`, 150),
          instructions: cut(
            noCredit
              ? `${x.ExtInst} "${x.ExtCode} ${x.ExtTitle}" has repeatedly been awarded no transfer credit. Do not suggest a BU equivalent; flag it as likely no credit.`
              : `${x.ExtInst} "${x.ExtCode} ${x.ExtTitle}" has repeatedly been awarded elective credit only. Do not suggest a specific BU course; flag it as likely elective.`,
            2000),
          count: Number(x.N),
          evidence: `Decided as ${noCredit ? 'no credit' : 'elective only'} in ${x.N} decision${x.N === 1 ? '' : 's'}.`,
          alreadyInPlaybook: false,
        });
      }

      // Mark suggestions whose text is already in the playbook.
      const have = new Set((await this.settings.listSkills()).map((s) => s.instructions.trim()));
      for (const s of out.suggestions) s.alreadyInPlaybook = have.has(s.instructions.trim());
      out.suggestions.sort((a, b) => b.count - a.count);
    } catch (err) {
      this.logger.warn(`Learning from decisions failed: ${(err as Error).message}`);
    }
    return out;
  }
}
