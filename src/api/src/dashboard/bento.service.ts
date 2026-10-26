import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { ScopeService } from '../policy/scope.service';

type Viewer = { id: string; role: string };
type Row = Record<string, string | number | null>;
type Src = () => { from: string; inputs: QueryInput[] };

interface Group { id: string; name: string; color: string; ink?: 'dark' | 'light' }
interface Plan {
  revenue: { label: string; caption: string; src: Src; col: string };
  sessions: {
    label: string;
    labels: { desktop: string; mobile: string; prior: string; current: string };
    a: { src: Src; col: string };
    b: { src: Src; col: string };
  };
  categories: { title: string; src: Src; col: string; groupExpr: string; groups: Group[]; items: { key: string; name: string; group: string }[] };
  table?: { header: string; src: Src; col: string; nameExpr: string };
  seasonality: { title: string; src: Src; col: string; rows: { src: Src; col: string; nameExpr: string } };
}

export interface BentoPayload {
  currency: string;
  revenue: { label: string; value: number; delta: string; note?: string; caption?: string; series: { label: string; value: number }[] };
  sessions: {
    label: string; value: number; delta: string; note?: string;
    desktop: number[][]; mobile: number[][];
    labels?: { desktop: string; mobile: string; prior: string; current: string };
  };
  categories: {
    title: string;
    groups: Group[];
    periods: { label: string; total: number; delta: string; compare: string }[];
    items: { name: string; group: string; values: number[] }[];
    table?: { columns: string[]; rows: { label: string; values: string[] }[] };
  };
  seasonality: {
    title: string;
    axis?: string[];
    years: {
      label: string;
      values: number[];
      stats: { label: string; value: number; delta: string; note: string }[];
      rows: { label: string; value: string }[];
    }[];
  };
}

const TODAY = 'CAST(SYSUTCDATETIME() AS DATE)';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GREY = 'color-mix(in oklab, var(--color-muted-foreground) 45%, var(--color-muted))';

