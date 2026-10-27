import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { estimateTokens } from './ai-pricing';

export interface AiSettings {
  id: number | null;
  institutionId: number | null;
  institutionName?: string | null;
  isEnabled: boolean;
  autoRunOnIntake: boolean;
  matchModel: string;
  escalationModel: string | null;
  escalateBelowConfidence: number;
  autoLikelyThreshold: number;
  prefilterTopN: number;
  maxDescriptionChars: number;
  useTopics: boolean;
  useResultCache: boolean;
  usePromptCaching: boolean;
  maxOutputTokens: number;
  maxTokensPerRequest: number | null;
  monthlyTokenBudget: number | null;
  narrativeBriefEnabled: boolean;
  /** Built-in rules engine takes over document reading / course matching when AI is off or unavailable. */
  rulesFallbackEnabled: boolean;
}

/** Used when migration 013 hasn't been applied yet, so nothing breaks before the tables exist. */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  id: null,
  institutionId: null,
  isEnabled: true,
  autoRunOnIntake: true,
  matchModel: 'claude-haiku-4-5',
  escalationModel: 'claude-opus-4-5',
  escalateBelowConfidence: 0.6,
  autoLikelyThreshold: 0.75,
  prefilterTopN: 8,
  maxDescriptionChars: 160,
  useTopics: true,
  useResultCache: true,
  usePromptCaching: true,
  maxOutputTokens: 600,
  maxTokensPerRequest: null,
  monthlyTokenBudget: null,
  narrativeBriefEnabled: false,
  rulesFallbackEnabled: true,
};

interface SettingsRow {
  Id: number;
  InstitutionId: number | null;
  InstitutionName?: string | null;
  IsEnabled: boolean;
  AutoRunOnIntake: boolean;
  MatchModel: string;
  EscalationModel: string | null;
  EscalateBelowConfidence: number;
  AutoLikelyThreshold: number;
  PrefilterTopN: number;
  MaxDescriptionChars: number;
  UseTopics: boolean;
  UseResultCache: boolean;
  UsePromptCaching: boolean;
  MaxOutputTokens: number;
  MaxTokensPerRequest: number | null;
  MonthlyTokenBudget: number | string | null;
  NarrativeBriefEnabled: boolean;
  RulesFallbackEnabled?: boolean | null; // absent until migration 021
}

function mapSettings(r: SettingsRow): AiSettings {
  return {
    id: r.Id,
    institutionId: r.InstitutionId,
    institutionName: r.InstitutionName ?? null,
    isEnabled: !!r.IsEnabled,
    autoRunOnIntake: !!r.AutoRunOnIntake,
    matchModel: r.MatchModel,
    escalationModel: r.EscalationModel,
    escalateBelowConfidence: Number(r.EscalateBelowConfidence),
    autoLikelyThreshold: Number(r.AutoLikelyThreshold),
    prefilterTopN: r.PrefilterTopN,
    maxDescriptionChars: r.MaxDescriptionChars,
    useTopics: !!r.UseTopics,
    useResultCache: !!r.UseResultCache,
    usePromptCaching: !!r.UsePromptCaching,
    maxOutputTokens: r.MaxOutputTokens,
    maxTokensPerRequest: r.MaxTokensPerRequest,
    monthlyTokenBudget: r.MonthlyTokenBudget == null ? null : Number(r.MonthlyTokenBudget),
    narrativeBriefEnabled: !!r.NarrativeBriefEnabled,
    rulesFallbackEnabled: r.RulesFallbackEnabled == null ? true : !!r.RulesFallbackEnabled,
  };
}

export type AiSettingsInput = Partial<Omit<AiSettings, 'id' | 'institutionId' | 'institutionName'>>;

export interface AgentSkill {
  id: number;
  skillKey: string;
  title: string;
  category: string;
  instructions: string;
  isActive: boolean;
  sortOrder: number;
  tokenEstimate: number;
}

interface SkillRow {
  Id: number;
  SkillKey: string;
  Title: string;
  Category: string;
  Instructions: string;
  IsActive: boolean;
  SortOrder: number;
}

function mapSkill(r: SkillRow): AgentSkill {
  return {
    id: r.Id,
    skillKey: r.SkillKey,
    title: r.Title,
    category: r.Category,
    instructions: r.Instructions,
    isActive: !!r.IsActive,
    sortOrder: r.SortOrder,
    tokenEstimate: estimateTokens(r.Instructions),
  };
}

const BASE_SYSTEM_PROMPT =
  'You are an expert transfer-credit evaluator. Given one external course and a shortlist of candidate courses at the receiving university, ' +
  'rank the best equivalents. Output a JSON array only (no markdown), each element: ' +
  '{"buCourseId":<id from the list>,"buCode":"","buTitle":"","rank":1,"confidenceScore":0.0-1.0,"rationale":""}. Maximum 3 elements.';

