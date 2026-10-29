import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';

export type AiOperation = 'match' | 'escalate' | 'brief' | 'summary' | 'read';
export type SkipReason =
  | 'ai_disabled'
  | 'cache_hit'
  | 'budget_exceeded'
  | 'request_cap'
  | 'equivalency_exists'
  | 'error';

export interface UsageEntry {
  transcriptId?: string | null;
  evaluationId?: string | null;
  institutionId?: number | null;
  operation: AiOperation;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number | null;
  skipped?: boolean;
  skipReason?: SkipReason | null;
  estTokensSaved?: number;
  catalogSize?: number | null;
  candidatesSent?: number | null;
  requestedByUserId?: string | null;
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);
  constructor(private db: DatabaseService) {}

  /** Accounting must never break the work being accounted for. */
  async log(e: UsageEntry): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO AiUsageLog (TranscriptId, EvaluationId, InstitutionId, Operation, Model, InputTokens, OutputTokens,
           CacheReadTokens, CacheWriteTokens, EstimatedCostUsd, DurationMs, Skipped, SkipReason, EstTokensSaved,
           CatalogSize, CandidatesSent, RequestedByUserId)
         VALUES (@tid, @eid, @inst, @op, @model, @in, @out, @cr, @cw, @cost, @ms, @skipped, @reason, @saved, @cat, @sent, @by)`,
        [
          { name: 'tid', type: sql.UniqueIdentifier, value: e.transcriptId ?? null },
          { name: 'eid', type: sql.UniqueIdentifier, value: e.evaluationId ?? null },
          { name: 'inst', type: sql.Int, value: e.institutionId ?? null },
          { name: 'op', type: sql.VarChar(12), value: e.operation },
          { name: 'model', type: sql.NVarChar(100), value: e.model ?? null },
          { name: 'in', type: sql.Int, value: e.inputTokens ?? 0 },
          { name: 'out', type: sql.Int, value: e.outputTokens ?? 0 },
          { name: 'cr', type: sql.Int, value: e.cacheReadTokens ?? 0 },
          { name: 'cw', type: sql.Int, value: e.cacheWriteTokens ?? 0 },
          { name: 'cost', type: sql.Decimal(12, 6), value: e.estimatedCostUsd ?? 0 },
          { name: 'ms', type: sql.Int, value: e.durationMs ?? null },
          { name: 'skipped', type: sql.Bit, value: e.skipped ? 1 : 0 },
          { name: 'reason', type: sql.VarChar(30), value: e.skipReason ?? null },
          { name: 'saved', type: sql.Int, value: e.estTokensSaved ?? 0 },
          { name: 'cat', type: sql.Int, value: e.catalogSize ?? null },
          { name: 'sent', type: sql.Int, value: e.candidatesSent ?? null },
          { name: 'by', type: sql.UniqueIdentifier, value: e.requestedByUserId ?? null },
        ],
      );
    } catch (err) {
      this.logger.warn(`Could not record AI usage: ${(err as Error).message}`);
    }
  }

  private async scalar(query: string, inputs: QueryInput[] = []): Promise<number> {
    try {
      const res = await this.db.query<{ n: number | string | null }>(query, inputs);
      return Number(res.recordset[0]?.n ?? 0);
    } catch {
      return 0;
    }
  }

  /** Billable tokens (input + output + cache) used so far this calendar month. */
  tokensThisMonth(): Promise<number> {
    return this.scalar(
      `SELECT SUM(CAST(InputTokens AS BIGINT) + OutputTokens + CacheReadTokens + CacheWriteTokens) AS n
       FROM AiUsageLog
       WHERE Skipped = 0 AND CreatedAt >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1)`,
    );
  }

  /** Estimated USD spent so far this calendar month. */
  costThisMonth(): Promise<number> {
    return this.scalar(
      `SELECT SUM(EstimatedCostUsd) AS n FROM AiUsageLog
       WHERE CreatedAt >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1)`,
    );
  }

  tokensForTranscript(transcriptId: string): Promise<number> {
    return this.scalar(
      `SELECT SUM(CAST(InputTokens AS BIGINT) + OutputTokens + CacheReadTokens + CacheWriteTokens) AS n
       FROM AiUsageLog WHERE Skipped = 0 AND TranscriptId = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
  }

  /** Average billable tokens of the last 20 real match calls — what a cache hit avoided. */
  avgMatchTokens(): Promise<number> {
    return this.scalar(
      `SELECT AVG(CAST(InputTokens + OutputTokens + CacheReadTokens + CacheWriteTokens AS BIGINT)) AS n
       FROM (SELECT TOP 20 InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens
             FROM AiUsageLog WHERE Skipped = 0 AND Operation IN ('match','escalate') ORDER BY Id DESC) x`,
    );
  }

  /** SQL Server returns BIGINT sums as strings; "3234" + "724" then concatenates in the UI. Convert the named columns to numbers. */
  private num<T extends Record<string, unknown>>(row: T | undefined, keys: string[]): Record<string, number> & T {
    const out: Record<string, unknown> = { ...(row ?? {}) };
    for (const k of keys) out[k] = Number(out[k] ?? 0);
    return out as Record<string, number> & T;
  }

  async summary(days: number) {
    const since = { name: 'days', type: sql.Int, value: days };
    const totals = await this.db.query(
      `SELECT COUNT(CASE WHEN Skipped = 0 THEN 1 END) AS calls,
              COUNT(CASE WHEN Skipped = 1 THEN 1 END) AS skippedCalls,
              ISNULL(SUM(CAST(InputTokens AS BIGINT)), 0)  AS inputTokens,
              ISNULL(SUM(CAST(OutputTokens AS BIGINT)), 0) AS outputTokens,
              ISNULL(SUM(CAST(CacheReadTokens AS BIGINT)), 0)  AS cacheReadTokens,
              ISNULL(SUM(CAST(CacheWriteTokens AS BIGINT)), 0) AS cacheWriteTokens,
              ISNULL(SUM(EstimatedCostUsd), 0) AS costUsd,
              ISNULL(SUM(CAST(EstTokensSaved AS BIGINT)), 0) AS tokensSaved,
              COUNT(DISTINCT TranscriptId) AS requests,
              COUNT(CASE WHEN SkipReason = 'cache_hit' THEN 1 END) AS cacheHits,
              ISNULL(AVG(CASE WHEN Skipped = 0 THEN CAST(DurationMs AS BIGINT) END), 0) AS avgMs,
              ISNULL(MAX(CASE WHEN Skipped = 0 THEN DurationMs END), 0) AS maxMs
       FROM AiUsageLog WHERE CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())`,
      [since],
    );
    const byDay = await this.db.query(
      `SELECT CONVERT(VARCHAR(10), CreatedAt, 23) AS day,
              ISNULL(SUM(CAST(InputTokens + OutputTokens + CacheReadTokens + CacheWriteTokens AS BIGINT)), 0) AS tokens,
              ISNULL(SUM(EstimatedCostUsd), 0) AS costUsd,
              ISNULL(SUM(CAST(EstTokensSaved AS BIGINT)), 0) AS tokensSaved
       FROM AiUsageLog WHERE CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())
       GROUP BY CONVERT(VARCHAR(10), CreatedAt, 23) ORDER BY day`,
      [since],
    );
    const byOperation = await this.db.query(
      `SELECT Operation AS operation, COUNT(CASE WHEN Skipped = 0 THEN 1 END) AS calls,
              ISNULL(SUM(CAST(InputTokens + OutputTokens + CacheReadTokens + CacheWriteTokens AS BIGINT)), 0) AS tokens,
              ISNULL(SUM(EstimatedCostUsd), 0) AS costUsd,
              ISNULL(AVG(CASE WHEN Skipped = 0 THEN CAST(DurationMs AS BIGINT) END), 0) AS avgMs
       FROM AiUsageLog WHERE CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME()) GROUP BY Operation`,
      [since],
    );
    const byModel = await this.db.query(
      `SELECT ISNULL(Model, 'n/a') AS model, COUNT(*) AS calls,
              ISNULL(SUM(CAST(InputTokens + OutputTokens + CacheReadTokens + CacheWriteTokens AS BIGINT)), 0) AS tokens,
              ISNULL(SUM(EstimatedCostUsd), 0) AS costUsd,
              ISNULL(AVG(CAST(DurationMs AS BIGINT)), 0) AS avgMs
       FROM AiUsageLog WHERE Skipped = 0 AND CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME()) GROUP BY Model ORDER BY SUM(CAST(InputTokens + OutputTokens AS BIGINT)) DESC`,
      [since],
    );
    const bySkip = await this.db.query(
      `SELECT SkipReason AS reason, COUNT(*) AS n, ISNULL(SUM(CAST(EstTokensSaved AS BIGINT)), 0) AS tokensSaved
       FROM AiUsageLog WHERE Skipped = 1 AND CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME()) GROUP BY SkipReason`,
      [since],
    );
    // Spend that is not tied to a transfer request (benchmarks, provider tests, documents read before submission).
    const unlinked = await this.db.query(
      `SELECT ISNULL(SUM(EstimatedCostUsd), 0) AS costUsd, COUNT(CASE WHEN Skipped = 0 THEN 1 END) AS calls
       FROM AiUsageLog WHERE TranscriptId IS NULL AND CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())`,
      [since],
    );
    const prefilter = await this.db.query(
      `SELECT ISNULL(SUM(CAST(EstTokensSaved AS BIGINT)), 0) AS tokensSaved
       FROM AiUsageLog WHERE Skipped = 0 AND CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())`,
      [since],
    );
    const t = this.num(totals.recordset[0], ['calls', 'skippedCalls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'tokensSaved', 'requests', 'cacheHits', 'avgMs', 'maxMs']);
    const prefilterTokensSaved = Number(prefilter.recordset[0]?.tokensSaved ?? 0);
    const spent = t.inputTokens + t.outputTokens;
    const saved = t.tokensSaved + prefilterTokensSaved;
    const attempts = t.calls + t.skippedCalls;
    // Efficiency indicators for the super admin: how much work the AI did, how cheaply, and how often it was avoided.
    const kpis = {
      tokensPerCall: t.calls ? Math.round(spent / t.calls) : 0,
      tokensPerRequest: t.requests ? Math.round(spent / t.requests) : 0,
      costPerRequestUsd: t.requests ? t.costUsd / t.requests : 0,
      cacheHitRate: attempts ? t.cacheHits / attempts : 0,
      callsAvoidedRate: attempts ? t.skippedCalls / attempts : 0,
      savingsRate: spent + saved ? saved / (spent + saved) : 0,
      cachedTokenShare: spent + t.cacheReadTokens ? t.cacheReadTokens / (spent + t.cacheReadTokens) : 0,
      avgLatencyMs: Math.round(t.avgMs),
      maxLatencyMs: t.maxMs,
    };
    const cols = ['calls', 'tokens', 'costUsd', 'avgMs'];
    return {
      days,
      totals: t,
      kpis,
      byDay: byDay.recordset.map((r) => this.num(r, ['tokens', 'costUsd', 'tokensSaved'])),
      byOperation: byOperation.recordset.map((r) => this.num(r, cols)),
      byModel: byModel.recordset.map((r) => this.num(r, cols)),
      skippedBy: bySkip.recordset.map((r) => this.num(r, ['n', 'tokensSaved'])),
      prefilterTokensSaved,
      monthTokens: Number(await this.tokensThisMonth()),
      monthCostUsd: Number(await this.costThisMonth()),
      unlinked: this.num(unlinked.recordset[0], ['costUsd', 'calls']),
    };
  }

  /** One row per transfer request: how many tokens did processing it cost? */
  async byRequest(days: number, limit = 100) {
    const res = await this.db.query(
      `SELECT TOP (${Number(limit)})
              t.Id AS transcriptId, u.FirstName + ' ' + u.LastName AS studentName, i.Name AS institutionName,
              t.ReceivedAt AS receivedAt, t.Status AS status,
              COUNT(CASE WHEN l.Skipped = 0 THEN 1 END) AS calls,
              COUNT(CASE WHEN l.SkipReason = 'cache_hit' THEN 1 END) AS cacheHits,
              ISNULL(SUM(CAST(l.InputTokens AS BIGINT)), 0)  AS inputTokens,
              ISNULL(SUM(CAST(l.OutputTokens AS BIGINT)), 0) AS outputTokens,
              ISNULL(SUM(CAST(l.CacheReadTokens + l.CacheWriteTokens AS BIGINT)), 0) AS cacheTokens,
              ISNULL(SUM(l.EstimatedCostUsd), 0) AS costUsd,
              ISNULL(SUM(CASE WHEN l.Operation IN ('match','escalate') THEN l.EstimatedCostUsd END), 0) AS matchCostUsd,
              ISNULL(SUM(CASE WHEN l.Operation = 'read' THEN l.EstimatedCostUsd END), 0) AS readCostUsd,
              ISNULL(SUM(CASE WHEN l.Operation IN ('brief','summary') THEN l.EstimatedCostUsd END), 0) AS briefCostUsd,
              ISNULL(SUM(CAST(l.EstTokensSaved AS BIGINT)), 0) AS tokensSaved
       FROM AiUsageLog l
       JOIN Transcripts t  ON t.Id = l.TranscriptId
       JOIN Users u        ON u.Id = t.StudentUserId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE l.CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())
       GROUP BY t.Id, u.FirstName, u.LastName, i.Name, t.ReceivedAt, t.Status
       ORDER BY SUM(l.EstimatedCostUsd) DESC, SUM(CAST(l.InputTokens + l.OutputTokens + l.CacheReadTokens + l.CacheWriteTokens AS BIGINT)) DESC`,
      [{ name: 'days', type: sql.Int, value: days }],
    );
    return res.recordset.map((r) =>
      this.num(r, ['calls', 'cacheHits', 'inputTokens', 'outputTokens', 'cacheTokens', 'costUsd', 'matchCostUsd', 'readCostUsd', 'briefCostUsd', 'tokensSaved']),
    );
  }

  async forTranscript(transcriptId: string) {
    const res = await this.db.query(
      `SELECT Id AS id, Operation AS operation, Model AS model, InputTokens AS inputTokens, OutputTokens AS outputTokens,
              CacheReadTokens AS cacheReadTokens, CacheWriteTokens AS cacheWriteTokens, EstimatedCostUsd AS costUsd,
              Skipped AS skipped, SkipReason AS skipReason, EstTokensSaved AS tokensSaved,
              CatalogSize AS catalogSize, CandidatesSent AS candidatesSent, CreatedAt AS createdAt
       FROM AiUsageLog WHERE TranscriptId = @t ORDER BY Id`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const rows = res.recordset;
    const sum = (k: string) => rows.reduce((a, r) => a + Number((r as Record<string, unknown>)[k] ?? 0), 0);
    return {
      calls: rows.filter((r) => !r.skipped).length,
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      cacheTokens: sum('cacheReadTokens') + sum('cacheWriteTokens'),
      costUsd: sum('costUsd'),
      tokensSaved: sum('tokensSaved'),
      rows,
    };
  }

  async clearMatchCache(): Promise<number> {
    const res = await this.db.query(`DELETE FROM AiMatchCache`);
    return res.rowsAffected[0] ?? 0;
  }

  async cacheStats() {
    const res = await this.db.query(
      `SELECT COUNT(*) AS entries, ISNULL(SUM(HitCount), 0) AS hits FROM AiMatchCache`,
    );
    return res.recordset[0] ?? { entries: 0, hits: 0 };
  }
}
