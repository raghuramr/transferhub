import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dashboardApi, type BentoPayload, type DashboardChart, type DashboardKpi, type DashboardPayload } from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  AI, AI_RAMP, BRAND, BRAND_RAMP, CATEGORICAL, Card, ColumnStrip, Columns, Composition, Delta, HourHeat, INK, LineTrend, Meter, NEUTRAL,
  Ranked, Sparkline, accentColor, fmtNum, formatValue, isDateLike, shortLabel, useNow, type Accent, type LineSeries, type Part, type TableView, type Unit,
} from './viz';

// ── KPI ledger ─────────────────────────────────────────────────────

const TONE_DOT: Record<NonNullable<DashboardKpi['tone']>, string | null> = { good: null, neutral: null, warn: '#c98500', bad: '#b42318' };

function kpiNumber(k: DashboardKpi): number | null {
  if (typeof k.num === 'number') return k.num;
  if (typeof k.value === 'number') return k.value;
  return null;
}

function StatTile({ k, accent, days }: { k: DashboardKpi; accent: Accent; days: number }) {
  const n = kpiNumber(k);
  const unit = (k.unit ?? 'count') as Unit;
  const f = n === null ? { main: String(k.value) } : formatValue(n, unit);
  const color = accentColor(accent);
  const dot = TONE_DOT[k.tone ?? 'neutral'];
  const hasDelta = k.delta !== undefined;
  return (
    <div className="flex min-w-0 flex-col bg-white px-3.5 py-3">
      <p className="flex items-start gap-1.5 text-xs leading-4" style={{ color: INK.secondary }} title={k.label}>
        {dot && Number(n) > 0 && <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} aria-label={k.tone === 'bad' ? 'needs attention' : 'watch'} />}
        <span className="line-clamp-2">{k.label}</span>
      </p>
      <p className="mt-1 flex items-baseline gap-1 leading-none" style={{ color: INK.primary }}>
        <span className="text-[22px] font-semibold tracking-[-0.02em]">{f.main}</span>
        {f.suffix && <span className="text-xs font-medium" style={{ color: INK.muted }}>{f.suffix}</span>}
      </p>
      <div className="mt-1.5 min-h-[16px]">
        {hasDelta ? <Delta value={k.delta} good={k.good} label={k.deltaLabel ?? `vs prior ${days}d`} /> : k.hint ? <p className="truncate text-[11px]" style={{ color: INK.muted }} title={k.hint}>{k.hint}</p> : null}
      </div>
      <div className="mt-auto pt-2">
        {k.spark && k.spark.length > 1 ? (
          <Sparkline values={k.spark} color={color} days={days} unit={unit} />
        ) : k.gauge !== undefined ? (
          <div className="flex h-[30px] items-end pb-1"><Meter pct={k.gauge} color={k.tone === 'bad' ? '#b42318' : color} label={k.label} /></div>
        ) : (
          <div className="h-[30px]" />
        )}
      </div>
      {hasDelta && k.hint && <p className="mt-1 truncate text-[11px]" style={{ color: INK.muted }} title={k.hint}>{k.hint}</p>}
    </div>
  );
}

/** One hairline-ruled ledger of stat tiles; `accent` colours the sparklines/meters (brand or AI). */
export function KpiGrid({ kpis, accent = 'brand', days = 30 }: { kpis: DashboardKpi[]; accent?: Accent | string; days?: number }) {
  const a: Accent = accent === 'ai' || accent === AI ? 'ai' : 'brand';
  const cols = kpis.length % 5 === 0 || kpis.length === 9 ? 'lg:grid-cols-5' : 'lg:grid-cols-4';
  return (
    <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#ece4e6] bg-[#ece4e6] sm:grid-cols-3', cols)}>
      {kpis.map((k) => <StatTile key={k.key} k={k} accent={a} days={days} />)}
      {/* fill the last row so the hairline grid stays closed */}
      {Array.from({ length: (5 - (kpis.length % 5)) % 5 }).map((_, i) => <div key={`f${i}`} className={cn('hidden bg-white', cols === 'lg:grid-cols-5' && 'lg:block')} />)}
    </div>
  );
}