@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);
  constructor(private db: DatabaseService) {}

  /** University override if there is one, else the global row, else built-in defaults. Never throws. */
  /** Effective settings. AI_DISABLED=true in the environment is a hard kill switch over whatever the database says. */
  async getEffective(institutionId?: number | null): Promise<AiSettings> {
    const s = await this.loadEffective(institutionId);
    return process.env.AI_DISABLED === 'true' ? { ...s, isEnabled: false } : s;
  }

  private async loadEffective(institutionId?: number | null): Promise<AiSettings> {
    try {
      const res = await this.db.query<SettingsRow>(
        `SELECT TOP 1 * FROM AiSettings
         WHERE InstitutionId = @inst OR InstitutionId IS NULL
         ORDER BY CASE WHEN InstitutionId IS NULL THEN 1 ELSE 0 END`,
        [{ name: 'inst', type: sql.Int, value: institutionId ?? null }],
      );
      return res.recordset[0] ? mapSettings(res.recordset[0]) : { ...DEFAULT_AI_SETTINGS };
    } catch (err) {
      this.logger.warn(`AiSettings unavailable, using defaults: ${(err as Error).message}`);
      return { ...DEFAULT_AI_SETTINGS };
    }
  }

  async list(): Promise<AiSettings[]> {
    const res = await this.db.query<SettingsRow>(
      `SELECT s.*, i.Name AS InstitutionName
       FROM AiSettings s LEFT JOIN Institutions i ON i.Id = s.InstitutionId
       ORDER BY CASE WHEN s.InstitutionId IS NULL THEN 0 ELSE 1 END, i.Name`,
    );
    return res.recordset.map(mapSettings);
  }

  async upsert(institutionId: number | null, input: AiSettingsInput, userId: string): Promise<AiSettings> {
    const cur = await this.db.query<SettingsRow>(
      `SELECT * FROM AiSettings WHERE (@inst IS NULL AND InstitutionId IS NULL) OR InstitutionId = @inst`,
      [{ name: 'inst', type: sql.Int, value: institutionId }],
    );
    // A university override starts as a copy of the global row so unspecified fields inherit it.
    const base: AiSettings = cur.recordset[0] ? mapSettings(cur.recordset[0]) : await this.getEffective(null);
    const m = { ...base, ...input };

    const inputs = [
      { name: 'inst', type: sql.Int, value: institutionId },
      { name: 'enabled', type: sql.Bit, value: m.isEnabled ? 1 : 0 },
      { name: 'auto', type: sql.Bit, value: m.autoRunOnIntake ? 1 : 0 },
      { name: 'model', type: sql.NVarChar(100), value: m.matchModel },
      { name: 'esc', type: sql.NVarChar(100), value: m.escalationModel || null },
      { name: 'escConf', type: sql.Decimal(5, 4), value: m.escalateBelowConfidence },
      { name: 'likely', type: sql.Decimal(5, 4), value: m.autoLikelyThreshold },
      { name: 'topN', type: sql.Int, value: m.prefilterTopN },
      { name: 'descChars', type: sql.Int, value: m.maxDescriptionChars },
      { name: 'topics', type: sql.Bit, value: m.useTopics ? 1 : 0 },
      { name: 'cache', type: sql.Bit, value: m.useResultCache ? 1 : 0 },
      { name: 'pcache', type: sql.Bit, value: m.usePromptCaching ? 1 : 0 },
      { name: 'maxOut', type: sql.Int, value: m.maxOutputTokens },
      { name: 'perReq', type: sql.Int, value: m.maxTokensPerRequest },
      { name: 'monthly', type: sql.BigInt, value: m.monthlyTokenBudget },
      { name: 'narr', type: sql.Bit, value: m.narrativeBriefEnabled ? 1 : 0 },
      { name: 'by', type: sql.UniqueIdentifier, value: userId },
    ];

    if (cur.recordset[0]) {
      await this.db.query(
        `UPDATE AiSettings SET IsEnabled=@enabled, AutoRunOnIntake=@auto, MatchModel=@model, EscalationModel=@esc,
           EscalateBelowConfidence=@escConf, AutoLikelyThreshold=@likely, PrefilterTopN=@topN, MaxDescriptionChars=@descChars,
           UseTopics=@topics, UseResultCache=@cache, UsePromptCaching=@pcache, MaxOutputTokens=@maxOut,
           MaxTokensPerRequest=@perReq, MonthlyTokenBudget=@monthly, NarrativeBriefEnabled=@narr,
           UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@by
         WHERE Id = ${cur.recordset[0].Id}`,
        inputs,
      );
    } else {
      await this.db.query(
        `INSERT INTO AiSettings (InstitutionId, IsEnabled, AutoRunOnIntake, MatchModel, EscalationModel, EscalateBelowConfidence,
           AutoLikelyThreshold, PrefilterTopN, MaxDescriptionChars, UseTopics, UseResultCache, UsePromptCaching,
           MaxOutputTokens, MaxTokensPerRequest, MonthlyTokenBudget, NarrativeBriefEnabled, UpdatedBy)
         VALUES (@inst, @enabled, @auto, @model, @esc, @escConf, @likely, @topN, @descChars, @topics, @cache, @pcache,
           @maxOut, @perReq, @monthly, @narr, @by)`,
        inputs,
      );
    }
    if (input.rulesFallbackEnabled !== undefined || !cur.recordset[0]) {
      // Separate statement: the column only exists once migration 021 is applied, and that must not break saving the rest.
      await this.db
        .query(
          `UPDATE AiSettings SET RulesFallbackEnabled = @rf WHERE (@inst IS NULL AND InstitutionId IS NULL) OR InstitutionId = @inst`,
          [
            { name: 'inst', type: sql.Int, value: institutionId },
            { name: 'rf', type: sql.Bit, value: m.rulesFallbackEnabled ? 1 : 0 },
          ],
        )
        .catch((err: Error) => this.logger.warn(`Rules fallback setting not saved (apply migration 021): ${err.message}`));
    }
    return this.getEffective(institutionId);
  }

  async removeOverride(institutionId: number): Promise<void> {
    await this.db.query(`DELETE FROM AiSettings WHERE InstitutionId = @inst`, [
      { name: 'inst', type: sql.Int, value: institutionId },
    ]);
  }

  // ── Skills (playbook) ───────────────────────────────────────

  async listSkills(): Promise<AgentSkill[]> {
    const res = await this.db.query<SkillRow>(`SELECT * FROM AgentSkills ORDER BY SortOrder, Id`);
    return res.recordset.map(mapSkill);
  }

  async saveSkill(
    id: number | null,
    dto: { skillKey?: string; title: string; category: string; instructions: string; isActive: boolean; sortOrder?: number },
    userId: string,
  ): Promise<AgentSkill> {
    const inputs = [
      { name: 'title', type: sql.NVarChar(150), value: dto.title },
      { name: 'cat', type: sql.VarChar(14), value: dto.category },
      { name: 'ins', type: sql.NVarChar(sql.MAX), value: dto.instructions },
      { name: 'active', type: sql.Bit, value: dto.isActive ? 1 : 0 },
      { name: 'sort', type: sql.Int, value: dto.sortOrder ?? 100 },
      { name: 'by', type: sql.UniqueIdentifier, value: userId },
    ];
    if (id) {
      const res = await this.db.query<SkillRow>(
        `UPDATE AgentSkills SET Title=@title, Category=@cat, Instructions=@ins, IsActive=@active, SortOrder=@sort,
           UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@by
         OUTPUT inserted.* WHERE Id = ${Number(id)}`,
        inputs,
      );
      if (!res.recordset[0]) throw new NotFoundException('Skill not found');
      return mapSkill(res.recordset[0]);
    }
    const key = (dto.skillKey || dto.title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
    const res = await this.db.query<SkillRow>(
      `INSERT INTO AgentSkills (SkillKey, Title, Category, Instructions, IsActive, SortOrder, UpdatedBy)
       OUTPUT inserted.* VALUES (@key, @title, @cat, @ins, @active, @sort, @by)`,
      [{ name: 'key', type: sql.VarChar(60), value: key }, ...inputs],
    );
    return mapSkill(res.recordset[0]);
  }

  async removeSkill(id: number): Promise<void> {
    await this.db.query(`DELETE FROM AgentSkills WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
  }

  /** The exact system prompt the matcher sends, built from the active skills. */
  async buildSystemPrompt(): Promise<{ text: string; tokenEstimate: number; skillCount: number }> {
    let skills: AgentSkill[] = [];
    try {
      // 'documents' skills belong to the document reader, not the course matcher.
      skills = (await this.listSkills()).filter((s) => s.isActive && s.category !== 'documents');
    } catch (err) {
      this.logger.warn(`AgentSkills unavailable, using base prompt only: ${(err as Error).message}`);
    }
    const text = skills.length
      ? `${BASE_SYSTEM_PROMPT}\n\nRules:\n${skills.map((s) => `- ${s.instructions}`).join('\n')}`
      : BASE_SYSTEM_PROMPT;
    return { text, tokenEstimate: estimateTokens(text), skillCount: skills.length };
  }
}
