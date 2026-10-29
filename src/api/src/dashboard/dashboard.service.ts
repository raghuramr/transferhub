import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { ScopeService } from '../policy/scope.service';
import { SchemaService } from '../policy/schema.service';
import { AiUsageService } from '../ai/ai-usage.service';

export interface Kpi {
  key: string;
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
  /** 0-100: draws a small meter on the tile (e.g. completion rate). */
  gauge?: number;
  /** How the UI formats the number. `value` may still be a preformatted string for older clients; `num` then carries the raw number. */
  unit?: 'count' | 'usd' | 'pct' | 'days' | 'ms';
  num?: number;
  /** Up to 12 equal buckets across the selected period (oldest first) - drawn as a sparkline. */
  spark?: number[];
  /** Relative change vs the previous period of the same length (0.12 = +12%); null when there is no baseline. */
  delta?: number | null;
  /** What the delta compares, when it is not the headline value itself (e.g. "new sign-ups"). */
  deltaLabel?: string;
  /** Which direction is good for this number, so the UI colours the delta correctly. */
  good?: 'up' | 'down';
}

export interface Chart {
  key: string;
  title: string;
  subtitle?: string;
  type: 'bar' | 'hbar' | 'pie' | 'area' | 'line' | 'stacked';
  /** Rows of { name, <seriesKey>... }; single-series charts use { name, value }. */
  data: Record<string, string | number>[];
  series?: { key: string; label: string }[];
}

type Viewer = { id: string; role: string };
type Row = Record<string, string | number | null>;

const RANGES = [30, 90, 180, 365];
const BUCKETS = 12;

/** Relative change; null when the previous period had nothing to compare with. */
export function relDelta(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return (cur - prev) / prev;
}

/**
 * Folds rows keyed by "days ago" (`ago`, 0 = today) into BUCKETS equal buckets over the current
 * period (oldest first) plus a total for the previous period of the same length. Values go through
 * Number() because SQL Server returns BIGINT sums as strings.
 */
export function bucketize(rows: Row[], days: number, keys: string[], n = BUCKETS) {
  const cur: Record<string, number[]> = {};
  const prev: Record<string, number> = {};
  for (const k of keys) {
    cur[k] = new Array<number>(n).fill(0);
    prev[k] = 0;
  }
  for (const r of rows) {
    const ago = Number(r.ago);
    if (!Number.isFinite(ago) || ago < 0) continue;
    for (const k of keys) {
      const v = Number(r[k] ?? 0) || 0;
      if (ago < days) cur[k][n - 1 - Math.min(n - 1, Math.floor((ago * n) / days))] += v;
      else if (ago < days * 2) prev[k] += v;
    }
  }
  const total = (k: string) => cur[k].reduce((a, b) => a + b, 0);
  return { cur, prev, total };
}