// ── chart mapping ──────────────────────────────────────────────────

const LANE_ORDER = ['Applied', 'Auto-applied', 'Likely', 'Ai match found', 'Needs syllabus', 'Pending', 'Elective only', 'Not eligible'];
const OUTCOME_ORDER = ['Equivalent', 'Elective', 'Bu only', 'Receiving-only', 'No credit'];
const NEUTRAL_NAMES = new Set(['Not eligible', 'No credit', 'Cancelled', 'Unknown', 'Other']);

function ordered(data: { name: string; value: number }[], order: string[]) {
  const pos = (n: string) => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
  return [...data].sort((a, b) => pos(a.name) - pos(b.name));
}

/** Colour rules: ordered categories take a one-hue ramp; nominal ones the fixed categorical order; "nothing" states stay neutral grey. */
function partsFor(chart: DashboardChart, accent: Accent): Part[] {
  const data = chart.data.map((d) => ({ name: String(d.name), value: Number(d.value ?? 0) }));
  const isOrdinal = chart.key === 'lanes' || chart.key === 'outcomes';
  const rows = chart.key === 'lanes' ? ordered(data, LANE_ORDER) : chart.key === 'outcomes' ? ordered(data, OUTCOME_ORDER) : data;
  const ramp = accent === 'ai' ? AI_RAMP : BRAND_RAMP;
  // Past the palette length, fold the tail into "Other" instead of inventing hues.
  const limit = isOrdinal ? ramp.length + 1 : CATEGORICAL.length;
  let list = rows;
  if (list.length > limit) {
    const head = list.slice(0, limit - 1);
    const rest = list.slice(limit - 1).reduce((a, r) => a + r.value, 0);
    list = [...head, { name: 'Other', value: rest }];
  }
  let slot = 0;
  return list.map((r) => {
    if (NEUTRAL_NAMES.has(r.name)) return { ...r, color: NEUTRAL };
    const color = isOrdinal || accent === 'ai' ? ramp[Math.min(slot, ramp.length - 1)] : CATEGORICAL[slot % CATEGORICAL.length];
    slot++;
    return { ...r, color };
  });
}

function unitFor(chart: DashboardChart): Unit {
  if (/usd|spend|cost|expensive/i.test(`${chart.key} ${chart.title} ${chart.subtitle ?? ''}`)) return 'usd';
  return 'count';
}

function tableFor(chart: DashboardChart): TableView {
  const series = chart.series ?? [{ key: 'value', label: 'Value' }];
  return {
    columns: ['', ...series.map((s) => s.label)],
    rows: chart.data.map((d) => [isDateLike(d.name) ? shortLabel(String(d.name), true) : String(d.name), ...series.map((s) => Number(d[s.key] ?? 0).toLocaleString('en-US'))]),
  };
}

type Kind = 'trend' | 'columns' | 'mix' | 'ranked';
function kindOf(c: DashboardChart): Kind {
  if (c.type === 'pie') return 'mix';
  if (c.type === 'area' || c.type === 'line' || c.type === 'stacked') return 'trend';
  if (c.type === 'bar' && ((c.series?.length ?? 1) > 1 || c.data.some((d) => isDateLike(d.name)))) return 'columns';
  return 'ranked';
}

