import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { ScopeService, ScopeViewer } from '../policy/scope.service';
import {
  aggregate, fillMonths, isEffective, networkBoost, normCode, normTitle, NetRow, NetworkAggregate, NetworkSupport, toSupport, topAgreed,
} from './network.logic';

export const NETWORK_BOOST_KEY = 'ai.network_boost';

export interface CourseQuery {
  institutionId?: number;
  code?: string;
  title?: string;
  targetInstitutionId?: number;
  candidateIds?: number[];
  /** Resolves institutionId / code / title / target from the request's course instead (staff must be able to work the request). */
  evaluationId?: string;
}

type DbRow = Omit<NetRow, 'isActive'> & { isActive: boolean | number; extTitle?: string };

@Injectable()
export class NetworkService {
  private readonly logger = new Logger(NetworkService.name);
  private boostCache: { at: number; value: boolean } | null = null;

  constructor(private db: DatabaseService, private schema: SchemaService, private scope: ScopeService) {}

  // ---- settings -----------------------------------------------------------------------------------------------------

  /** Switch for the confidence boost (AppSettings `ai.network_boost`, default OFF; also OFF when AppSettings does not exist yet). */
  async isBoostEnabled(): Promise<boolean> {
    if (this.boostCache && Date.now() - this.boostCache.at < 15_000) return this.boostCache.value;
    let value = false;
    try {
      if (await this.schema.has('AppSettings')) {
        const r = await this.db.query<{ SettingValue: string | null }>(`SELECT SettingValue FROM AppSettings WHERE SettingKey = @k`, [
          { name: 'k', type: sql.VarChar(100), value: NETWORK_BOOST_KEY },
        ]);
        value = ['1', 'true', 'on'].includes(String(r.recordset[0]?.SettingValue ?? '').toLowerCase());
      }
    } catch {
      value = false;
    }
    this.boostCache = { at: Date.now(), value };
    return value;
  }

  async getSettings() {
    return { boostEnabled: await this.isBoostEnabled(), ready: await this.schema.has('AppSettings'), key: NETWORK_BOOST_KEY };
  }

