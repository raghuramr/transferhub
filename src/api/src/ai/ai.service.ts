import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import { AiSettings, AiSettingsService } from './ai-settings.service';
import { AiProvidersService, isChatReady, type ChatProvider, type CustomProvider } from './ai-providers.service';
import { AiUsageService, SkipReason } from './ai-usage.service';
import { estimateCostUsd, estimateTokens, TokenUsage } from './ai-pricing';
import { CatalogCourse, normalizeKey, shortlist } from './course-prefilter';
import { rulesMatch } from './rules-matcher';

export interface CourseMatchResult {
  buCourseId: number;
  buCode: string;
  buTitle: string;
  rank: number;
  confidenceScore: number;
  rationale: string;
}

interface MatchContextRow {
  EvalId: string;
  TcId: string;
  TranscriptId: string;
  CourseCode: string;
  CourseTitle: string;
  OriginalCredits: number | null;
  NormalisedCredits: number | null;
  ExternalCourseId: number | null;
  ExternalInstitutionId: number;
  InstitutionName: string;
  Calendar: string | null;
  ExtDescription: string | null;
}

interface CatalogRow {
  Id: number;
  Code: string;
  Title: string;
  Credits: number;
  ProgramArea: string | null;
  Description: string | null;
}

interface TranscriptSummaryRow {
  Id: string;
  Status: string;
  StudentName: string;
  InstitutionName: string;
  TargetInstitutionId: number | null;
  TotalCourses: number;
  Applied: number;
  Pending: number;
  NotEligible: number;
  Elective: number;
}