/**
 * Role-aware dashboard payloads. The API decides which KPIs and charts a role
 * gets (and scopes them: students see their own data, admins see their
 * universities, super admins see everything); the UI just renders the payload.
 * Every widget is isolated: if one query fails (e.g. a migration is missing)
 * the rest of the dashboard still loads.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private db: DatabaseService,
    private scope: ScopeService,
    private schema: SchemaService,
    private aiUsage: AiUsageService,
  ) {}

  private async rows(query: string, inputs: QueryInput[] = []): Promise<Row[]> {
    const res = await this.db.query<Row>(query, inputs);
    return res.recordset;
  }

  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`Dashboard widget "${label}" failed: ${(e as Error).message}`);
      return fallback;
    }
  }

  private pairs(rows: Row[], nameKey = 'name', valueKey = 'value') {
    return rows.map((r) => ({ name: String(r[nameKey] ?? 'Unknown'), value: Number(r[valueKey] ?? 0) }));
  }

  private nice(s: string) {
    return s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  async build(viewer: Viewer, requestedDays?: number) {
    const days = RANGES.includes(requestedDays ?? 0) ? (requestedDays as number) : 180;
    const out =
      viewer.role === 'student'
        ? await this.student(viewer, days)
        : viewer.role === 'faculty'
          ? await this.faculty(viewer, days)
          : viewer.role === 'admin' || viewer.role === 'super_admin'
            ? await this.staff(viewer, days)
            : { kpis: [], charts: [] };
    return { role: viewer.role, days, ranges: RANGES, generatedAt: new Date().toISOString(), ...out };
  }

  // ── student ──────────────────────────────────────────────────────

  private async student(viewer: Viewer, days: number) {
    const me: QueryInput = { name: 'me', type: sql.UniqueIdentifier, value: viewer.id };
    const since: QueryInput = { name: 'days', type: sql.Int, value: days };
    const T = `FROM Transcripts t WHERE t.StudentUserId = @me`;

    const counts = await this.safe('student counts', async () => {
      const r = await this.rows(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN t.Status NOT IN ('complete','cancelled') THEN 1 ELSE 0 END) AS inProgress,
                SUM(CASE WHEN t.Status = 'complete' THEN 1 ELSE 0 END) AS completed
         ${T}`,
        [me],
      );
      return r[0] ?? {};
    }, {} as Row);
    const courseStats = await this.safe('student courses', async () => {
      const r = await this.rows(
        `SELECT COUNT(*) AS courses,
                SUM(CASE WHEN tc.Status IN ('decided','posted') THEN 1 ELSE 0 END) AS decided,
                COALESCE(SUM(CASE WHEN e.Outcome IN ('equivalent','elective') THEN e.AwardedCredits END), 0) AS awarded,
                COALESCE(SUM(tc.OriginalCredits), 0) AS requested
         FROM TranscriptCourses tc
         JOIN Transcripts t ON t.Id = tc.TranscriptId AND t.StudentUserId = @me
         LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id`,
        [me],
      );
      return r[0] ?? {};
    }, {} as Row);

    const kpis: Kpi[] = [
      { key: 'requests', label: 'Evaluations submitted', value: Number(counts.total ?? 0) },
      { key: 'inprogress', label: 'In progress', value: Number(counts.inProgress ?? 0), tone: 'warn' },
      { key: 'completed', label: 'Completed', value: Number(counts.completed ?? 0), tone: 'good', gauge: Number(counts.total ?? 0) ? Math.round((Number(counts.completed ?? 0) / Number(counts.total)) * 100) : 0 },
      { key: 'courses', label: 'Courses submitted', value: Number(courseStats.courses ?? 0) },
      { key: 'decided', label: 'Courses decided', value: Number(courseStats.decided ?? 0), tone: 'good', gauge: Number(courseStats.courses ?? 0) ? Math.round((Number(courseStats.decided ?? 0) / Number(courseStats.courses)) * 100) : 0 },
      { key: 'awarded', label: 'Credits awarded', value: Number(courseStats.awarded ?? 0), hint: `of ${Number(courseStats.requested ?? 0)} submitted`, tone: 'good' },
    ];

    const charts: Chart[] = [];
    const lanes = await this.safe('student lanes', () =>
      this.rows(`SELECT tc.Lane AS name, COUNT(*) AS value FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId AND t.StudentUserId = @me GROUP BY tc.Lane`, [me]), []);
    if (lanes.length) charts.push({ key: 'lanes', title: 'Where your courses stand', subtitle: 'Courses by evaluation lane', type: 'pie', data: this.pairs(lanes).map((p) => ({ ...p, name: this.nice(p.name) })) });

    const outcomes = await this.safe('student outcomes', () =>
      this.rows(`SELECT e.Outcome AS name, COUNT(*) AS value FROM Evaluations e
                 JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
                 JOIN Transcripts t ON t.Id = tc.TranscriptId AND t.StudentUserId = @me
                 WHERE e.Outcome IS NOT NULL GROUP BY e.Outcome`, [me]), []);
    if (outcomes.length) charts.push({ key: 'outcomes', title: 'Decisions so far', subtitle: 'Outcome of each decided course', type: 'pie', data: this.pairs(outcomes).map((p) => ({ ...p, name: this.nice(p.name) })) });

    const perTranscript = await this.safe('student per transcript', () =>
      this.rows(`SELECT TOP 8 CONVERT(VARCHAR(10), t.ReceivedAt, 23) AS name,
                        COALESCE(SUM(tc.OriginalCredits), 0) AS submitted,
                        COALESCE(SUM(CASE WHEN e.Outcome IN ('equivalent','elective') THEN e.AwardedCredits END), 0) AS awarded
                 FROM Transcripts t
                 JOIN TranscriptCourses tc ON tc.TranscriptId = t.Id
                 LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
                 WHERE t.StudentUserId = @me
                 GROUP BY t.Id, t.ReceivedAt ORDER BY t.ReceivedAt DESC`, [me]), []);
    if (perTranscript.length) {
      charts.push({
        key: 'credits', title: 'Credits submitted vs awarded', subtitle: 'Per transcript (latest 8)', type: 'bar',
        series: [{ key: 'submitted', label: 'Submitted' }, { key: 'awarded', label: 'Awarded' }],
        data: perTranscript.map((r) => ({ name: String(r.name), submitted: Number(r.submitted), awarded: Number(r.awarded) })),
      });
    }

    const gradeSpread = await this.safe('student grades', () =>
      this.rows(`SELECT tc.Grade AS name, COUNT(*) AS value FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId AND t.StudentUserId = @me GROUP BY tc.Grade ORDER BY tc.Grade`, [me]), []);
    if (gradeSpread.length > 1) charts.push({ key: 'grades', title: 'Your grades', subtitle: 'Courses by grade', type: 'bar', data: this.pairs(gradeSpread) });

    void since;
    return { kpis, charts };
  }

  // ── faculty ──────────────────────────────────────────────────────

  private async faculty(viewer: Viewer, days: number) {
    const me: QueryInput = { name: 'me', type: sql.UniqueIdentifier, value: viewer.id };
    const d: QueryInput = { name: 'days', type: sql.Int, value: days };

    const stageIds = await this.safe('faculty stages', async () => {
      const r = await this.rows(
        `SELECT s.Id AS id FROM WorkflowStages s WHERE
           EXISTS (SELECT 1 FROM WorkflowStageApprovers a WHERE a.StageId = s.Id AND a.ApproverType = 'role' AND a.RoleName = 'faculty')
           OR EXISTS (SELECT 1 FROM WorkflowStageApprovers a JOIN ApproverGroupMembers m ON m.GroupId = a.GroupId
                      JOIN ApproverGroups g ON g.Id = a.GroupId AND g.IsActive = 1
                      WHERE a.StageId = s.Id AND a.ApproverType = 'group' AND m.UserId = @me)
           OR EXISTS (SELECT 1 FROM WorkflowStageApprovers a WHERE a.StageId = s.Id AND a.ApproverType = 'user' AND a.UserId = @me)`,
        [me],
      );
      return r.map((x) => Number(x.id));
    }, [] as number[]);

    const stageInputs: QueryInput[] = [];
    const stageList = stageIds.length
      ? stageIds.map((id, i) => { stageInputs.push({ name: `st${i}`, type: sql.Int, value: id }); return `@st${i}`; }).join(',')
      : 'NULL';
    // A faculty member assigned to universities only counts work for those universities: stage
    // membership and university scope narrow together. No scope rows = every university.
    const facultyScope = await this.scope.universityScope(viewer).catch(() => null);
    const stageScopeSql = facultyScope ? ` AND ${this.scope.transcriptInScope(facultyScope, 't', stageInputs)}` : '';

    const waiting = await this.safe('faculty waiting', async () => {
      const r = await this.rows(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN ts.DueAt < SYSUTCDATETIME() THEN 1 ELSE 0 END) AS overdue
         FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
         WHERE ts.Status = 'active' AND ts.StageType <> 'system' AND t.WorkflowStatus = 'active' AND ts.WorkflowStageId IN (${stageList})${stageScopeSql}`,
        stageInputs,
      );
      return r[0] ?? {};
    }, {} as Row);
    const mine = await this.safe('faculty evals', async () => {
      const r = await this.rows(
        `SELECT SUM(CASE WHEN e.Status IN ('queued','in_progress') THEN 1 ELSE 0 END) AS queued,
                SUM(CASE WHEN e.DecidedBy = @me AND e.DecidedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS decided
         FROM Evaluations e WHERE e.AssignedToUserId = @me OR e.DecidedBy = @me`,
        [me, d],
      );
      return r[0] ?? {};
    }, {} as Row);
    const open = await this.safe('faculty verification', async () => {
      if (!(await this.schema.has('CourseVerificationRequests'))) return 0;
      const r = await this.rows(`SELECT COUNT(*) AS n FROM CourseVerificationRequests WHERE RaisedBy = @me AND Status = 'open'`, [me]);
      return Number(r[0]?.n ?? 0);
    }, 0);
    const appeals = await this.safe('faculty appeals', async () => {
      const inputs: QueryInput[] = [];
      const sc = facultyScope
        ? ` AND EXISTS (SELECT 1 FROM Transcripts t WHERE t.Id = a.TranscriptId AND ${this.scope.transcriptVisibleInScope(facultyScope, 't', inputs)})`
        : '';
      const r = await this.rows(`SELECT COUNT(*) AS n FROM CourseAppeals a WHERE a.Status = 'submitted'${sc}`, inputs);
      return Number(r[0]?.n ?? 0);
    }, 0);

    const kpis: Kpi[] = [
      { key: 'waiting', label: 'Approvals waiting on you', value: Number(waiting.total ?? 0), tone: 'warn' },
      { key: 'overdue', label: 'Overdue', value: Number(waiting.overdue ?? 0), tone: Number(waiting.overdue ?? 0) > 0 ? 'bad' : 'good', gauge: Number(waiting.total ?? 0) ? Math.round(((Number(waiting.total) - Number(waiting.overdue ?? 0)) / Number(waiting.total)) * 100) : 100, hint: 'ring = on time' },
      { key: 'queued', label: 'Evaluations assigned to you', value: Number(mine.queued ?? 0) },
      { key: 'decided', label: `Decided (last ${days} days)`, value: Number(mine.decided ?? 0), tone: 'good' },
      { key: 'appeals', label: 'Appeals awaiting a decision', value: appeals },
      { key: 'verify', label: 'Your open verification requests', value: open },
    ];

    const charts: Chart[] = [];
    const outcomes = await this.safe('faculty outcomes', () =>
      this.rows(`SELECT e.Outcome AS name, COUNT(*) AS value FROM Evaluations e
                 WHERE e.DecidedBy = @me AND e.Outcome IS NOT NULL AND e.DecidedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME()) GROUP BY e.Outcome`, [me, d]), []);
    if (outcomes.length) charts.push({ key: 'outcomes', title: 'Your decisions by outcome', type: 'pie', data: this.pairs(outcomes).map((p) => ({ ...p, name: this.nice(p.name) })) });

    const perWeek = await this.safe('faculty weekly', () =>
      this.rows(`SELECT CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, 0, e.DecidedAt) % 7), CAST(e.DecidedAt AS DATE)), 23) AS name, COUNT(*) AS value
                 FROM Evaluations e WHERE e.DecidedBy = @me AND e.DecidedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())
                 GROUP BY DATEADD(DAY, -(DATEDIFF(DAY, 0, e.DecidedAt) % 7), CAST(e.DecidedAt AS DATE)) ORDER BY 1`, [me, d]), []);
    if (perWeek.length) charts.push({ key: 'weekly', title: 'Decisions per week', type: 'bar', data: this.pairs(perWeek) });

    const backlog = await this.safe('faculty backlog', () =>
      this.rows(`SELECT ts.StageName AS name, COUNT(*) AS value FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
                 WHERE ts.Status = 'active' AND ts.StageType <> 'system' AND t.WorkflowStatus = 'active' AND ts.WorkflowStageId IN (${stageList})${stageScopeSql}
                 GROUP BY ts.StageName`, stageInputs), []);
    if (backlog.length) charts.push({ key: 'backlog', title: 'Approvals waiting, by stage', type: 'hbar', data: this.pairs(backlog) });

    const queueStatus = await this.safe('faculty queue', () =>
      this.rows(`SELECT e.Status AS name, COUNT(*) AS value FROM Evaluations e WHERE e.AssignedToUserId = @me GROUP BY e.Status`, [me]), []);
    if (queueStatus.length) charts.push({ key: 'queue', title: 'Your evaluations by status', type: 'bar', data: this.pairs(queueStatus).map((p) => ({ ...p, name: this.nice(p.name) })) });

    return { kpis, charts };
  }

  // ── admin (scoped to their universities) + super admin (everything) ──

  private async staff(viewer: Viewer, days: number) {
    const adminScope = await this.scope.universityScope(viewer);
    const d: QueryInput = { name: 'days', type: sql.Int, value: days };

    // Scope fragments are rebuilt per query because parameter names must stay unique within one statement.
    const tScope = (inputs: QueryInput[], alias = 't') => (adminScope ? ` AND ${this.scope.transcriptInScope(adminScope, alias, inputs)}` : '');
    const uScope = (inputs: QueryInput[], alias = 'u') => (adminScope ? ` AND ${this.scope.studentInScope(adminScope, alias, inputs)}` : '');
    const since = `t.ReceivedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())`;
    const isSuper = viewer.role === 'super_admin';

    const tCounts = await this.safe('staff transcript counts', async () => {
      const inputs: QueryInput[] = [d];
      const r = await this.rows(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN t.Status NOT IN ('complete','cancelled') THEN 1 ELSE 0 END) AS inProgress,
                SUM(CASE WHEN t.Status = 'complete' THEN 1 ELSE 0 END) AS completed,
                AVG(CASE WHEN t.Status = 'complete' AND t.ProcessedAt IS NOT NULL THEN DATEDIFF(HOUR, t.ReceivedAt, t.ProcessedAt) / 24.0 END) AS avgDays
         FROM Transcripts t WHERE ${since}${tScope(inputs)}`,
        inputs,
      );
      return r[0] ?? {};
    }, {} as Row);
    const students = await this.safe('staff students', async () => {
      const inputs: QueryInput[] = [d];
      const r = await this.rows(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN u.CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS fresh
         FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE r.Name = 'student'${uScope(inputs)}`,
        inputs,
      );
      return r[0] ?? {};
    }, {} as Row);
    const stageStats = await this.safe('staff stages', async () => {
      const inputs: QueryInput[] = [];
      const r = await this.rows(
        `SELECT COUNT(*) AS waiting, SUM(CASE WHEN ts.DueAt < SYSUTCDATETIME() THEN 1 ELSE 0 END) AS overdue
         FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
         WHERE ts.Status = 'active' AND ts.StageType <> 'system' AND t.WorkflowStatus = 'active'${tScope(inputs)}`,
        inputs,
      );
      return r[0] ?? {};
    }, {} as Row);

    // Sparklines + period-over-period deltas: one row per "days ago" across two periods, folded in TS.
    const tTrend = await this.safe('staff transcript trend', async () => {
      const inputs: QueryInput[] = [{ name: 'days2', type: sql.Int, value: days * 2 }];
      const r = await this.rows(
        `SELECT DATEDIFF(DAY, t.ReceivedAt, SYSUTCDATETIME()) AS ago, COUNT(*) AS received,
                SUM(CASE WHEN t.Status = 'complete' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN t.Status NOT IN ('complete','cancelled') THEN 1 ELSE 0 END) AS openCount,
                SUM(CASE WHEN t.Status = 'complete' AND t.ProcessedAt IS NOT NULL THEN 1 ELSE 0 END) AS timed,
                SUM(CASE WHEN t.Status = 'complete' AND t.ProcessedAt IS NOT NULL THEN CAST(DATEDIFF(HOUR, t.ReceivedAt, t.ProcessedAt) AS BIGINT) ELSE 0 END) AS tatHours
         FROM Transcripts t WHERE t.ReceivedAt >= DATEADD(DAY, -@days2, SYSUTCDATETIME())${tScope(inputs)}
         GROUP BY DATEDIFF(DAY, t.ReceivedAt, SYSUTCDATETIME())`,
        inputs,
      );
      return bucketize(r, days, ['received', 'completed', 'openCount', 'timed', 'tatHours']);
    }, null);
    const regTrend = await this.safe('staff registration trend', async () => {
      const inputs: QueryInput[] = [{ name: 'days2', type: sql.Int, value: days * 2 }];
      const r = await this.rows(
        `SELECT DATEDIFF(DAY, u.CreatedAt, SYSUTCDATETIME()) AS ago, COUNT(*) AS fresh
         FROM Users u JOIN Roles r ON r.Id = u.RoleId
         WHERE r.Name = 'student' AND u.CreatedAt >= DATEADD(DAY, -@days2, SYSUTCDATETIME())${uScope(inputs)}
         GROUP BY DATEDIFF(DAY, u.CreatedAt, SYSUTCDATETIME())`,
        inputs,
      );
      return bucketize(r, days, ['fresh']);
    }, null);
    const tat = (hours: number[], timed: number[]) => hours.map((h, i) => (timed[i] ? Math.round((h / timed[i] / 24) * 10) / 10 : 0));
    const trendOf = (k: string, good: 'up' | 'down' = 'up') =>
      tTrend ? { spark: tTrend.cur[k], delta: relDelta(tTrend.total(k), tTrend.prev[k]), good } : {};
    const avgDays = tCounts.avgDays == null ? null : Number(tCounts.avgDays);
    const prevAvgDays = tTrend && tTrend.prev.timed ? tTrend.prev.tatHours / tTrend.prev.timed / 24 : null;
    const waitingN = Number(stageStats.waiting ?? 0);
    const overdueN = Number(stageStats.overdue ?? 0);

    const kpis: Kpi[] = [
      {
        key: 'students', label: 'Students', value: Number(students.total ?? 0), unit: 'count', hint: `${Number(students.fresh ?? 0)} new in ${days} days`,
        ...(regTrend ? { spark: regTrend.cur.fresh, delta: relDelta(regTrend.total('fresh'), regTrend.prev.fresh), deltaLabel: 'new sign-ups', good: 'up' as const } : {}),
      },
      { key: 'requests', label: `Requests (last ${days} days)`, value: Number(tCounts.total ?? 0), unit: 'count', ...trendOf('received') },
      { key: 'inprogress', label: 'In progress', value: Number(tCounts.inProgress ?? 0), tone: 'warn', unit: 'count', ...trendOf('openCount', 'down') },
      { key: 'completed', label: 'Completed', value: Number(tCounts.completed ?? 0), tone: 'good', unit: 'count', gauge: Number(tCounts.total ?? 0) ? Math.round((Number(tCounts.completed ?? 0) / Number(tCounts.total)) * 100) : 0, ...trendOf('completed') },
      { key: 'waiting', label: 'Approvals waiting', value: waitingN, tone: 'warn', unit: 'count' },
      { key: 'overdue', label: 'Overdue stages', value: overdueN, tone: overdueN > 0 ? 'bad' : 'good', unit: 'count', ...(waitingN ? { gauge: Math.round((overdueN / waitingN) * 100) } : {}) },
      {
        key: 'turnaround', label: 'Avg turnaround', value: avgDays == null ? '-' : `${avgDays.toFixed(1)} days`, unit: 'days',
        ...(avgDays == null ? {} : { num: Math.round(avgDays * 10) / 10 }),
        ...(tTrend ? { spark: tat(tTrend.cur.tatHours, tTrend.cur.timed), delta: avgDays == null || prevAvgDays == null ? null : relDelta(avgDays, prevAvgDays), good: 'down' as const } : {}),
      },
    ];

    const charts: Chart[] = [];

    const monthly = await this.safe('staff monthly', () => {
      const inputs: QueryInput[] = [d];
      return this.rows(
        `SELECT CONVERT(VARCHAR(7), t.ReceivedAt, 120) AS name, COUNT(*) AS received,
                SUM(CASE WHEN t.Status = 'complete' THEN 1 ELSE 0 END) AS completed
         FROM Transcripts t WHERE ${since}${tScope(inputs)} GROUP BY CONVERT(VARCHAR(7), t.ReceivedAt, 120) ORDER BY 1`,
        inputs,
      );
    }, []);
    if (monthly.length) {
      charts.push({
        key: 'monthly', title: 'Requests over time', subtitle: 'Received vs completed, by month', type: 'area',
        series: [{ key: 'received', label: 'Received' }, { key: 'completed', label: 'Completed' }],
        data: monthly.map((r) => ({ name: String(r.name), received: Number(r.received), completed: Number(r.completed) })),
      });
    }

    const status = await this.safe('staff status', () => {
      const inputs: QueryInput[] = [d];
      return this.rows(`SELECT t.Status AS name, COUNT(*) AS value FROM Transcripts t WHERE ${since}${tScope(inputs)} GROUP BY t.Status`, inputs);
    }, []);
    if (status.length) charts.push({ key: 'status', title: 'Requests by status', type: 'pie', data: this.pairs(status).map((p) => ({ ...p, name: this.nice(p.name) })) });

    const lanes = await this.safe('staff lanes', () => {
      const inputs: QueryInput[] = [d];
      return this.rows(
        `SELECT tc.Lane AS name, COUNT(*) AS value FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId
         WHERE ${since}${tScope(inputs)} GROUP BY tc.Lane ORDER BY COUNT(*) DESC`,
        inputs,
      );
    }, []);
    if (lanes.length) charts.push({ key: 'lanes', title: 'Courses by lane', subtitle: 'Auto-applied, AI match, needs syllabus...', type: 'hbar', data: this.pairs(lanes).map((p) => ({ ...p, name: this.nice(p.name) })) });

    const outcomes = await this.safe('staff outcomes', () => {
      const inputs: QueryInput[] = [d];
      return this.rows(
        `SELECT e.Outcome AS name, COUNT(*) AS value FROM Evaluations e
         JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId JOIN Transcripts t ON t.Id = tc.TranscriptId
         WHERE e.Outcome IS NOT NULL AND ${since}${tScope(inputs)} GROUP BY e.Outcome`,
        inputs,
      );
    }, []);
    if (outcomes.length) charts.push({ key: 'outcomes', title: 'Decision outcomes', type: 'pie', data: this.pairs(outcomes).map((p) => ({ ...p, name: this.nice(p.name) })) });

    const backlog = await this.safe('staff backlog', () => {
      const inputs: QueryInput[] = [];
      return this.rows(
        `SELECT ts.StageName AS name, COUNT(*) AS value FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
         WHERE ts.Status = 'active' AND ts.StageType <> 'system' AND t.WorkflowStatus = 'active'${tScope(inputs)} GROUP BY ts.StageName ORDER BY COUNT(*) DESC`,
        inputs,
      );
    }, []);
    if (backlog.length) charts.push({ key: 'backlog', title: 'Approval backlog by stage', type: 'hbar', data: this.pairs(backlog) });

    const sources = await this.safe('staff sources', () => {
      const inputs: QueryInput[] = [d];
      return this.rows(
        `SELECT TOP 8 i.Name AS name, COUNT(*) AS value FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId
         WHERE ${since}${tScope(inputs)} GROUP BY i.Name ORDER BY COUNT(*) DESC`,
        inputs,
      );
    }, []);
    if (sources.length) charts.push({ key: 'sources', title: 'Top institutions students transfer from', type: 'hbar', data: this.pairs(sources) });

    const byTarget = await this.safe('staff targets', () => {
      const inputs: QueryInput[] = [];
      return this.rows(
        `SELECT TOP 10 i.Name AS name, COUNT(*) AS value
         FROM StudentProfiles sp JOIN Users u ON u.Id = sp.UserId JOIN Institutions i ON i.Id = sp.TargetInstitutionId
         WHERE 1 = 1${uScope(inputs)} GROUP BY i.Name ORDER BY COUNT(*) DESC`,
        inputs,
      );
    }, []);
    if (byTarget.length) charts.push({ key: 'targets', title: 'Students by target university', type: 'bar', data: this.pairs(byTarget) });

    const applicant = await this.safe('staff applicant types', () => {
      const inputs: QueryInput[] = [];
      return this.rows(
        `SELECT sp.ApplicantType AS name, COUNT(*) AS value FROM StudentProfiles sp JOIN Users u ON u.Id = sp.UserId
         WHERE sp.ApplicantType IS NOT NULL${uScope(inputs)} GROUP BY sp.ApplicantType`,
        inputs,
      );
    }, []);
    if (applicant.length) charts.push({ key: 'applicant', title: 'Students by applicant type', type: 'pie', data: this.pairs(applicant).map((p) => ({ ...p, name: this.nice(p.name) })) });

    const regs = await this.safe('staff registrations', () => {
      const inputs: QueryInput[] = [d];
      return this.rows(
        `SELECT CONVERT(VARCHAR(7), u.CreatedAt, 120) AS name, COUNT(*) AS value FROM Users u JOIN Roles r ON r.Id = u.RoleId
         WHERE r.Name = 'student' AND u.CreatedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())${uScope(inputs)}
         GROUP BY CONVERT(VARCHAR(7), u.CreatedAt, 120) ORDER BY 1`,
        inputs,
      );
    }, []);
    if (regs.length) charts.push({ key: 'registrations', title: 'New student registrations', type: 'line', data: this.pairs(regs) });

    if (isSuper) {
      await this.superExtras(kpis, charts, d, days);
      // AI work is reported separately so it is never mixed into the regular operations numbers.
      const ai = await this.safe('ai section', () => this.aiSection(days), null);
      return { kpis, charts, ...(ai ? { ai } : {}) };
    }
    return { kpis, charts };
  }

  private async superExtras(kpis: Kpi[], charts: Chart[], d: QueryInput, days: number) {
    const byRole = await this.safe('users by role', () =>
      this.rows(`SELECT r.DisplayName AS name, COUNT(*) AS value FROM Users u JOIN Roles r ON r.Id = u.RoleId GROUP BY r.DisplayName ORDER BY COUNT(*) DESC`), []);
    if (byRole.length) charts.push({ key: 'usersByRole', title: 'Users by role', type: 'pie', data: this.pairs(byRole) });

    const active7 = await this.safe('active users', async () => {
      const r = await this.rows(`SELECT COUNT(*) AS n FROM Users WHERE LastLoginAt >= DATEADD(DAY, -7, SYSUTCDATETIME())`);
      return Number(r[0]?.n ?? 0);
    }, 0);
    kpis.splice(1, 0, { key: 'active7', label: 'Signed in (7 days)', value: active7, unit: 'count' });

    const verify = await this.safe('open verification', async () => {
      if (!(await this.schema.has('CourseVerificationRequests'))) return null;
      const r = await this.rows(`SELECT COUNT(*) AS n FROM CourseVerificationRequests WHERE Status = 'open'`);
      return Number(r[0]?.n ?? 0);
    }, null as number | null);
    if (verify !== null) kpis.push({ key: 'verify', label: 'Course verifications open', value: verify, unit: 'count', tone: verify > 0 ? 'warn' : 'good' });

    const imports = await this.safe('pending imports', async () => {
      if (!(await this.schema.has('ImportBatches'))) return null;
      const r = await this.rows(`SELECT COUNT(*) AS n FROM ImportBatches WHERE Status = 'pending'`);
      return Number(r[0]?.n ?? 0);
    }, null as number | null);
    if (imports !== null) kpis.push({ key: 'imports', label: 'Partner submissions to review', value: imports, unit: 'count', tone: imports > 0 ? 'warn' : 'good' });

    const catalogue = await this.safe('catalogue by university', () =>
      this.rows(`SELECT TOP 10 i.Code AS name, COUNT(*) AS value FROM Courses c JOIN Institutions i ON i.Id = c.InstitutionId WHERE c.IsActive = 1 GROUP BY i.Code ORDER BY COUNT(*) DESC`), []);
    if (catalogue.length) charts.push({ key: 'catalogue', title: 'Courses in the catalogue', subtitle: 'Top universities', type: 'bar', data: this.pairs(catalogue) });

    const docs = await this.safe('uploads by type', async () => {
      if (!(await this.schema.has('Uploads', 'DocumentType'))) return [];
      return this.rows(`SELECT COALESCE(DocumentType, EntityType) AS name, COUNT(*) AS value FROM Uploads WHERE IsPublic = 0 GROUP BY COALESCE(DocumentType, EntityType) ORDER BY COUNT(*) DESC`);
    }, []);
    if (docs.length) charts.push({ key: 'docs', title: 'Stored documents by type', type: 'bar', data: this.pairs(docs).map((p) => ({ ...p, name: this.nice(p.name) })) });
  }

  /** Super admin: AI usage and spend (same numbers as AI Controls, which reads the same AiUsageLog). */
  private async aiSection(days: number): Promise<{ kpis: Kpi[]; charts: Chart[] } | null> {
    if (!(await this.schema.has('AiUsageLog'))) return null;
    const s = await this.aiUsage.summary(days);
    const usd = (n: number) => `$${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`;
    const pct = (n: number) => Math.round(n * 100);
    const spent = s.totals.inputTokens + s.totals.outputTokens;
    const saved = s.totals.tokensSaved + s.prefilterTokensSaved;

    const totalRequests = await this.safe('ai share', async () => {
      const r = await this.rows(`SELECT COUNT(*) AS n FROM Transcripts WHERE ReceivedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())`, [
        { name: 'days', type: sql.Int, value: days },
      ]);
      return Number(r[0]?.n ?? 0);
    }, 0);
    const autoApproved = await this.safe('ai auto-approved', async () => {
      if (!(await this.schema.has('TranscriptStages', 'AutoApproved'))) return null;
      const r = await this.rows(
        `SELECT COUNT(*) AS n FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
         WHERE ts.AutoApproved = 1 AND t.ReceivedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())`,
        [{ name: 'days', type: sql.Int, value: days }],
      );
      return Number(r[0]?.n ?? 0);
    }, null as number | null);

    // Per-bucket AI trend over this period and the one before.
    const aiTrend = await this.safe('ai trend', async () => {
      const r = await this.rows(
        `SELECT DATEDIFF(DAY, CreatedAt, SYSUTCDATETIME()) AS ago,
                ISNULL(SUM(EstimatedCostUsd), 0) AS cost,
                COUNT(CASE WHEN Skipped = 0 THEN 1 END) AS calls,
                ISNULL(SUM(CAST(InputTokens AS BIGINT) + OutputTokens), 0) AS tokens,
                ISNULL(SUM(CAST(EstTokensSaved AS BIGINT)), 0) AS saved,
                COUNT(DISTINCT TranscriptId) AS reqs
         FROM AiUsageLog WHERE CreatedAt >= DATEADD(DAY, -@days2, SYSUTCDATETIME())
         GROUP BY DATEDIFF(DAY, CreatedAt, SYSUTCDATETIME())`,
        [{ name: 'days2', type: sql.Int, value: days * 2 }],
      );
      return bucketize(r, days, ['cost', 'calls', 'tokens', 'saved', 'reqs']);
    }, null);
    const aiT = (k: string, good?: 'up' | 'down') =>
      aiTrend ? { spark: aiTrend.cur[k].map((v) => Math.round(v * 10000) / 10000), delta: relDelta(aiTrend.total(k), aiTrend.prev[k]), ...(good ? { good } : {}) } : {};

    const kpis: Kpi[] = [
      { key: 'aiSpend', label: `AI spend (last ${days} days)`, value: usd(s.totals.costUsd), num: s.totals.costUsd, unit: 'usd', ...aiT('cost'), hint: s.unlinked.costUsd > 0 ? `${usd(s.unlinked.costUsd)} not tied to a request` : 'estimated', tone: 'neutral' },
      { key: 'aiMonth', label: 'AI spend this month', value: usd(s.monthCostUsd), num: s.monthCostUsd, unit: 'usd', hint: `${s.monthTokens.toLocaleString()} tokens` },
      { key: 'aiPerRequest', label: 'AI cost per request', value: usd(s.kpis.costPerRequestUsd), num: s.kpis.costPerRequestUsd, unit: 'usd', hint: `${s.kpis.tokensPerRequest.toLocaleString()} tokens per request` },
      {
        key: 'aiRequests', label: 'Requests processed by AI', value: s.totals.requests, unit: 'count', ...aiT('reqs', 'up'),
        hint: totalRequests ? `of ${totalRequests} requests received` : undefined,
        gauge: totalRequests ? Math.min(100, Math.round((s.totals.requests / totalRequests) * 100)) : undefined,
      },
      { key: 'aiCalls', label: 'AI calls', value: s.totals.calls, unit: 'count', ...aiT('calls'), hint: `${s.totals.skippedCalls} skipped · avg ${Math.round(s.kpis.avgLatencyMs)} ms` },
      { key: 'aiTokens', label: 'Tokens used', value: spent, unit: 'count', ...aiT('tokens'), hint: `${s.totals.inputTokens.toLocaleString()} in · ${s.totals.outputTokens.toLocaleString()} out` },
      { key: 'aiSaved', label: 'Tokens saved', value: saved, unit: 'count', ...aiT('saved', 'up'), tone: 'good', gauge: pct(s.kpis.savingsRate), hint: `${pct(s.kpis.cacheHitRate)}% cache hits` },
    ];
    if (autoApproved !== null) kpis.push({ key: 'aiAuto', label: 'Stages auto-approved', value: autoApproved, unit: 'count', tone: 'good' });

    const charts: Chart[] = [];
    if (s.byDay.length) {
      charts.push({
        key: 'aiDaily', title: 'AI spend per day', subtitle: 'Estimated USD', type: 'area',
        series: [{ key: 'cost', label: 'Cost (USD)' }],
        data: s.byDay.map((r) => ({ name: String(r.day), cost: Number(Number(r.costUsd).toFixed(4)) })),
      });
    }
    const ops = s.byOperation.filter((o) => o.costUsd > 0 || o.calls > 0);
    if (ops.length) {
      charts.push({
        key: 'aiByOperation', title: 'AI spend by task', subtitle: 'Matching, document reading, briefs', type: 'pie',
        data: ops.map((o) => ({ name: this.nice(String(o.operation)), value: Number(Number(o.costUsd).toFixed(4)) })),
      });
    }
    if (s.byModel.length) {
      charts.push({
        key: 'aiByModel', title: 'AI spend by model', type: 'hbar',
        data: s.byModel.map((m) => ({ name: String(m.model), value: Number(Number(m.costUsd).toFixed(4)) })),
      });
    }
    const top = (await this.safe('ai top requests', () => this.aiUsage.byRequest(days, 8), [])).filter((r) => r.costUsd > 0);
    if (top.length) {
      charts.push({
        key: 'aiTopRequests', title: 'Most expensive requests', subtitle: 'Estimated USD per transfer request', type: 'hbar',
        data: top.map((r) => ({ name: String(r.studentName), value: Number(Number(r.costUsd).toFixed(4)) })),
      });
    }
    return { kpis, charts };
  }
}