  async setBoost(enabled: boolean, by: { id: string; email: string; role: string }, ip?: string) {
    if (!(await this.schema.has('AppSettings'))) {
      throw new ServiceUnavailableException('Migration 023 (AppSettings) has not been applied yet.');
    }
    const before = await this.isBoostEnabled();
    await this.db.query(
      `MERGE AppSettings AS t
       USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
       WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @by
       WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@k, @v, @by);`,
      [
        { name: 'k', type: sql.VarChar(100), value: NETWORK_BOOST_KEY },
        { name: 'v', type: sql.NVarChar(1000), value: enabled ? '1' : '0' },
        { name: 'by', type: sql.NVarChar(254), value: by.email },
      ],
    );
    this.boostCache = null;
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, OldValue, NewValue, IpAddress)
         VALUES (@uid, @email, @role, 'NETWORK_BOOST_CHANGED', 'AppSettings', 'ai.network_boost', @old, @new, @ip)`,
        [
          { name: 'uid', type: sql.UniqueIdentifier, value: by.id },
          { name: 'email', type: sql.NVarChar(254), value: by.email },
          { name: 'role', type: sql.VarChar(20), value: by.role },
          { name: 'old', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ enabled: before }) },
          { name: 'new', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ enabled }) },
          { name: 'ip', type: sql.VarChar(64), value: ip ?? null },
        ],
      );
    } catch (e) {
      this.logger.warn(`Audit write failed: ${(e as Error).message}`);
    }
    return this.getSettings();
  }

  // ---- loading ------------------------------------------------------------------------------------------------------

  private async rowsFor(extIds: number[]): Promise<NetRow[]> {
    if (!extIds.length) return [];
    const dates = await this.schema.has('Equivalencies', 'EffectiveFrom');
    const inputs: QueryInput[] = extIds.map((v, i) => ({ name: `e${i}`, type: sql.Int, value: v }));
    const r = await this.db.query<DbRow>(
      `SELECT eq.ExternalCourseId AS extId, ext.InstitutionId AS extInstId, bu.InstitutionId AS recvInstId, ri.Name AS recvInstName,
              eq.BUCourseId AS buCourseId, bu.Code AS buCode, bu.Title AS buTitle, bu.Credits AS buCredits,
              eq.Outcome AS outcome, eq.BUCredits AS awarded, eq.DecidedAt AS decidedAt, eq.CreatedAt AS createdAt,
              ${dates ? 'eq.EffectiveFrom' : 'CAST(NULL AS DATE)'} AS effectiveFrom, ${dates ? 'eq.EffectiveTo' : 'CAST(NULL AS DATE)'} AS effectiveTo,
              eq.IsActive AS isActive
       FROM Equivalencies eq
       JOIN Courses ext ON ext.Id = eq.ExternalCourseId
       JOIN Courses bu ON bu.Id = eq.BUCourseId
       JOIN Institutions ri ON ri.Id = bu.InstitutionId
       WHERE eq.IsActive = 1 AND eq.ExternalCourseId IN (${extIds.map((_, i) => `@e${i}`).join(',')})`,
      inputs,
    );
    return r.recordset.map((x) => ({ ...x, isActive: !!x.isActive, buCredits: x.buCredits == null ? null : Number(x.buCredits), awarded: x.awarded == null ? null : Number(x.awarded) }));
  }

  /** Resolves the external course: exact (institution + code) first, then same-normalised-title courses at any university. */
  private async resolveExternal(q: { institutionId?: number; code?: string; title?: string }): Promise<{ ids: number[]; exactId: number | null; code: string | null; title: string | null }> {
    let exact: { Id: number; Code: string; Title: string } | null = null;
    if (q.institutionId && q.code) {
      // Codes compare ignoring spaces/punctuation/case ("CS 2000" == "cs2000").
      const all = await this.db.query<{ Id: number; Code: string; Title: string }>(
        `SELECT Id, Code, Title FROM Courses WHERE InstitutionId = @i AND REPLACE(REPLACE(REPLACE(LOWER(Code), ' ', ''), '-', ''), '.', '') = @c`,
        [{ name: 'i', type: sql.Int, value: q.institutionId }, { name: 'c', type: sql.NVarChar(50), value: normCode(q.code) }],
      );
      exact = all.recordset[0] ?? null;
    }
    const title = q.title?.trim() || exact?.Title || '';
    const key = normTitle(title);
    const ids = new Set<number>(exact ? [exact.Id] : []);
    const token = key.split(' ').filter((t) => t.length >= 4).sort((a, b) => b.length - a.length)[0];
    if (key && token) {
      const like = await this.db.query<{ Id: number; Title: string }>(
        `SELECT TOP 500 Id, Title FROM Courses WHERE Title LIKE @like`,
        [{ name: 'like', type: sql.NVarChar(120), value: `%${token.replace(/[%_[\]]/g, '')}%` }],
      );
      for (const c of like.recordset) if (normTitle(c.Title) === key) ids.add(c.Id);
    }
    return { ids: [...ids], exactId: exact?.Id ?? null, code: exact?.Code ?? q.code ?? null, title: title || null };
  }

  /** Which university ids the viewer may see BY NAME: the request's target (if within their scope) plus, for scoped admins, their own scope. */
  private async ownIds(viewer: ScopeViewer, target?: number): Promise<number[]> {
    const scoped = await this.scope.universityScope(viewer).catch(() => null);
    const own = new Set<number>(scoped ?? []);
    if (target && (scoped === null || scoped.includes(target))) own.add(target);
    return [...own];
  }

  // ---- endpoints ----------------------------------------------------------------------------------------------------

  private async fromEvaluation(evaluationId: string, viewer: ScopeViewer): Promise<Partial<CourseQuery>> {
    const hasTarget = await this.schema.has('Transcripts', 'TargetInstitutionId');
    const r = await this.db.query<{ TranscriptId: string; Ext: number; Target: number | null; Code: string; Title: string }>(
      `SELECT t.Id AS TranscriptId, t.InstitutionId AS Ext, ${hasTarget ? `ISNULL(t.TargetInstitutionId, (SELECT TOP 1 Id FROM Institutions WHERE Code = 'BU'))` : `(SELECT TOP 1 Id FROM Institutions WHERE Code = 'BU')`} AS Target,
              tc.CourseCode AS Code, tc.CourseTitle AS Title
       FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId JOIN Transcripts t ON t.Id = tc.TranscriptId
       WHERE e.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: evaluationId }],
    );
    const row = r.recordset[0];
    if (!row) throw new NotFoundException('Evaluation not found');
    if (!(await this.scope.canWorkRequest(viewer, row.TranscriptId))) throw new ForbiddenException('You cannot work on this request.');
    return { institutionId: row.Ext, code: row.Code, title: row.Title, targetInstitutionId: row.Target ?? undefined };
  }

  async forCourse(input: CourseQuery, viewer: ScopeViewer) {
    const q: CourseQuery = input.evaluationId ? { ...input, ...(await this.fromEvaluation(input.evaluationId, viewer)) } : input;
    const ext = await this.resolveExternal(q);
    const own = await this.ownIds(viewer, q.targetInstitutionId);
    const rows = await this.rowsFor(ext.ids);
    const agg = aggregate(rows, { ownInstitutionIds: own });

    // Per-candidate support so the UI can offer "Use this match" without ever seeing another university's course.
    const support = toSupport(agg);
    const candidateSupport: Record<string, { universities: number; boost: number }> = {};
    if (q.candidateIds?.length) {
      const ids = q.candidateIds.slice(0, 20);
      const r = await this.db.query<{ Id: number; Title: string }>(
        `SELECT Id, Title FROM Courses WHERE Id IN (${ids.map((_, i) => `@c${i}`).join(',')})`,
        ids.map((v, i) => ({ name: `c${i}`, type: sql.Int, value: v })),
      );
      for (const c of r.recordset) {
        const b = networkBoost(c.Title, support);
        if (b.universities) candidateSupport[String(c.Id)] = { universities: b.universities, boost: b.boost };
      }
    }
    return {
      course: { resolved: ext.ids.length > 0, code: ext.code, title: ext.title, matchBasis: ext.exactId ? (ext.ids.length > 1 ? 'exact+title' : 'exact') : ext.ids.length ? 'title' : 'none' },
      ...agg,
      candidateSupport,
      boostEnabled: await this.isBoostEnabled(),
    };
  }

  /**
   * For the matcher: counts-only support for an external course as seen by universities OTHER than the one receiving the request.
   * Never throws (the network is an optional extra); null when there is nothing to say.
   */
  async supportFor(ext: { institutionId?: number | null; code: string; title: string }, targetInstitutionId: number | null): Promise<NetworkSupport | null> {
    try {
      const res = await this.resolveExternal({ institutionId: ext.institutionId ?? undefined, code: ext.code, title: ext.title });
      if (!res.ids.length) return null;
      const rows = await this.rowsFor(res.ids);
      const agg: NetworkAggregate = aggregate(rows, { ownInstitutionIds: targetInstitutionId ? [targetInstitutionId] : [] });
      return agg.acceptedAsEquivalent ? toSupport(agg) : null;
    } catch (e) {
      this.logger.warn(`Network lookup failed: ${(e as Error).message}`);
      return null;
    }
  }

  async summary() {
    const asOf = new Date();
    const dates = await this.schema.has('Equivalencies', 'EffectiveFrom');
    const rowsRes = await this.db.query<DbRow>(
      `SELECT TOP 50000 eq.ExternalCourseId AS extId, ext.InstitutionId AS extInstId, ext.Title AS extTitle, bu.InstitutionId AS recvInstId, '' AS recvInstName,
              eq.BUCourseId AS buCourseId, bu.Code AS buCode, bu.Title AS buTitle, bu.Credits AS buCredits,
              eq.Outcome AS outcome, eq.BUCredits AS awarded, eq.DecidedAt AS decidedAt, eq.CreatedAt AS createdAt,
              ${dates ? 'eq.EffectiveFrom' : 'CAST(NULL AS DATE)'} AS effectiveFrom, ${dates ? 'eq.EffectiveTo' : 'CAST(NULL AS DATE)'} AS effectiveTo,
              eq.IsActive AS isActive
       FROM Equivalencies eq
       JOIN Courses ext ON ext.Id = eq.ExternalCourseId
       JOIN Courses bu ON bu.Id = eq.BUCourseId
       WHERE eq.IsActive = 1`,
    );
    const rows = rowsRes.recordset.map((x) => ({ ...x, isActive: !!x.isActive, buCredits: x.buCredits == null ? null : Number(x.buCredits), awarded: x.awarded == null ? null : Number(x.awarded), extTitle: x.extTitle ?? '' })) as (NetRow & { extTitle: string })[];
    const live = rows.filter((r) => isEffective(r, asOf));

    const growth = await this.db
      .query<{ M: string; N: number }>(
        `SELECT CONVERT(CHAR(7), CreatedAt, 126) AS M, COUNT(*) AS N FROM Equivalencies
         WHERE CreatedAt >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1)) GROUP BY CONVERT(CHAR(7), CreatedAt, 126)`,
      )
      .then((r) => r.recordset.map((x) => ({ month: x.M, count: x.N })))
      .catch(() => []);
    const cov = await this.db
      .query<{ Total: number; Mapped: number }>(
        `SELECT COUNT(*) AS Total, SUM(CASE WHEN EXISTS (SELECT 1 FROM Equivalencies q WHERE q.ExternalCourseId = c.Id AND q.IsActive = 1) THEN 1 ELSE 0 END) AS Mapped
         FROM Courses c JOIN Institutions i ON i.Id = c.InstitutionId
         WHERE c.IsActive = 1 AND i.IsBU = 0 AND i.IsActive = 1
           AND NOT EXISTS (SELECT 1 FROM Equivalencies e2 JOIN Courses b2 ON b2.Id = e2.BUCourseId WHERE b2.InstitutionId = i.Id)`,
      )
      .then((r) => r.recordset[0])
      .catch(() => ({ Total: 0, Mapped: 0 }));
    const total = Number(cov?.Total ?? 0);
    const mapped = Number(cov?.Mapped ?? 0);
    return {
      totalPairs: live.length,
      contributingUniversities: new Set(live.map((r) => r.recvInstId)).size,
      externalCourses: total,
      mappedExternalCourses: mapped,
      coveragePct: total ? Math.round((mapped / total) * 1000) / 10 : 0,
      topAgreed: topAgreed(rows, asOf),
      growth: fillMonths(growth, 12),
      boostEnabled: await this.isBoostEnabled(),
    };
  }
}
