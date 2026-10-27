import { ForbiddenException, Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { ScopeService } from '../policy/scope.service';
import { Viewer } from '../requests/requests.service';
import { BUCKET_LABEL, TransferBucket } from './exchange.logic';
import { ExchangeService } from './exchange.service';

export type Direction = 'incoming' | 'outgoing';

const BUCKETS: TransferBucket[] = ['new', 'in_review', 'approved', 'rejected'];
/** SQL for the bucket of a transfer (mirrors statusBucket() in exchange.logic.ts). */
const BUCKET_SQL = `CASE WHEN t.WorkflowStatus IN ('approved','bypassed') THEN 'approved'
                         WHEN t.WorkflowStatus = 'rejected' THEN 'rejected'
                         WHEN t.WorkflowStatus = 'active' THEN 'in_review'
                         WHEN t.Status = 'complete' THEN 'approved' ELSE 'new' END`;
const TARGET_SQL = `COALESCE(t.TargetInstitutionId, sp.TargetInstitutionId)`;
const FROM_SQL = `FROM Transcripts t
       JOIN Users u ON u.Id = t.StudentUserId
       LEFT JOIN StudentProfiles sp ON sp.UserId = t.StudentUserId`;

/**
 * Per-university view of transfers: what is going OUT (the university is the source) and what is
 * coming IN (it is the target). "University staff" = admin/faculty whose UserScopeUniversities name
 * the university; no scope rows = every university; super admins see all.
 */
@Injectable()
export class TransfersService {
  constructor(
    private db: DatabaseService,
    private scope: ScopeService,
    private exchange: ExchangeService,
  ) {}

  /** Universities this viewer may look at, and the ids the queries are limited to (null = every university). */
  private async resolveScope(viewer: Viewer, institutionId?: number) {
    const mine = await this.scope.staffUniversityScope(viewer);
    if (institutionId != null && mine && !mine.includes(institutionId)) {
      throw new ForbiddenException('You are not assigned to that university.');
    }
    const res = mine
      ? await this.db.query<{ id: number; code: string; name: string }>(
          `SELECT Id AS id, Code AS code, Name AS name FROM Institutions WHERE Id IN (${mine.map((_, i) => `@m${i}`).join(',')}) ORDER BY Name`,
          mine.map((id, i) => ({ name: `m${i}`, type: sql.Int, value: id })),
        )
      : await this.db.query<{ id: number; code: string; name: string }>(`SELECT Id AS id, Code AS code, Name AS name FROM Institutions WHERE IsActive = 1 ORDER BY Name`);
    const ids = institutionId != null ? [institutionId] : mine;
    return { ids, institutions: res.recordset, unrestricted: !mine };
  }

  /** "this direction, limited to these universities" as a WHERE fragment. */
  private pred(direction: Direction, ids: number[] | null, inputs: QueryInput[]) {
    const col = direction === 'incoming' ? TARGET_SQL : 't.InstitutionId';
    if (!ids) return direction === 'incoming' ? `${col} IS NOT NULL` : '1 = 1';
    const ph = ids.map((id, i) => {
      inputs.push({ name: `d${direction[0]}${i}`, type: sql.Int, value: id });
      return `@d${direction[0]}${i}`;
    });
    return `${col} IN (${ph.join(',')})`;
  }

  private async side(direction: Direction, ids: number[] | null, days: number) {
    const inputs: QueryInput[] = [{ name: 'days', type: sql.Int, value: days }];
    const where = this.pred(direction, ids, inputs);
    const [byStatus, byStage, trend, other, overdue, ] = await Promise.all([
      this.db.query<{ Bucket: TransferBucket; N: number }>(`SELECT ${BUCKET_SQL} AS Bucket, COUNT(*) AS N ${FROM_SQL} WHERE ${where} GROUP BY ${BUCKET_SQL}`, inputs),
      this.db.query<{ StageName: string; N: number }>(
        `SELECT ts.StageName, COUNT(*) AS N ${FROM_SQL} JOIN TranscriptStages ts ON ts.TranscriptId = t.Id AND ts.Status = 'active'
         WHERE ${where} AND t.WorkflowStatus = 'active' GROUP BY ts.StageName, ts.StageOrder ORDER BY ts.StageOrder`,
        inputs,
      ).catch(() => ({ recordset: [] as { StageName: string; N: number }[] })),
      this.db.query<{ Week: Date; N: number }>(
        `SELECT DATEADD(WEEK, DATEDIFF(WEEK, 0, t.ReceivedAt), 0) AS Week, COUNT(*) AS N ${FROM_SQL}
         WHERE ${where} AND t.ReceivedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())
         GROUP BY DATEADD(WEEK, DATEDIFF(WEEK, 0, t.ReceivedAt), 0) ORDER BY Week`,
        inputs,
      ),
      // the university on the other end of the transfer
      this.db.query<{ Name: string; N: number }>(
        direction === 'incoming'
          ? `SELECT TOP 5 si.Name, COUNT(*) AS N ${FROM_SQL} JOIN Institutions si ON si.Id = t.InstitutionId WHERE ${where} GROUP BY si.Name ORDER BY COUNT(*) DESC`
          : `SELECT TOP 5 ti.Name, COUNT(*) AS N ${FROM_SQL} JOIN Institutions ti ON ti.Id = ${TARGET_SQL} WHERE ${where} GROUP BY ti.Name ORDER BY COUNT(*) DESC`,
        inputs,
      ),
      this.db.query<{ N: number }>(
        `SELECT COUNT(*) AS N ${FROM_SQL} JOIN TranscriptStages ts ON ts.TranscriptId = t.Id AND ts.Status = 'active' AND ts.DueAt < SYSUTCDATETIME()
         WHERE ${where} AND t.WorkflowStatus = 'active'`,
        inputs,
      ).catch(() => ({ recordset: [{ N: 0 }] })),
    ]);
    const counts: Record<TransferBucket, number> = { new: 0, in_review: 0, approved: 0, rejected: 0 };
    for (const r of byStatus.recordset) counts[r.Bucket] = r.N;
    const total = BUCKETS.reduce((n, b) => n + counts[b], 0);
    const inWindow = trend.recordset.reduce((n, r) => n + r.N, 0);
    return {
      total,
      open: counts.new + counts.in_review,
      byStatus: BUCKETS.map((b) => ({ key: b, label: BUCKET_LABEL[b], count: counts[b] })),
      byStage: byStage.recordset.map((r) => ({ stage: r.StageName, count: r.N })),
      trend: trend.recordset.map((r) => ({ week: r.Week, count: r.N })),
      inWindow,
      overdue: overdue.recordset[0]?.N ?? 0,
      counterparts: other.recordset.map((r) => ({ name: r.Name, count: r.N })),
    };
  }

  /** Counts, stage breakdown and trend for both directions, plus the document requests waiting on / sent by the university. */
  async summary(viewer: Viewer, opts: { institutionId?: number; days?: number }) {
    await this.exchange.assertStaffCan(viewer, 'view');
    const days = [30, 90, 180, 365].includes(opts.days ?? 0) ? (opts.days as number) : 90;
    const { ids, institutions, unrestricted } = await this.resolveScope(viewer, opts.institutionId);
    const [incoming, outgoing] = await Promise.all([this.side('incoming', ids, days), this.side('outgoing', ids, days)]);
    let docs = { waiting: 0, asked: 0 };
    if (await this.exchange.ready()) {
      const inputs: QueryInput[] = [];
      const inList = (col: string, prefix: string) =>
        ids ? `${col} IN (${ids.map((id, i) => (inputs.push({ name: `${prefix}${i}`, type: sql.Int, value: id }), `@${prefix}${i}`)).join(',')})` : `${col} IS NOT NULL`;
      const r = await this.db.query<{ Waiting: number; Asked: number }>(
        `SELECT SUM(CASE WHEN ${inList('RequestedFromInstitutionId', 'w')} THEN 1 ELSE 0 END) AS Waiting,
                SUM(CASE WHEN ${inList('RequestedByInstitutionId', 'a')} THEN 1 ELSE 0 END) AS Asked
         FROM DocumentRequests WHERE Status = 'open'`,
        inputs,
      );
      docs = { waiting: r.recordset[0]?.Waiting ?? 0, asked: r.recordset[0]?.Asked ?? 0 };
    }
    return {
      days,
      scope: { institutions, selectedId: opts.institutionId ?? null, unrestricted, exchangeReady: await this.exchange.ready() },
      incoming,
      outgoing,
      documentRequests: docs,
    };
  }

  /** Paged list for one direction. */
  async list(viewer: Viewer, opts: { direction: Direction; institutionId?: number; bucket?: string; q?: string; page?: number; pageSize?: number }) {
    await this.exchange.assertStaffCan(viewer, 'view');
    const { ids } = await this.resolveScope(viewer, opts.institutionId);
    const inputs: QueryInput[] = [];
    let where = this.pred(opts.direction, ids, inputs);
    if (opts.bucket && (BUCKETS as string[]).includes(opts.bucket)) {
      where += ` AND ${BUCKET_SQL} = @bucket`;
      inputs.push({ name: 'bucket', type: sql.VarChar(12), value: opts.bucket });
    }
    if (opts.q?.trim()) {
      where += ` AND (u.FirstName + ' ' + u.LastName LIKE @q OR u.Email LIKE @q OR si.Name LIKE @q OR ti.Name LIKE @q)`;
      inputs.push({ name: 'q', type: sql.NVarChar(100), value: `%${opts.q.trim().slice(0, 80)}%` });
    }
    const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
    const page = Math.max(opts.page ?? 1, 1);
    inputs.push({ name: 'off', type: sql.Int, value: (page - 1) * pageSize }, { name: 'lim', type: sql.Int, value: pageSize });
    const exReady = await this.exchange.ready();
    const join = `${FROM_SQL} JOIN Institutions si ON si.Id = t.InstitutionId LEFT JOIN Institutions ti ON ti.Id = ${TARGET_SQL}`;
    const [rows, total] = await Promise.all([
      this.db.query(
        `SELECT t.Id AS id, u.FirstName + ' ' + u.LastName AS studentName, si.Id AS sourceId, si.Name AS sourceName, ti.Id AS targetId, ti.Name AS targetName,
                ${BUCKET_SQL} AS bucket, t.ReceivedAt AS receivedAt,
                (SELECT TOP 1 ts.StageName FROM TranscriptStages ts WHERE ts.TranscriptId = t.Id AND ts.Status = 'active' ORDER BY ts.StageOrder) AS stageName,
                (SELECT COUNT(*) FROM TranscriptCourses tc WHERE tc.TranscriptId = t.Id) AS courseCount
                ${exReady ? `, (SELECT COUNT(*) FROM DocumentRequests d WHERE d.TranscriptId = t.Id AND d.Status = 'open') AS openDocRequests,
                (SELECT COUNT(*) FROM Uploads up WHERE up.TranscriptId = t.Id) AS exchangeFiles` : `, 0 AS openDocRequests, 0 AS exchangeFiles`}
         ${join} WHERE ${where} ORDER BY t.ReceivedAt DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`,
        inputs,
      ),
      this.db.query<{ N: number }>(`SELECT COUNT(*) AS N ${join} WHERE ${where}`, inputs),
    ]);
    return {
      direction: opts.direction,
      page,
      pageSize,
      total: total.recordset[0]?.N ?? 0,
      rows: rows.recordset.map((r) => ({ ...r, bucketLabel: BUCKET_LABEL[r.bucket as TransferBucket] })),
    };
  }
}