/** Renders one payload chart in the form that suits its job. Exported for reuse; picks its own card chrome. */
export function ChartCard({ chart, index = 0, accent = 'brand', className, columns }: { chart: DashboardChart; index?: number; accent?: Accent; className?: string; columns?: boolean }) {
  const kind = kindOf(chart);
  const unit = unitFor(chart);
  const delay = 0.04 * index;
  const color = accentColor(accent);
  if (kind === 'trend' || kind === 'columns') {
    const series = chart.series ?? [{ key: 'value', label: chart.title }];
    const labels = chart.data.map((d) => String(d.name));
    const palette = series.length === 1 ? [color] : CATEGORICAL;
    if (kind === 'columns') {
      return (
        <Card title={chart.title} subtitle={chart.subtitle} table={tableFor(chart)} delay={delay} className={className}>
          <Columns labels={labels} unit={unit} series={series.map((s, i) => ({ key: s.key, label: s.label, color: palette[i % palette.length], values: chart.data.map((d) => Number(d[s.key] ?? 0)) }))} />
        </Card>
      );
    }
    const lines: LineSeries[] = series.map((s, i) => ({ key: s.key, label: s.label, color: palette[i % palette.length], area: series.length === 1, values: chart.data.map((d) => Number(d[s.key] ?? 0)) }));
    const total = series.length === 1 ? lines[0].values.reduce<number>((a, v) => a + (v ?? 0), 0) : null;
    return (
      <Card
        title={chart.title} subtitle={chart.subtitle} table={tableFor(chart)} delay={delay} className={className}
        aside={total !== null ? <span className="text-xs font-semibold tabular-nums" style={{ color: INK.primary }}>{fmtNum(total, unit)}<span className="ml-1 font-normal" style={{ color: INK.muted }}>total</span></span> : undefined}
      >
        <LineTrend labels={labels} series={lines} unit={unit} withYear={labels.some((l) => /^\d{4}-\d{2}$/.test(l))} height={168} />
      </Card>
    );
  }
  if (kind === 'mix') {
    return (
      <Card title={chart.title} subtitle={chart.subtitle} delay={delay} className={className} table={tableFor(chart)}>
        <Composition parts={partsFor(chart, accent)} unit={unit} />
      </Card>
    );
  }
  return (
    <Card title={chart.title} subtitle={chart.subtitle} delay={delay} className={className}>
      <Ranked items={chart.data.map((d) => ({ name: String(d.name), value: Number(d.value ?? 0) }))} color={color} unit={unit} columns={columns} />
    </Card>
  );
}

/** Several part-to-whole breakdowns as small multiples in one card (replaces a wall of donuts). */
function MixCard({ charts, title, subtitle, accent = 'brand', delay = 0, className }: { charts: DashboardChart[]; title: string; subtitle?: string; accent?: Accent; delay?: number; className?: string }) {
  return (
    <Card title={title} subtitle={subtitle} delay={delay} className={className}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
        {charts.map((c) => <Composition key={c.key} title={c.title} total parts={partsFor(c, accent)} unit={unitFor(c)} />)}
      </div>
    </Card>
  );
}

// ── bento-derived widgets ──────────────────────────────────────────

function pctNum(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n / 100 : null;
}

function HeroCard({ revenue, delay, className }: { revenue: BentoPayload["revenue"]; delay?: number; className?: string }) {
  return (
    <Card
      title={revenue.label} subtitle={revenue.caption ?? 'Last 30 days'} delay={delay} className={className}
      table={{ columns: ['Day', 'Count'], rows: revenue.series.map((s) => [s.label, s.value]) }}
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <p className="text-[48px] font-semibold leading-[0.95] tracking-[-0.035em]" style={{ color: INK.primary }}>{revenue.value.toLocaleString('en-US')}</p>
        <div className="pb-1">
          <Delta value={pctNum(revenue.delta)} good="up" />
          {revenue.note && <p className="text-[11px]" style={{ color: INK.muted }}>{revenue.note}</p>}
        </div>
      </div>
      <div className="mt-4"><ColumnStrip series={revenue.series} color={BRAND} /></div>
    </Card>
  );
}