const LANE_GROUPS: Group[] = [
  { id: 'auto', name: 'Auto-applied', color: '#7CFF5B', ink: 'dark' },
  { id: 'ai', name: 'AI & likely', color: '#8B3DFF', ink: 'light' },
  { id: 'review', name: 'Needs review', color: '#FFB800', ink: 'dark' },
  { id: 'limited', name: 'Elective/limited', color: '#FF5A1F', ink: 'dark' },
  { id: 'no', name: 'Not eligible', color: GREY },
];
const LANE_ITEMS = [
  { key: 'applied', name: 'Auto-applied', group: 'auto' },
  { key: 'likely', name: 'AI match found', group: 'ai' },
  { key: 'needs_syllabus', name: 'Needs syllabus', group: 'review' },
  { key: 'pending', name: 'Pending review', group: 'review' },
  { key: 'elective_only', name: 'Elective only', group: 'limited' },
  { key: 'not_eligible', name: 'Not eligible', group: 'no' },
];
const OUTCOME_GROUPS: Group[] = [
  { id: 'eq', name: 'Equivalent', color: '#7CFF5B', ink: 'dark' },
  { id: 'el', name: 'Elective', color: '#FFB800', ink: 'dark' },
  { id: 'bu', name: 'Receiving-only', color: '#8B3DFF', ink: 'light' },
  { id: 'nc', name: 'No credit', color: GREY },
];
const OUTCOME_ITEMS = [
  { key: 'equivalent', name: 'Equivalent', group: 'eq' },
  { key: 'elective', name: 'Elective credit', group: 'el' },
  { key: 'bu_only', name: 'Receiving-only', group: 'bu' },
  { key: 'no_credit', name: 'No credit', group: 'nc' },
];

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function delta(cur: number, prev: number): string {
  if (!cur && !prev) return '0.0%';
  if (!prev) return '100.0%';
  return `${(((cur - prev) / prev) * 100).toFixed(1)}%`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Role-aware payload for the analytics "bento" dashboard (revenue-style line, hourly waves,
 * treemap + table, seasonality radar). Counts stand in for money. Every sub-query is isolated:
 * a failure (e.g. a missing migration) yields empty data for that widget, never a 500.
 */
@Injectable()
export class BentoService {
  private readonly logger = new Logger(BentoService.name);

  constructor(
    private db: DatabaseService,
    private scope: ScopeService,
  ) {}

  private async rows(query: string, inputs: QueryInput[] = []): Promise<Row[]> {
    const res = await this.db.query<Row>(query, inputs);
    return res.recordset;
  }

  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`Bento widget "${label}" failed: ${(e as Error).message}`);
      return fallback;
    }
  }

  async build(viewer: Viewer): Promise<BentoPayload> {
    const plan = await this.plan(viewer);
    const [revenue, sessions, categories, seasonality] = await Promise.all([
      this.revenue(plan),
      this.sessions(plan),
      this.categories(plan),
      this.seasonality(plan),
    ]);
    return { currency: '', revenue, sessions, categories, seasonality };
  }

  // ── role plans ──────────────────────────────────────────────

  private async plan(viewer: Viewer): Promise<Plan> {
    const me = (): QueryInput => ({ name: 'me', type: sql.UniqueIdentifier, value: viewer.id });

    if (viewer.role === 'student') {
      const own = (extraFrom: string, where: string): Src => () => ({ from: `${extraFrom} WHERE t.StudentUserId = @me${where}`, inputs: [me()] });
      const tcFrom = 'FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId';
      return {
        revenue: { label: 'Courses submitted', caption: 'Last 30 days', src: own(tcFrom, ''), col: 'tc.CreatedAt' },
        sessions: {
          label: 'My activity by hour',
          labels: { desktop: 'Submitted', mobile: 'Decided', prior: 'Prior weeks', current: 'this week' },
          a: { src: own('FROM Transcripts t', ''), col: 't.ReceivedAt' },
          b: {
            src: own(`${tcFrom} JOIN Evaluations e ON e.TranscriptCourseId = tc.Id`, ' AND e.DecidedAt IS NOT NULL'),
            col: 'e.DecidedAt',
          },
        },
        categories: { title: 'My courses by status', src: own(tcFrom, ''), col: 'tc.CreatedAt', groupExpr: 'tc.Lane', groups: LANE_GROUPS, items: LANE_ITEMS },
        table: undefined,
        seasonality: {
          title: 'My submissions by month',
          src: own(tcFrom, ''),
          col: 'tc.CreatedAt',
          rows: { src: own(`${tcFrom} JOIN Institutions i ON i.Id = t.InstitutionId`, ''), col: 'tc.CreatedAt', nameExpr: 'i.Name' },
        },
      };
    }

    if (viewer.role === 'faculty') {
      const evFrom = 'FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId JOIN Transcripts t ON t.Id = tc.TranscriptId';
      const decided = (extraFrom = evFrom): Src => () => ({ from: `${extraFrom} WHERE e.DecidedBy = @me AND e.DecidedAt IS NOT NULL`, inputs: [me()] });
      return {
        revenue: { label: 'Decisions made', caption: 'Last 30 days', src: decided('FROM Evaluations e'), col: 'e.DecidedAt' },
        sessions: {
          label: 'My activity by hour',
          labels: { desktop: 'Decided', mobile: 'Stages completed', prior: 'Prior weeks', current: 'this week' },
          a: { src: decided('FROM Evaluations e'), col: 'e.DecidedAt' },
          b: { src: () => ({ from: 'FROM TranscriptStages ts WHERE ts.DecidedByUserId = @me AND ts.CompletedAt IS NOT NULL', inputs: [me()] }), col: 'ts.CompletedAt' },
        },
        categories: {
          title: 'My decisions by outcome',
          src: () => ({ from: 'FROM Evaluations e WHERE e.DecidedBy = @me AND e.DecidedAt IS NOT NULL AND e.Outcome IS NOT NULL', inputs: [me()] }),
          col: 'e.DecidedAt',
          groupExpr: 'e.Outcome',
          groups: OUTCOME_GROUPS,
          items: OUTCOME_ITEMS,
        },
        table: {
          header: 'Source university',
          src: () => ({ from: `${evFrom} JOIN Institutions i ON i.Id = t.InstitutionId WHERE e.DecidedBy = @me AND e.DecidedAt IS NOT NULL`, inputs: [me()] }),
          col: 'e.DecidedAt',
          nameExpr: 'i.Name',
        },
        seasonality: {
          title: 'My decisions by month',
          src: decided('FROM Evaluations e'),
          col: 'e.DecidedAt',
          rows: {
            src: () => ({ from: `${evFrom} JOIN Institutions i ON i.Id = t.InstitutionId WHERE e.DecidedBy = @me AND e.DecidedAt IS NOT NULL`, inputs: [me()] }),
            col: 'e.DecidedAt',
            nameExpr: 'i.Name',
          },
        },
      };
    }

    // admin (scoped to their universities) and super_admin (everything)
    const adminScope = await this.scope.universityScope(viewer);
    const staff = (extraFrom: string, where = ''): Src => () => {
      const inputs: QueryInput[] = [];
      const sc = adminScope ? ` AND ${this.scope.transcriptInScope(adminScope, 't', inputs)}` : '';
      return { from: `${extraFrom} WHERE 1 = 1${where}${sc}`, inputs };
    };
    const tcFrom = 'FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId';
    return {
      revenue: { label: 'Requests received', caption: 'Last 30 days', src: staff('FROM Transcripts t'), col: 't.ReceivedAt' },
      sessions: {
        label: 'Activity by hour',
        labels: { desktop: 'Submitted', mobile: 'Decided', prior: 'Prior weeks', current: 'this week' },
        a: { src: staff('FROM Transcripts t'), col: 't.ReceivedAt' },
        b: { src: staff(`FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId JOIN Transcripts t ON t.Id = tc.TranscriptId`, ' AND e.DecidedAt IS NOT NULL'), col: 'e.DecidedAt' },
      },
      categories: { title: 'Courses by outcome', src: staff(tcFrom), col: 'tc.CreatedAt', groupExpr: 'tc.Lane', groups: LANE_GROUPS, items: LANE_ITEMS },
      table: { header: 'Source university', src: staff('FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId'), col: 't.ReceivedAt', nameExpr: 'i.Name' },
      seasonality: {
        title: 'Requests by month',
        src: staff('FROM Transcripts t'),
        col: 't.ReceivedAt',
        rows: {
          src: staff('FROM Transcripts t LEFT JOIN StudentProfiles sp ON sp.UserId = t.StudentUserId JOIN Institutions i ON i.Id = COALESCE(t.TargetInstitutionId, sp.TargetInstitutionId)'),
          col: 't.ReceivedAt',
          nameExpr: 'i.Name',
        },
      },
    };
  }

  // ── widgets ─────────────────────────────────────────────────

  /** Last 30 days, one point per day (zero-filled), compared with the 30 days before. */
  private async revenue(plan: Plan): Promise<BentoPayload['revenue']> {
    const { src, col, label, caption } = plan.revenue;
    const data = await this.safe('revenue', async () => {
      const s = src();
      return this.rows(
        `SELECT CONVERT(VARCHAR(10), CAST(${col} AS DATE), 23) AS d, COUNT(*) AS n
         ${s.from} AND ${col} >= DATEADD(DAY, -59, ${TODAY})
         GROUP BY CONVERT(VARCHAR(10), CAST(${col} AS DATE), 23)`,
        s.inputs,
      );
    }, [] as Row[]);
    const byDay = new Map(data.map((r) => [String(r.d), Number(r.n ?? 0)]));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const series: { label: string; value: number }[] = [];
    let cur = 0;
    let prev = 0;
    for (let i = 59; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const n = byDay.get(isoDay(d)) ?? 0;
      if (i < 30) {
        cur += n;
        series.push({ label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, value: n });
      } else prev += n;
    }
    return { label, value: cur, delta: delta(cur, prev), note: `${fmt(prev)} in the 30 days before`, caption, series };
  }

  /** Two hour-of-day distributions over the last 3 weeks (index 0 = this week). */
  private async sessions(plan: Plan): Promise<BentoPayload['sessions']> {
    const { label, labels, a, b } = plan.sessions;
    const hourly = async (name: string, side: { src: Src; col: string }) =>
      this.safe(name, async () => {
        const s = side.src();
        const r = await this.rows(
          `SELECT DATEDIFF(DAY, CAST(${side.col} AS DATE), ${TODAY}) / 7 AS wk, DATEPART(HOUR, ${side.col}) AS hr, COUNT(*) AS n
           ${s.from} AND ${side.col} >= DATEADD(DAY, -20, ${TODAY})
           GROUP BY DATEDIFF(DAY, CAST(${side.col} AS DATE), ${TODAY}) / 7, DATEPART(HOUR, ${side.col})`,
          s.inputs,
        );
        const out = [0, 1, 2].map(() => new Array<number>(25).fill(0));
        for (const x of r) {
          const wk = Number(x.wk);
          const hr = Number(x.hr);
          if (wk >= 0 && wk <= 2 && hr >= 0 && hr <= 23) out[wk][hr] = Number(x.n ?? 0);
        }
        for (const w of out) w[24] = w[0];
        return out;
      }, [0, 1, 2].map(() => new Array<number>(25).fill(0)));
    const [desktop, mobile] = await Promise.all([hourly('hourly a', a), hourly('hourly b', b)]);
    const sum = (m: number[][], wk: number) => m[wk].slice(0, 24).reduce((x, y) => x + y, 0);
    const cur = sum(desktop, 0) + sum(mobile, 0);
    const prev = sum(desktop, 1) + sum(mobile, 1);
    return { label, value: cur, delta: delta(cur, prev), note: 'By hour, last 3 weeks', desktop, mobile, labels };
  }

  /** Weekly / monthly / yearly counts per category, plus an optional top-3 table. */
  private async categories(plan: Plan): Promise<BentoPayload['categories']> {
    const c = plan.categories;
    const win = (days: number) => `${c.col} >= DATEADD(DAY, ${-(days - 1)}, ${TODAY})`;
    const between = (from: number, to: number) => `${c.col} >= DATEADD(DAY, ${-(from - 1)}, ${TODAY}) AND ${c.col} < DATEADD(DAY, ${-(to - 1)}, ${TODAY})`;

    const perKey = await this.safe('categories', async () => {
      const s = c.src();
      return this.rows(
        `SELECT ${c.groupExpr} AS k,
                SUM(CASE WHEN ${win(7)} THEN 1 ELSE 0 END) AS w,
                SUM(CASE WHEN ${win(30)} THEN 1 ELSE 0 END) AS m,
                COUNT(*) AS y
         ${s.from} AND ${win(365)}
         GROUP BY ${c.groupExpr}`,
        s.inputs,
      );
    }, [] as Row[]);
    const totals = await this.safe('category totals', async () => {
      const s = c.src();
      const r = await this.rows(
        `SELECT SUM(CASE WHEN ${win(7)} THEN 1 ELSE 0 END) AS w,
                SUM(CASE WHEN ${between(14, 7)} THEN 1 ELSE 0 END) AS wp,
                SUM(CASE WHEN ${win(30)} THEN 1 ELSE 0 END) AS m,
                SUM(CASE WHEN ${between(60, 30)} THEN 1 ELSE 0 END) AS mp,
                SUM(CASE WHEN ${win(365)} THEN 1 ELSE 0 END) AS y,
                SUM(CASE WHEN ${between(730, 365)} THEN 1 ELSE 0 END) AS yp
         ${s.from} AND ${win(730)}`,
        s.inputs,
      );
      return r[0] ?? {};
    }, {} as Row);

    const n = (k: string) => Number(totals[k] ?? 0);
    const byKey = new Map(perKey.map((r) => [String(r.k), [Number(r.w ?? 0), Number(r.m ?? 0), Number(r.y ?? 0)]]));
    const items = c.items
      .map((it) => ({ name: it.name, group: it.group, values: byKey.get(it.key) ?? [0, 0, 0] }))
      .filter((it) => it.values.some((v) => v > 0));

    const periods = [
      { label: 'Weekly', total: n('w'), delta: delta(n('w'), n('wp')), compare: `vs ${fmt(n('wp'))} last week` },
      { label: 'Monthly', total: n('m'), delta: delta(n('m'), n('mp')), compare: `vs ${fmt(n('mp'))} last month` },
      { label: 'Yearly', total: n('y'), delta: delta(n('y'), n('yp')), compare: `vs ${fmt(n('yp'))} last year` },
    ];

    let table: BentoPayload['categories']['table'];
    if (plan.table) {
      const t = plan.table;
      const tw = (days: number) => `${t.col} >= DATEADD(DAY, ${-(days - 1)}, ${TODAY})`;
      const rows = await this.safe('category table', async () => {
        const s = t.src();
        return this.rows(
          `SELECT TOP 3 ${t.nameExpr} AS name,
                  SUM(CASE WHEN ${tw(7)} THEN 1 ELSE 0 END) AS w,
                  SUM(CASE WHEN ${tw(30)} THEN 1 ELSE 0 END) AS m,
                  COUNT(*) AS y
           ${s.from} AND ${tw(365)}
           GROUP BY ${t.nameExpr}
           ORDER BY COUNT(*) DESC`,
          s.inputs,
        );
      }, [] as Row[]);
      table = {
        columns: [t.header, 'Weekly', 'Monthly', 'Yearly'],
        rows: rows.map((r) => ({ label: String(r.name ?? 'Unknown'), values: [fmt(Number(r.w ?? 0)), fmt(Number(r.m ?? 0)), fmt(Number(r.y ?? 0))] })),
      };
    }

    return { title: c.title, groups: c.groups, periods, items, table };
  }

  /** Monthly counts for this year and last, with year-over-year stats and the top 3 names per year. */
  private async seasonality(plan: Plan): Promise<BentoPayload['seasonality']> {
    const s = plan.seasonality;
    const year = new Date().getUTCFullYear();
    const monthly = await this.safe('seasonality', async () => {
      const q = s.src();
      return this.rows(
        `SELECT YEAR(${s.col}) AS yr, MONTH(${s.col}) AS mo, COUNT(*) AS n
         ${q.from} AND ${s.col} >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()) - 2, 1, 1)
         GROUP BY YEAR(${s.col}), MONTH(${s.col})`,
        q.inputs,
      );
    }, [] as Row[]);
    const names = await this.safe('seasonality names', async () => {
      const q = s.rows.src();
      return this.rows(
        `SELECT YEAR(${s.rows.col}) AS yr, ${s.rows.nameExpr} AS name, COUNT(*) AS n
         ${q.from} AND ${s.rows.col} >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()) - 1, 1, 1)
         GROUP BY YEAR(${s.rows.col}), ${s.rows.nameExpr}`,
        q.inputs,
      );
    }, [] as Row[]);

    const values = (yr: number) => {
      const v = new Array<number>(12).fill(0);
      for (const r of monthly) if (Number(r.yr) === yr) v[Number(r.mo) - 1] = Number(r.n ?? 0);
      return v;
    };
    const total = (v: number[]) => v.reduce((a, b) => a + b, 0);
    const monthsIn = (yr: number) => (yr === year ? new Date().getUTCMonth() + 1 : 12);

    const years = [year, year - 1].map((yr) => {
      const v = values(yr);
      const prev = values(yr - 1);
      const tot = total(v);
      const prevTot = total(prev);
      const avg = tot / monthsIn(yr);
      const prevAvg = prevTot / monthsIn(yr - 1);
      const rows = names
        .filter((r) => Number(r.yr) === yr)
        .sort((a, b) => Number(b.n) - Number(a.n))
        .slice(0, 3)
        .map((r) => ({ label: String(r.name ?? 'Unknown'), value: fmt(Number(r.n ?? 0)) }));
      while (rows.length < 3) rows.push({ label: '-', value: '0' });
      return {
        label: String(yr),
        values: v,
        stats: [
          { label: 'Monthly avg', value: Math.round(avg), delta: delta(avg, prevAvg), note: `${fmt(tot)} so far` },
          { label: 'Year total', value: tot, delta: delta(tot, prevTot), note: `${fmt(prevTot)} in ${yr - 1}` },
        ],
        rows,
      };
    });
    return { title: s.title, axis: MONTHS, years };
  }
}
