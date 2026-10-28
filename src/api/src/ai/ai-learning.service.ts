import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { AiSettingsService } from './ai-settings.service';
import { SchemaService } from '../policy/schema.service';
import {
  buildHeadlines, buildWeeklySeries, countInWindow, countResolvedPatterns, rankRecurringMistakes,
  type CourseRow, type DecisionRow, type EquivalencyRow, type OverviewHeadlines, type RecurringMistake, type UsageRow, type WeekPoint,
} from './learning-trend';

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

  constructor(private db: DatabaseService, private settings: AiSettingsService, private schema: SchemaService) {}

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
  /** Loads the raw rows the learning charts are computed from. Every query degrades to an empty list. */
  private async loadRows(weeks: number, institutionId: number | null) {
    const from = new Date(Date.now() - (weeks + 1) * 7 * 86_400_000);
    const fromIn = { name: 'from', type: sql.DateTime2, value: from };
    const instIn = { name: 'inst', type: sql.Int, value: institutionId };
    const scoped = institutionId != null;
    const hasTarget = scoped && (await this.schema.has('Transcripts', 'TargetInstitutionId'));
    const rows = { decisions: [] as DecisionRow[], courses: [] as CourseRow[], equivalencies: [] as EquivalencyRow[], usage: [] as UsageRow[] };
    const safe = async (what: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (err) { this.logger.warn(`Learning trend (${what}) failed: ${(err as Error).message}`); }
    };

    await safe('decisions', async () => {
      const r = await this.db.query<{
        DecidedAt: Date; Outcome: string; DecId: number | null; Conf: number | null; Top3: string | null; Auto: number;
        ExtCode: string | null; ExtTitle: string | null; ExtInst: string | null; DecCode: string | null; DecTitle: string | null; AiCode: string | null; AiTitle: string | null;
      }>(
        `SELECT e.DecidedAt, e.Outcome, e.DecidedBUCourseId AS DecId, e.AIConfidence AS Conf, ai.Top3,
                CASE WHEN e.EvaluatorNotes LIKE 'Accepted the AI suggestion%' THEN 1 ELSE 0 END AS Auto,
                ec.Code AS ExtCode, ec.Title AS ExtTitle, ei.Name AS ExtInst,
                dbu.Code AS DecCode, dbu.Title AS DecTitle, abu.Code AS AiCode, abu.Title AS AiTitle
         FROM Evaluations e
         JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
         ${hasTarget ? 'JOIN Transcripts t ON t.Id = tc.TranscriptId' : ''}
         LEFT JOIN Courses ec ON ec.Id = tc.ExternalCourseId
         LEFT JOIN Institutions ei ON ei.Id = ec.InstitutionId
         LEFT JOIN Courses dbu ON dbu.Id = e.DecidedBUCourseId
         OUTER APPLY (SELECT STRING_AGG(CAST(c.BUCourseId AS VARCHAR(12)), ',') WITHIN GROUP (ORDER BY c.Rank) AS Top3
                      FROM AIMatchCandidates c WHERE c.EvaluationId = e.Id AND c.Rank <= 3) ai
         LEFT JOIN Courses abu ON abu.Id = TRY_CAST(LEFT(ai.Top3, CHARINDEX(',', ai.Top3 + ',') - 1) AS INT)
         WHERE e.Status IN ('decided','posted') AND e.DecidedAt IS NOT NULL AND e.DecidedAt >= @from
           ${hasTarget ? 'AND t.TargetInstitutionId = @inst' : ''}`,
        hasTarget ? [fromIn, instIn] : [fromIn],
      );
      for (const x of r.recordset) {
        const ids = (x.Top3 ?? '').split(',').map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
        rows.decisions.push({
          decidedAt: x.DecidedAt, aiTopId: ids[0] ?? null, aiTop3Ids: ids, aiConfidence: x.Conf == null ? null : Number(x.Conf),
          decidedCourseId: x.DecId, outcome: x.Outcome ?? '', auto: Number(x.Auto) === 1,
          extCode: x.ExtCode ?? undefined, extLabel: x.ExtTitle ?? undefined, extInstitution: x.ExtInst ?? undefined,
          aiCode: x.AiCode ?? undefined, aiLabel: x.AiTitle ?? undefined, decidedCode: x.DecCode ?? undefined, decidedLabel: x.DecTitle ?? undefined,
        });
      }
    });

    await safe('courses', async () => {
      const r = await this.db.query<{ CreatedAt: Date; Lane: string }>(
        `SELECT tc.CreatedAt, tc.Lane FROM TranscriptCourses tc
         ${hasTarget ? 'JOIN Transcripts t ON t.Id = tc.TranscriptId' : ''}
         WHERE tc.CreatedAt >= @from ${hasTarget ? 'AND t.TargetInstitutionId = @inst' : ''}`,
        hasTarget ? [fromIn, instIn] : [fromIn],
      );
      rows.courses = r.recordset.map((x) => ({ createdAt: x.CreatedAt, lane: x.Lane }));
    });

    await safe('equivalencies', async () => {
      const r = await this.db.query<{ CreatedAt: Date; Label: string }>(
        `SELECT eq.CreatedAt, CONCAT(ei.Code, ' ', ec.Code, ' -> ', bc.Code) AS Label
         FROM Equivalencies eq
         JOIN Courses ec ON ec.Id = eq.ExternalCourseId
         JOIN Institutions ei ON ei.Id = ec.InstitutionId
         JOIN Courses bc ON bc.Id = eq.BUCourseId
         WHERE eq.IsActive = 1 AND eq.Outcome = 'equivalent' ${scoped ? 'AND bc.InstitutionId = @inst' : ''}`,
        scoped ? [instIn] : [],
      );
      rows.equivalencies = r.recordset.map((x) => ({ createdAt: x.CreatedAt, label: x.Label }));
    });

    if (await this.schema.has('AiUsageLog')) {
      await safe('usage', async () => {
        const r = await this.db.query<{ CreatedAt: Date; SkipReason: string | null }>(
          `SELECT CreatedAt, SkipReason FROM AiUsageLog
           WHERE CreatedAt >= @from AND SkipReason IN ('cache_hit','equivalency_exists') ${scoped ? 'AND InstitutionId = @inst' : ''}`,
          scoped ? [fromIn, instIn] : [fromIn],
        );
        rows.usage = r.recordset.map((x) => ({ createdAt: x.CreatedAt, skipReason: x.SkipReason }));
      });
    }
    return rows;
  }

  private async threshold(institutionId: number | null): Promise<number> {
    try {
      const s = await this.settings.getEffective(institutionId);
      const t = Number(s.autoLikelyThreshold);
      return Number.isFinite(t) && t > 0 && t <= 1 ? t : 0.85;
    } catch {
      return 0.85;
    }
  }

  /** Weekly accuracy / safety / knowledge-base series. Never throws: an empty series means "nothing decided yet". */
  async trend(weeks = 26, institutionId: number | null = null): Promise<{ weeks: number; institutionId: number | null; autoApplyThreshold: number; series: WeekPoint[] }> {
    const w = Math.max(2, Math.min(104, Math.trunc(weeks) || 26));
    const autoApplyThreshold = await this.threshold(institutionId);
    const rows = await this.loadRows(w, institutionId);
    return { weeks: w, institutionId, autoApplyThreshold, series: buildWeeklySeries({ ...rows, autoApplyThreshold }, w) };
  }

  async overview(institutionId: number | null = null): Promise<{
    headlines: OverviewHeadlines;
    learned: { newEquivalencies: number; newEquivalencyExamples: string[]; playbookRulesAdded: number; patternsResolved: number; days: number };
    recurringMistakes: Array<RecurringMistake & { alreadyInPlaybook: boolean }>;
    hasData: boolean;
  }> {
    const now = Date.now();
    const weeks = 26;
    const autoApplyThreshold = await this.threshold(institutionId);
    const rows = await this.loadRows(weeks, institutionId);
    const series = buildWeeklySeries({ ...rows, autoApplyThreshold }, weeks, now);

    let skills: { instructions: string }[] = [];
    let rulesAdded = 0;
    try {
      const list = await this.settings.listSkills();
      skills = list;
      const r = await this.db.query<{ N: number }>(
        `SELECT COUNT(*) AS N FROM AgentSkills WHERE UpdatedBy IS NOT NULL AND UpdatedAt >= DATEADD(DAY, -30, SYSUTCDATETIME())`,
      );
      rulesAdded = Number(r.recordset[0]?.N ?? 0);
    } catch {
      // playbook unavailable: leave the counts at zero
    }
    const have = new Set(skills.map((s) => s.instructions.trim()));
    const recurringMistakes = rankRecurringMistakes(rows.decisions).map((m) => ({ ...m, alreadyInPlaybook: have.has(m.instructions.trim()) }));
    const recent = rows.equivalencies
      .filter((e) => new Date(e.createdAt).getTime() >= now - 30 * 86_400_000)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      headlines: buildHeadlines(series, 4),
      learned: {
        newEquivalencies: countInWindow(rows.equivalencies, now, 30),
        newEquivalencyExamples: recent.slice(0, 5).map((e) => e.label ?? '').filter(Boolean),
        playbookRulesAdded: rulesAdded,
        patternsResolved: countResolvedPatterns(rows.decisions, now, 30),
        days: 30,
      },
      recurringMistakes,
      hasData: rows.decisions.length > 0 || rows.courses.length > 0 || rows.equivalencies.length > 0,
    };
  }
}