function ActivityCard({ sessions, delay, className }: { sessions: BentoPayload["sessions"]; delay?: number; className?: string }) {
  const sum = (m: number[][]) => Array.from({ length: 24 }, (_, h) => m.reduce((a, wk) => a + Number(wk?.[h] ?? 0), 0));
  const rows = [
    { label: sessions.labels?.desktop ?? 'Submitted', values: sum(sessions.desktop ?? []) },
    { label: sessions.labels?.mobile ?? 'Decided', values: sum(sessions.mobile ?? []) },
  ];
  return (
    <Card
      title={sessions.label} subtitle="By hour of day (UTC), last 3 weeks" delay={delay} className={className}
      aside={<span className="text-xs tabular-nums" style={{ color: INK.primary }}><b className="font-semibold">{sessions.value.toLocaleString('en-US')}</b> <span style={{ color: INK.muted }}>this week</span> <Delta value={pctNum(sessions.delta)} className="ml-1" /></span>}
      table={{ columns: ['Hour', ...rows.map((r) => r.label)], rows: Array.from({ length: 24 }, (_, h) => [`${h}:00`, ...rows.map((r) => r.values[h])]) }}
    >
      <HourHeat rows={rows} color={BRAND} cellHeight={30} />
      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-[#f1ebec] text-xs">
        {rows.map((r) => {
          const total = r.values.reduce((a, v) => a + v, 0);
          const peak = r.values.reduce((b, v, i) => (v > r.values[b] ? i : b), 0);
          // Busiest 4-hour window: where the work actually concentrates.
          let best = 0;
          let bestAt = 0;
          for (let h = 0; h < 24; h++) {
            const s = [0, 1, 2, 3].reduce((a, k) => a + r.values[(h + k) % 24], 0);
            if (s > best) { best = s; bestAt = h; }
          }
          return (
            <div key={r.label} className="bg-white px-3 py-2">
              <dt style={{ color: INK.muted }}>{r.label}</dt>
              <dd className="mt-0.5" style={{ color: INK.primary }}>
                <b className="text-base font-semibold">{total.toLocaleString('en-US')}</b>
                <span className="ml-1.5" style={{ color: INK.secondary }}>peak {String(peak).padStart(2, '0')}:00</span>
              </dd>
              {total > 0 && <dd className="text-[11px]" style={{ color: INK.muted }}>{Math.round((best / total) * 100)}% between {String(bestAt).padStart(2, '0')}:00–{String((bestAt + 4) % 24).padStart(2, '0')}:00</dd>}
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

function SeasonCard({ seasonality, delay, className }: { seasonality: BentoPayload["seasonality"]; delay?: number; className?: string }) {
  const axis = seasonality.axis ?? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [cur, prev] = seasonality.years;
  const thisMonth = new Date().getMonth();
  const isCurrent = cur && Number(cur.label) === new Date().getFullYear();
  const series: LineSeries[] = [];
  if (prev) series.push({ key: 'prev', label: prev.label, color: '#b9afb1', values: prev.values });
  if (cur) series.push({ key: 'cur', label: cur.label, color: BRAND, area: true, values: cur.values.map((v, i) => (isCurrent && i > thisMonth ? null : v)) });
  const total = cur?.stats.find((s) => /total/i.test(s.label));
  return (
    <Card
      title={seasonality.title} subtitle={prev ? `${cur?.label} against ${prev.label}` : undefined} delay={delay} className={className}
      aside={total ? <span className="text-xs tabular-nums" style={{ color: INK.primary }}><b className="font-semibold">{total.value.toLocaleString('en-US')}</b> <span style={{ color: INK.muted }}>YTD</span> <Delta value={pctNum(total.delta)} good="up" className="ml-1" /></span> : undefined}
      table={{ columns: ['Month', ...seasonality.years.map((y) => y.label)], rows: axis.map((m, i) => [m, ...seasonality.years.map((y) => y.values[i] ?? 0)]) }}
    >
      <LineTrend labels={axis} series={series} height={168} />
      {cur?.rows?.some((r) => r.label !== '-') && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#f3eeef] pt-2.5 text-[11px]" style={{ color: INK.secondary }}>
          <span style={{ color: INK.muted }}>Top this year</span>
          {cur.rows.filter((r) => r.label !== '-').map((r) => (
            <span key={r.label} className="truncate"><b className="font-semibold tabular-nums" style={{ color: INK.primary }}>{r.value}</b> {r.label}</span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── page ───────────────────────────────────────────────────────────

function Eyebrow({ title, subtitle, color, right }: { title: string; subtitle?: string; color: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-[#ece4e6] pb-2">
      <div className="flex items-baseline gap-2.5">
        <span className="h-2 w-2 translate-y-[-1px] rounded-[2px]" style={{ background: color }} aria-hidden />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: INK.primary }}>{title}</h3>
        {subtitle && <p className="hidden text-xs sm:block" style={{ color: INK.muted }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function ago(iso: string | undefined, now: number) {
  if (!iso) return '';
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Loads the caller's role-specific dashboard and renders its KPIs and charts. */
export function DashboardView({ withRange = true }: { withRange?: boolean }) {
  const [days, setDays] = useState(180);
  const now = useNow();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => dashboardApi.get(days),
    refetchInterval: 120_000,
    placeholderData: (prev) => prev,
  });
  const d = data?.data;
  const bentoQuery = useQuery({
    queryKey: ['dashboard-bento'],
    queryFn: () => dashboardApi.bento(),
    refetchInterval: 120_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const bento = bentoQuery.data?.data;
  const hasRevenue = !!bento?.revenue?.series?.length && bento.revenue.series.some((s) => s.value > 0);
  const hasHours = !!bento?.sessions && [...(bento.sessions.desktop ?? []), ...(bento.sessions.mobile ?? [])].some((w) => w?.some((v) => v > 0));
  const hasSeason = !!bento?.seasonality?.years?.length && bento.seasonality.years.some((y) => y.values.some((v) => v > 0));

  const charts = d?.charts ?? [];
  const trends = charts.filter((c) => kindOf(c) === 'trend');
  const mainTrend = trends.find((c) => (c.series?.length ?? 1) > 1) ?? trends[0];
  const mixes = charts.filter((c) => kindOf(c) === 'mix' || c.key === 'lanes');
  const rest = charts.filter((c) => c !== mainTrend && !mixes.includes(c));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs" style={{ color: INK.muted }}>
          {d ? <>Updated {ago(d.generatedAt, now)}{withRange && <> · showing the last <b className="font-medium" style={{ color: INK.secondary }}>{d.days} days</b></>}</> : ' '}
        </p>
        <div className="flex items-center gap-2">
          {withRange && (
            <div className="flex rounded-lg border border-[#ece4e6] bg-white p-0.5 text-xs" role="group" aria-label="Time range">
              {(d?.ranges ?? [30, 90, 180, 365]).map((r) => (
                <button
                  key={r} type="button" onClick={() => setDays(r)} aria-pressed={days === r}
                  className={cn('relative rounded-md px-2.5 py-1 font-medium transition-colors', days === r ? 'text-white' : 'text-[#5b5153] hover:text-[#1d1517]')}
                >
                  {days === r && <motion.span layoutId="range-pill" className="absolute inset-0 rounded-md" style={{ background: INK.primary }} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  <span className="relative">{r === 365 ? '1y' : `${r}d`}</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => { refetch(); bentoQuery.refetch(); }} className="rounded-lg border border-[#ece4e6] bg-white p-1.5 text-[#5b5153] hover:text-[#1d1517]" aria-label="Refresh">
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isLoading && <p className="py-8 text-center text-sm" style={{ color: INK.muted }}>Loading insights…</p>}
      {error && <p className="py-4 text-center text-sm text-red-600">Could not load the dashboard.</p>}
      {d && (
        <div className={cn('space-y-8 transition-opacity', isFetching && 'opacity-60')}>
          <section className="space-y-3">
            {d.ai && <Eyebrow title="Transfer operations" subtitle="Requests, students and reviews handled by people" color={BRAND} />}
            <KpiGrid key={`k-${d.days}`} kpis={d.kpis} days={d.days} />

            {(hasRevenue || mainTrend) && (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                {hasRevenue && bento && <HeroCard revenue={bento.revenue} delay={0.05} className={mainTrend ? "lg:col-span-5" : "lg:col-span-12"} />}
                {mainTrend && <ChartCard chart={mainTrend} index={2} className={hasRevenue ? 'lg:col-span-7' : 'lg:col-span-12'} />}
              </div>
            )}

            {(hasHours || hasSeason) && bento && (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                {hasSeason && <SeasonCard seasonality={bento.seasonality} delay={0.1} className={hasHours ? 'lg:col-span-7' : 'lg:col-span-12'} />}
                {hasHours && <ActivityCard sessions={bento.sessions} delay={0.12} className={hasSeason ? 'lg:col-span-5' : 'lg:col-span-12'} />}
              </div>
            )}

            {mixes.length > 0 && <MixCard charts={mixes} title="Breakdown" subtitle={`Share of each total · dated items cover the last ${d.days} days`} delay={0.14} />}

            {rest.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rest.map((c, i) => <ChartCard key={`${c.key}-${d.days}`} chart={c} index={4 + i} />)}
              </div>
            )}
            {charts.length === 0 && !hasRevenue && (
              <p className="rounded-xl border border-dashed border-[#e3d9db] bg-white p-8 text-center text-sm" style={{ color: INK.muted }}>
                Charts appear here as soon as there is data to show.
              </p>
            )}
          </section>
          {d.ai && <AiSection ai={d.ai} days={d.days} />}
        </div>
      )}
    </div>
  );
}

/** AI usage and spend, kept visually apart from the regular operations numbers above. */
function AiSection({ ai, days }: { ai: NonNullable<DashboardPayload['ai']>; days: number }) {
  const reduce = useReducedMotion();
  const daily = ai.charts.find((c) => c.key === 'aiDaily');
  const byTask = ai.charts.find((c) => c.key === 'aiByOperation');
  const byModel = ai.charts.find((c) => c.key === 'aiByModel');
  // Breakdowns sit in a narrow column beside the daily line; anything else gets the full width (two-column list).
  const side = [byTask, byModel].filter((c): c is DashboardChart => !!c);
  const wide = ai.charts.filter((c) => c !== daily && !side.includes(c));
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.2 }}
      className="space-y-3 rounded-2xl bg-[linear-gradient(180deg,#f6f2ff_0%,rgba(246,242,255,0)_340px)] p-3 ring-1 ring-[#e7defb] sm:p-4"
    >
      <Eyebrow
        title="AI agents" subtitle={`Work done by AI and its estimated cost · last ${days} days`} color={AI}
        right={<Link to="/superadmin/settings/ai-controls" className="inline-flex items-center gap-1 text-xs font-medium text-[#5b21b6] hover:underline">AI Controls <ArrowRight size={12} /></Link>}
      />
      {ai.kpis.length > 0 && <KpiGrid key={`ai-k-${days}`} kpis={ai.kpis} accent="ai" days={days} />}
      {ai.charts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {daily && <ChartCard chart={daily} accent="ai" index={1} className={side.length ? 'lg:col-span-8' : 'lg:col-span-12'} />}
          {side.length > 0 && (
            <div className={cn('flex min-w-0 flex-col gap-3', daily ? 'lg:col-span-4' : 'lg:col-span-12')}>
              {side.map((c, i) => <ChartCard key={c.key} chart={c} accent="ai" index={2 + i} className="flex-1" />)}
            </div>
          )}
          {wide.map((c, i) => <ChartCard key={c.key} chart={c} accent="ai" index={4 + i} columns className="lg:col-span-12" />)}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-[#e7defb] bg-white p-6 text-center text-sm" style={{ color: INK.muted }}>No AI calls recorded in this period.</p>
      )}
    </motion.section>
  );
}