export interface PipelineMatchResult {
  matched: number;
  fromCache: number;
  skipped: number;
  failed: number;
  reasons: string[];
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private config: ConfigService,
    private db: DatabaseService,
    private settingsService: AiSettingsService,
    private usage: AiUsageService,
    private providers: AiProvidersService,
  ) {}

  /** Is a usable chat provider configured right now (Anthropic key, or a complete Azure OpenAI setup)? */
  private async hasApiKey(): Promise<boolean> {
    return isChatReady(await this.providers.getConfig());
  }

  private async assertApiKey() {
    if (!(await this.hasApiKey())) {
      throw new BadRequestException('No AI provider is configured. Set an Anthropic key or an Azure OpenAI deployment in AI Controls > Providers.');
    }
  }

  /** Public: is a chat provider (Anthropic or Azure OpenAI) usable right now? */
  async hasChatProvider(): Promise<boolean> {
    return this.hasApiKey();
  }

  /** Public: run a one-shot text completion through the configured chat provider. Used by the document reader. */
  async completeText(systemText: string, userText: string, maxTokens = 2000) {
    const settings = await this.settingsService.getEffective(null);
    return this.callModel(settings.matchModel, systemText, userText, settings, maxTokens);
  }

  private async resolveTargetInstitutionId(transcriptId: string): Promise<number | null> {
    try {
      const res = await this.db.query<{ Target: number | null }>(
        `SELECT TargetInstitutionId AS Target FROM Transcripts WHERE Id = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      if (res.recordset[0]?.Target) return res.recordset[0].Target;
    } catch {
      // Column only exists once migration 013 is applied — fall through to the default.
    }
    const bu = await this.db.query<{ Id: number }>(`SELECT TOP 1 Id FROM Institutions WHERE Code = 'BU'`);
    return bu.recordset[0]?.Id ?? null;
  }

  private async callModel(
    model: string,
    systemText: string,
    userText: string,
    settings: AiSettings,
    maxTokens: number,
  ) {
    const cfg = await this.providers.getConfig();
    return this.callWith(cfg, cfg.chatProvider, model, systemText, userText, settings, maxTokens);
  }

  /** Runs one completion through a specific provider (the active one for real calls, any one for the "Test" button). */
  private async callWith(
    cfg: Awaited<ReturnType<AiProvidersService['getConfig']>>,
    which: ChatProvider,
    model: string,
    systemText: string,
    userText: string,
    settings: AiSettings,
    maxTokens: number,
  ) {
    if (which === 'azure_openai') {
      return this.callAzureOpenAi(cfg, systemText, userText, maxTokens);
    }
    if (which.startsWith('custom:')) {
      const cp = cfg.customProviders.find((x) => `custom:${x.id}` === which);
      if (!cp) throw new Error('That AI provider no longer exists.');
      return this.callOpenAiCompatible(cp, systemText, userText, maxTokens);
    }
    if (which === 'none') throw new Error('No AI provider is active.');
    const started = Date.now();
    const client = new Anthropic({ apiKey: cfg.anthropicKey ?? '', ...(cfg.anthropicBaseUrl ? { baseURL: cfg.anthropicBaseUrl } : {}) });
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: settings.usePromptCaching
        ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
        : systemText,
      messages: [{ role: 'user', content: userText }],
    });
    const u = message.usage;
    const tokenUsage: TokenUsage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    };
    const block = message.content[0];
    return {
      text: block && block.type === 'text' ? block.text : '',
      usage: tokenUsage,
      costUsd: estimateCostUsd(model, tokenUsage),
      ms: Date.now() - started,
    };
  }

  /** Admin-added provider speaking the OpenAI chat-completions API (base URL + model + key). */
  private async callOpenAiCompatible(cp: CustomProvider, systemText: string, userText: string, maxTokens: number) {
    const started = Date.now();
    const url = /\/chat\/completions$/.test(cp.baseUrl) ? cp.baseUrl : `${cp.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cp.apiKey) headers[cp.authStyle === 'api-key' ? 'api-key' : 'Authorization'] = cp.authStyle === 'api-key' ? cp.apiKey : `Bearer ${cp.apiKey}`;
    const messages = [{ role: 'system', content: systemText }, { role: 'user', content: userText }];
    const post = (body: Record<string, unknown>) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    let res = await post({ model: cp.model, messages, max_tokens: maxTokens, temperature: 0 });
    if (res.status === 400) {
      // Newer reasoning models reject max_tokens / temperature: retry in their dialect.
      const first = await res.text().catch(() => '');
      if (/max_completion_tokens|max_tokens|temperature/i.test(first)) res = await post({ model: cp.model, messages, max_completion_tokens: maxTokens });
      else throw new Error(`${cp.name} 400: ${first.slice(0, 300)}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${cp.name} ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const tokenUsage: TokenUsage = { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0 };
    return { text: data.choices?.[0]?.message?.content ?? '', usage: tokenUsage, costUsd: estimateCostUsd(cp.model, tokenUsage), ms: Date.now() - started };
  }

  /** "Test connection": a tiny completion through the named provider; never throws, returns the outcome for the UI. */
  async testProvider(which: ChatProvider): Promise<{ ok: boolean; ms?: number; reply?: string; error?: string }> {
    try {
      const cfg = await this.providers.getConfig();
      if (!isChatReady(cfg, which)) return { ok: false, error: 'This provider is not fully configured yet (key, URL or model missing).' };
      const settings = await this.settingsService.getEffective(null);
      const r = await this.callWith(cfg, which, settings.matchModel, 'You are a connectivity check. Reply with the single word OK.', 'ping', settings, 16);
      return { ok: true, ms: r.ms, reply: String(r.text).trim().slice(0, 80) };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) };
    }
  }

  /** Azure OpenAI chat completion via REST (no extra SDK). Same {text, usage, cost, ms} shape as the Anthropic path. */
  private async callAzureOpenAi(
    cfg: { azureOpenAiEndpoint: string | null; azureOpenAiKey: string | null; azureOpenAiDeployment: string | null; azureOpenAiApiVersion: string },
    systemText: string,
    userText: string,
    maxTokens: number,
  ) {
    const started = Date.now();
    const base = (cfg.azureOpenAiEndpoint ?? '').replace(/\/+$/, '');
    const url = `${base}/openai/deployments/${cfg.azureOpenAiDeployment}/chat/completions?api-version=${cfg.azureOpenAiApiVersion}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.azureOpenAiKey ?? '' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemText },
          { role: 'user', content: userText },
        ],
        max_tokens: maxTokens,
        temperature: 0,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Azure OpenAI ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const tokenUsage: TokenUsage = {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: tokenUsage,
      costUsd: estimateCostUsd(cfg.azureOpenAiDeployment ?? 'azure-openai', tokenUsage),
      ms: Date.now() - started,
    };
  }

  private parseCandidates(text: string): Partial<CourseMatchResult>[] {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < start) throw new Error('AI returned no JSON array');
    const arr: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) throw new Error('AI returned a non-array');
    return arr as Partial<CourseMatchResult>[];
  }

  /** Drops hallucinated ids, clamps scores, and renumbers ranks by confidence. */
  private validate(raw: Partial<CourseMatchResult>[], allowed: Map<number, CatalogCourse>): CourseMatchResult[] {
    return raw
      .filter((c) => c.buCourseId != null && allowed.has(Number(c.buCourseId)))
      .map((c) => {
        const course = allowed.get(Number(c.buCourseId))!;
        return {
          buCourseId: course.id,
          buCode: course.code,
          buTitle: course.title,
          rank: 0,
          confidenceScore: Math.max(0, Math.min(1, Number(c.confidenceScore) || 0)),
          rationale: String(c.rationale ?? '').slice(0, 600),
        };
      })
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 3)
      .map((c, i) => ({ ...c, rank: i + 1 }));
  }

  /**
   * Token-minimising match for one evaluation. In order: respect the AI
   * on/off switch and budgets -> reuse a cached result for the same external
   * course -> shortlist the catalogue lexically (zero tokens) -> ask the
   * cheap model -> escalate to the stronger model only if unsure. Every
   * outcome, including skips, is written to AiUsageLog.
   */
  async matchCourse(evaluationId: string, requestedByUserId: string): Promise<CourseMatchResult[]> {
    return (await this.runMatch(evaluationId, requestedByUserId)).candidates;
  }

  private async runMatch(
    evaluationId: string,
    requestedByUserId: string,
  ): Promise<{ candidates: CourseMatchResult[]; fromCache: boolean }> {
    const ctxRes = await this.db.query<MatchContextRow>(
      `SELECT e.Id AS EvalId, tc.Id AS TcId, tc.TranscriptId, tc.CourseCode, tc.CourseTitle,
              tc.OriginalCredits, tc.NormalisedCredits, tc.ExternalCourseId,
              t.InstitutionId AS ExternalInstitutionId,
              i.Name AS InstitutionName, i.Calendar, ec.Description AS ExtDescription
       FROM Evaluations e
       JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       JOIN Transcripts t        ON t.Id = tc.TranscriptId
       JOIN Institutions i       ON i.Id = t.InstitutionId
       LEFT JOIN Courses ec      ON ec.Id = tc.ExternalCourseId
       WHERE e.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: evaluationId }],
    );
    if (!ctxRes.recordset[0]) throw new NotFoundException('Evaluation not found');
    const ctx = ctxRes.recordset[0];

    const targetId = await this.resolveTargetInstitutionId(ctx.TranscriptId);
    const settings = await this.settingsService.getEffective(targetId);
    const baseLog = {
      transcriptId: ctx.TranscriptId,
      evaluationId,
      institutionId: targetId,
      requestedByUserId,
    };
    const skip = async (reason: SkipReason, message: string, saved = 0): Promise<never> => {
      await this.usage.log({ ...baseLog, operation: 'match', skipped: true, skipReason: reason, estTokensSaved: saved });
      throw new BadRequestException(message);
    };

    // Why the model cannot be used right now (if it cannot). With the rules fallback on we match without it instead of stopping.
    let aiBlock: { reason: SkipReason; message: string } | null = null;
    if (!settings.isEnabled) aiBlock = { reason: 'ai_disabled', message: 'AI matching is switched off in AI Controls.' };
    else if (!(await this.hasApiKey())) aiBlock = { reason: 'error', message: 'No AI provider is configured (set Anthropic or Azure OpenAI in AI Controls > Providers).' };
    else if (settings.monthlyTokenBudget != null && (await this.usage.tokensThisMonth()) >= settings.monthlyTokenBudget) {
      aiBlock = { reason: 'budget_exceeded', message: 'The monthly AI token budget has been used up.' };
    } else if (
      settings.maxTokensPerRequest != null &&
      (await this.usage.tokensForTranscript(ctx.TranscriptId)) >= settings.maxTokensPerRequest
    ) {
      aiBlock = { reason: 'request_cap', message: 'This transfer request has reached its AI token cap.' };
    }
    if (aiBlock && !settings.rulesFallbackEnabled) await skip(aiBlock.reason, aiBlock.message);

    // 1) Cross-student cache: the same external course against the same target needs one model call, ever.
    const cacheKey = [
      { name: 'tgt', type: sql.Int, value: targetId },
      { name: 'ext', type: sql.Int, value: ctx.ExternalInstitutionId },
      { name: 'code', type: sql.NVarChar(50), value: normalizeKey(ctx.CourseCode) },
      { name: 'title', type: sql.NVarChar(300), value: normalizeKey(ctx.CourseTitle).slice(0, 300) },
    ];
    if (!aiBlock && settings.useResultCache && targetId) {
      try {
        const hit = await this.db.query<{ Id: number; CandidatesJson: string }>(
          `SELECT Id, CandidatesJson FROM AiMatchCache
           WHERE TargetInstitutionId=@tgt AND ExternalInstitutionId=@ext AND CourseCodeNorm=@code AND TitleNorm=@title`,
          cacheKey,
        );
        if (hit.recordset[0]) {
          await this.db.query(`UPDATE AiMatchCache SET HitCount = HitCount + 1, LastHitAt = SYSUTCDATETIME() WHERE Id = @id`, [
            { name: 'id', type: sql.Int, value: hit.recordset[0].Id },
          ]);
          const cached = JSON.parse(hit.recordset[0].CandidatesJson) as CourseMatchResult[];
          await this.usage.log({
            ...baseLog,
            operation: 'match',
            skipped: true,
            skipReason: 'cache_hit',
            estTokensSaved: await this.usage.avgMatchTokens(),
          });
          await this.persist(evaluationId, ctx.TcId, cached, settings.autoLikelyThreshold);
          return { candidates: cached, fromCache: true };
        }
      } catch (err) {
        this.logger.warn(`Match cache unavailable: ${(err as Error).message}`);
      }
    }

    // 2) Catalogue + topics, then a zero-token lexical shortlist.
    const catRes = await this.db.query<CatalogRow>(
      `SELECT Id, Code, Title, Credits, ProgramArea, Description FROM Courses
       WHERE InstitutionId = @tgt AND IsActive = 1 ORDER BY Code`,
      [{ name: 'tgt', type: sql.Int, value: targetId }],
    );
    const topicsByCourse = new Map<number, string[]>();
    const topicCourseIds = [ctx.ExternalCourseId, ...catRes.recordset.map((c) => c.Id)].filter((x): x is number => x != null);
    if (settings.useTopics && topicCourseIds.length) {
      const tr = await this.db.query<{ CourseId: number; Title: string }>(
        `SELECT CourseId, Title FROM CourseTopics
         WHERE CourseId IN (SELECT Id FROM Courses WHERE InstitutionId = @tgt AND IsActive = 1)
            OR CourseId = ISNULL(@extId, -1)
         ORDER BY CourseId, SortOrder`,
        [
          { name: 'tgt', type: sql.Int, value: targetId },
          { name: 'extId', type: sql.Int, value: ctx.ExternalCourseId },
        ],
      );
      for (const t of tr.recordset) {
        const list = topicsByCourse.get(t.CourseId) ?? [];
        if (list.length < 6) list.push(t.Title);
        topicsByCourse.set(t.CourseId, list);
      }
    }
    const catalog: CatalogCourse[] = catRes.recordset.map((c) => ({
      id: c.Id,
      code: c.Code,
      title: c.Title,
      credits: Number(c.Credits),
      programArea: c.ProgramArea,
      description: c.Description,
      topics: topicsByCourse.get(c.Id) ?? [],
    }));
    const credits = ctx.NormalisedCredits ?? ctx.OriginalCredits;
    const extTopics = ctx.ExternalCourseId ? topicsByCourse.get(ctx.ExternalCourseId) ?? [] : [];
    const extFacts = {
      code: ctx.CourseCode,
      title: ctx.CourseTitle,
      credits: credits == null ? null : Number(credits),
      text: `${ctx.ExtDescription ?? ''} ${extTopics.join(' ')}`,
    };
    const byRules = async () => {
      const found = rulesMatch(extFacts, catalog, 3).map((c) => ({
        buCourseId: c.courseId, buCode: c.code, buTitle: c.title, rank: c.rank, confidenceScore: c.confidence, rationale: c.rationale,
      }));
      await this.usage.log({ ...baseLog, operation: 'match', model: 'built-in rules', catalogSize: catalog.length, candidatesSent: found.length });
      if (found.length) await this.persist(evaluationId, ctx.TcId, found, settings.autoLikelyThreshold);
      return { candidates: found, fromCache: false };
    };
    if (aiBlock) return byRules();

    const picked = shortlist(
      {
        code: ctx.CourseCode,
        title: ctx.CourseTitle,
        credits: credits == null ? null : Number(credits),
        text: `${ctx.ExtDescription ?? ''} ${extTopics.join(' ')}`,
      },
      catalog,
      settings.prefilterTopN,
    );
    if (!picked.length) await skip('error', 'The receiving university has no active courses to match against.');

    const line = (c: CatalogCourse) =>
      `[${c.id}] ${c.code} - ${c.title} (${c.credits}cr)` +
      (c.topics.length ? ` | topics: ${c.topics.join('; ')}` : '') +
      (c.description && settings.maxDescriptionChars > 0 ? ` | ${c.description.slice(0, settings.maxDescriptionChars)}` : '');
    const userPrompt =
      `EXTERNAL COURSE: ${ctx.CourseCode} - ${ctx.CourseTitle} (${credits ?? '?'}cr, ${ctx.Calendar ?? 'semester'} calendar, ${ctx.InstitutionName})` +
      (ctx.ExtDescription ? `\nDescription: ${ctx.ExtDescription.slice(0, settings.maxDescriptionChars * 2)}` : '') +
      (extTopics.length ? `\nTopics: ${extTopics.join('; ')}` : '') +
      `\n\nCANDIDATES:\n${picked.map(line).join('\n')}`;
    const fullCatalogChars = catalog.reduce((n, c) => n + line(c).length, 0);
    const savedByShortlist = Math.max(0, estimateTokens(' '.repeat(fullCatalogChars)) - estimateTokens(picked.map(line).join('\n')));

    const system = (await this.settingsService.buildSystemPrompt()).text;
    const allowed = new Map(picked.map((c) => [c.id, c]));
    const sentInfo = { catalogSize: catalog.length, candidatesSent: picked.length };

    // 3) Cheap model first, stronger model only when unsure.
    let model = settings.matchModel;
    let candidates: CourseMatchResult[] = [];
    try {
      let call = await this.callModel(model, system, userPrompt, settings, settings.maxOutputTokens);
      await this.usage.log({
        ...baseLog, ...sentInfo, operation: 'match', model,
        inputTokens: call.usage.input, outputTokens: call.usage.output,
        cacheReadTokens: call.usage.cacheRead, cacheWriteTokens: call.usage.cacheWrite,
        estimatedCostUsd: call.costUsd, durationMs: call.ms, estTokensSaved: savedByShortlist,
      });
      candidates = this.validate(this.parseCandidates(call.text), allowed);

      const unsure = !candidates.length || candidates[0].confidenceScore < settings.escalateBelowConfidence;
      if (unsure && settings.escalationModel && settings.escalationModel !== settings.matchModel) {
        model = settings.escalationModel;
        call = await this.callModel(model, system, userPrompt, settings, settings.maxOutputTokens);
        await this.usage.log({
          ...baseLog, ...sentInfo, operation: 'escalate', model,
          inputTokens: call.usage.input, outputTokens: call.usage.output,
          cacheReadTokens: call.usage.cacheRead, cacheWriteTokens: call.usage.cacheWrite,
          estimatedCostUsd: call.costUsd, durationMs: call.ms,
        });
        candidates = this.validate(this.parseCandidates(call.text), allowed);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`AI match failed for ${ctx.CourseCode}: ${(err as Error).message}`);
      await this.usage.log({ ...baseLog, ...sentInfo, operation: 'match', model, skipped: true, skipReason: 'error' });
      if (settings.rulesFallbackEnabled) return byRules();
      throw new BadRequestException(`AI matching failed: ${(err as Error).message}`);
    }

    if (candidates.length && settings.useResultCache && targetId) {
      try {
        await this.db.query(
          `UPDATE AiMatchCache SET CandidatesJson=@json, TopConfidence=@conf, Model=@model, CreatedAt=SYSUTCDATETIME(), HitCount=0
           WHERE TargetInstitutionId=@tgt AND ExternalInstitutionId=@ext AND CourseCodeNorm=@code AND TitleNorm=@title;
           IF @@ROWCOUNT = 0
             INSERT INTO AiMatchCache (TargetInstitutionId, ExternalInstitutionId, CourseCodeNorm, TitleNorm, CandidatesJson, TopConfidence, Model)
             VALUES (@tgt, @ext, @code, @title, @json, @conf, @model)`,
          [
            ...cacheKey,
            { name: 'json', type: sql.NVarChar(sql.MAX), value: JSON.stringify(candidates) },
            { name: 'conf', type: sql.Decimal(5, 4), value: candidates[0].confidenceScore },
            { name: 'model', type: sql.NVarChar(100), value: model },
          ],
        );
      } catch (err) {
        this.logger.warn(`Could not cache match result: ${(err as Error).message}`);
      }
    }

    await this.persist(evaluationId, ctx.TcId, candidates, settings.autoLikelyThreshold);
    return { candidates, fromCache: false };
  }

  private async persist(evaluationId: string, tcId: string, candidates: CourseMatchResult[], likelyThreshold: number) {
    await this.db.query(`DELETE FROM AIMatchCandidates WHERE EvaluationId = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: evaluationId },
    ]);
    for (const c of candidates) {
      await this.db
        .query(
          `INSERT INTO AIMatchCandidates (EvaluationId, Rank, BUCourseId, Score, Rationale)
           VALUES (@evalId, @rank, @buId, @score, @rationale)`,
          [
            { name: 'evalId', type: sql.UniqueIdentifier, value: evaluationId },
            { name: 'rank', type: sql.Int, value: c.rank },
            { name: 'buId', type: sql.Int, value: c.buCourseId },
            { name: 'score', type: sql.Decimal(5, 4), value: c.confidenceScore },
            { name: 'rationale', type: sql.NVarChar(sql.MAX), value: c.rationale },
          ],
        )
        .catch((err: Error) => this.logger.error(`Failed to store candidate ${c.buCourseId}: ${err.message}`));
    }

    const top = candidates[0];
    if (!top) return;
    await this.db.query(
      `UPDATE Evaluations
       SET AISuggestionRaw = @raw, AISuggestedCourseId = @courseId, AIConfidence = @conf, AIRationale = @rationale,
           Status = CASE WHEN Status = 'queued' THEN 'in_progress' ELSE Status END, UpdatedAt = SYSUTCDATETIME()
       WHERE Id = @id`,
      [
        { name: 'raw', type: sql.NVarChar(sql.MAX), value: JSON.stringify(candidates) },
        { name: 'courseId', type: sql.Int, value: top.buCourseId },
        { name: 'conf', type: sql.Decimal(5, 4), value: top.confidenceScore },
        { name: 'rationale', type: sql.NVarChar(sql.MAX), value: top.rationale },
        { name: 'id', type: sql.UniqueIdentifier, value: evaluationId },
      ],
    );
    if (top.confidenceScore >= likelyThreshold) {
      await this.db.query(
        `UPDATE TranscriptCourses SET Lane = 'likely', UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND Lane = 'needs_syllabus'`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: tcId }],
      );
    }
  }

  /**
   * Pipeline entry point (the workflow's 'match' agent task): runs the
   * optimised matcher over every still-queued evaluation of a request, one
   * failure never blocking the rest. Honours AiSettings.AutoRunOnIntake.
   */
  async matchQueuedForTranscript(transcriptId: string, requestedByUserId: string): Promise<PipelineMatchResult> {
    const out: PipelineMatchResult = { matched: 0, fromCache: 0, skipped: 0, failed: 0, reasons: [] };
    const targetId = await this.resolveTargetInstitutionId(transcriptId);
    const settings = await this.settingsService.getEffective(targetId);
    const aiUsable = settings.isEnabled && (await this.hasApiKey());
    if (!settings.autoRunOnIntake || (!aiUsable && !settings.rulesFallbackEnabled)) {
      out.skipped = 1;
      out.reasons.push(
        !settings.autoRunOnIntake ? 'Auto-run on intake is off' : !settings.isEnabled ? 'AI is switched off' : 'AI key not configured',
      );
      return out;
    }
    if (!aiUsable) out.reasons.push('Matched with the built-in rules (AI unavailable)');
    const evals = await this.db.query<{ Id: string }>(
      `SELECT e.Id FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       WHERE tc.TranscriptId = @t AND e.Status = 'queued' AND e.AISuggestedCourseId IS NULL`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    for (const e of evals.recordset) {
      try {
        const r = await this.runMatch(e.Id, requestedByUserId);
        if (r.candidates.length) out.matched++;
        if (r.fromCache) out.fromCache++;
      } catch (err) {
        const msg = (err as Error).message;
        if (err instanceof BadRequestException) {
          out.skipped++;
          if (!out.reasons.includes(msg)) out.reasons.push(msg);
        } else {
          out.failed++;
        }
      }
    }
    return out;
  }

  /** Optional LLM-written reviewer summary of already-computed facts (off by default; the brief itself is free). */
  async writeBriefNarrative(transcriptId: string, facts: unknown): Promise<string | null> {
    const targetId = await this.resolveTargetInstitutionId(transcriptId);
    const settings = await this.settingsService.getEffective(targetId);
    if (!settings.isEnabled || !settings.narrativeBriefEnabled) return null;
    if (settings.monthlyTokenBudget != null && (await this.usage.tokensThisMonth()) >= settings.monthlyTokenBudget) return null;
    if (settings.maxTokensPerRequest != null && (await this.usage.tokensForTranscript(transcriptId)) >= settings.maxTokensPerRequest) return null;
    try {
      await this.assertApiKey();
      const call = await this.callModel(
        settings.matchModel,
        'You write a 2-3 sentence factual summary for an approver reviewing a transfer-credit request. Never decide; only describe.',
        JSON.stringify(facts),
        settings,
        150,
      );
      await this.usage.log({
        transcriptId, institutionId: targetId, operation: 'brief', model: settings.matchModel,
        inputTokens: call.usage.input, outputTokens: call.usage.output,
        cacheReadTokens: call.usage.cacheRead, cacheWriteTokens: call.usage.cacheWrite,
        estimatedCostUsd: call.costUsd, durationMs: call.ms,
      });
      return call.text.trim();
    } catch (err) {
      this.logger.warn(`Brief narrative skipped: ${(err as Error).message}`);
      return null;
    }
  }

  async generateSummary(transcriptId: string): Promise<string> {
    const res = await this.db.query<TranscriptSummaryRow>(
      `SELECT t.Id, t.Status,
              u.FirstName + ' ' + u.LastName AS StudentName,
              i.Name AS InstitutionName,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id) AS TotalCourses,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'applied') AS Applied,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane IN ('pending','needs_syllabus','likely')) AS Pending,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'not_eligible') AS NotEligible,
              (SELECT COUNT(*) FROM TranscriptCourses WHERE TranscriptId = t.Id AND Lane = 'elective_only') AS Elective
       FROM Transcripts t
       JOIN Users u        ON u.Id = t.StudentUserId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE t.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Transcript not found');
    const data = res.recordset[0];

    // The counts are already known, so a template costs nothing; the model is only used when the
    // narrative option is on in AI Controls.
    const plain =
      `${data.StudentName} (from ${data.InstitutionName}): ${data.TotalCourses} courses - ${data.Applied} applied, ` +
      `${data.Pending} pending, ${data.Elective} elective only, ${data.NotEligible} not eligible. Status: ${data.Status}.`;
    const narrative = await this.writeBriefNarrative(transcriptId, data);
    return narrative ?? plain;
  }
}
