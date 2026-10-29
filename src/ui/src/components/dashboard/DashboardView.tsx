import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Sector, Tooltip, Treemap, XAxis, YAxis,
} from 'recharts';
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import { BarChart3, Filter, LayoutGrid, LineChart as LineIcon, PieChart as PieIcon, RefreshCw, Sparkles, Target, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dashboardApi, type DashboardChart, type DashboardKpi, type DashboardPayload } from '../../lib/api';
import { cn } from '../../lib/cn';
import { AnalyticsBento } from '../ui/analytics-bento';

const COLORS = ['#770816', '#c9a227', '#1e4a80', '#2f8a4c', '#7c3aed', '#0f766e', '#d97706', '#64748b', '#be185d', '#0369a1'];
const TONE: Record<NonNullable<DashboardKpi['tone']>, { text: string; ring: string }> = {
  good: { text: 'text-green-700', ring: '#2f8a4c' },
  warn: { text: 'text-amber-600', ring: '#d97706' },
  bad: { text: 'text-red-600', ring: '#dc2626' },
  neutral: { text: 'text-gray-900', ring: '#770816' },
};
const EASE = 'ease-out';
const DURATION = 900;

type ViewType = 'bar' | 'hbar' | 'pie' | 'area' | 'line' | 'radial' | 'funnel' | 'treemap';

/** Counts up to a number when the card appears (and whenever the value changes). */
function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const [text, setText] = useState('0');
  useEffect(() => {
    const decimals = Number.isInteger(value) ? 0 : 1;
    const controls = animate(mv, value, {
      duration: 1.1,
      ease: 'easeOut',
      onUpdate: (v) => setText(v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })),
    });
    return () => controls.stop();
  }, [value, mv]);
  return <>{text}</>;
}

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0">
      <circle cx="24" cy="24" r={r} fill="none" stroke="#f1e6e8" strokeWidth="5" />
      <motion.circle
        cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - Math.min(100, Math.max(0, pct)) / 100) }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="28" textAnchor="middle" fontSize="11" fontWeight="700" fill="#374151">{Math.round(pct)}%</text>
    </svg>
  );
}

/** `accent` recolours the cards' top bar so a section (e.g. AI) reads as its own group. */
export function KpiGrid({ kpis, accent }: { kpis: DashboardKpi[]; accent?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
      {kpis.map((k, i) => {
        const tone = TONE[k.tone ?? 'neutral'];
        return (
          <motion.div
            key={k.key}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            whileHover={{ y: -3 }}
            transition={{ delay: i * 0.05, duration: 0.35, type: 'spring', stiffness: 260, damping: 22 }}
            className="relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-brand-100/60 bg-white p-4 shadow-sm shadow-brand-900/5 transition-shadow hover:shadow-md"
          >
            <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: accent ?? tone.ring, opacity: accent ? 0.9 : 0.55 }} />
            <div className="min-w-0">
              <p className={cn('text-2xl font-bold', tone.text)}>
                {typeof k.value === 'number' ? <CountUp value={k.value} /> : k.value}
              </p>
              <p className="mt-0.5 text-sm text-gray-600">{k.label}</p>
              {k.hint && <p className="text-xs text-gray-400">{k.hint}</p>}
            </div>
            {k.gauge !== undefined && <Ring pct={k.gauge} color={tone.ring} />}
          </motion.div>
        );
      })}
    </div>
  );
}

// ── chart variants ─────────────────────────────────────────────────

type Sz = { width?: number; height?: number };
const tick = { fontSize: 11, fill: '#6b7280' };
const tooltipStyle = { borderRadius: 10, border: '1px solid #eadcde', boxShadow: '0 6px 20px rgba(60,10,20,.12)', fontSize: 12 };

/** Called as a plain function: recharts drops custom components that are placed inside a chart. */
function gradientDefs(n: number) {
  return (
    <defs>
      {Array.from({ length: n }).map((_, i) => (
        <linearGradient key={i} id={`g${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.95} />
          <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.45} />
        </linearGradient>
      ))}
      {Array.from({ length: n }).map((_, i) => (
        <linearGradient key={`a${i}`} id={`ga${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.55} />
          <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.04} />
        </linearGradient>
      ))}
    </defs>
  );
}

function ActiveSector(props: unknown) {
  const p = props as { cx: number; cy: number; innerRadius: number; outerRadius: number; startAngle: number; endAngle: number; fill: string };
  return <Sector cx={p.cx} cy={p.cy} innerRadius={p.innerRadius} outerRadius={p.outerRadius + 8} startAngle={p.startAngle} endAngle={p.endAngle} fill={p.fill} />;
}

function PieView({ chart, width, height }: { chart: DashboardChart } & Sz) {
  const [active, setActive] = useState<number | undefined>(undefined);
  const total = chart.data.reduce((n, d) => n + Number(d.value ?? 0), 0);
  const hovered = active !== undefined ? chart.data[active] : undefined;
  return (
    <PieChart width={width} height={height}>
      <Pie
        data={chart.data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={3}
        activeIndex={active} activeShape={ActiveSector}
        onMouseEnter={(_, i) => setActive(i)} onMouseLeave={() => setActive(undefined)}
        isAnimationActive animationDuration={DURATION} animationEasing={EASE} startAngle={90} endAngle={-270}
      >
        {chart.data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth={2} />)}
      </Pie>
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" fontSize="24" fontWeight="700" fill="#1f1a1b">
        {hovered ? Number(hovered.value) : total}
      </text>
      <text x="50%" y="58%" textAnchor="middle" fontSize="11" fill="#6b7280">{hovered ? String(hovered.name) : 'total'}</text>
      <Tooltip contentStyle={tooltipStyle} />
      <Legend wrapperStyle={{ fontSize: 12 }} />
    </PieChart>
  );
}

function RadialView({ chart, width, height }: { chart: DashboardChart } & Sz) {
  const max = Math.max(1, ...chart.data.map((d) => Number(d.value ?? 0)));
  const data: { name: string; value: number; fill: string; pct: number }[] = chart.data.map((d, i) => ({
    name: String(d.name), value: Number(d.value), fill: COLORS[i % COLORS.length], pct: (Number(d.value) / max) * 100,
  }));
  return (
    <RadialBarChart width={width} height={height} data={data} innerRadius="22%" outerRadius="95%" startAngle={90} endAngle={-270} barSize={12}>
      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
      <RadialBar dataKey="pct" background={{ fill: '#f5eced' }} cornerRadius={8} isAnimationActive animationDuration={DURATION + 200} animationEasing={EASE} />
      <Tooltip contentStyle={tooltipStyle} formatter={(_v, _n, item) => [(item.payload as { value: number }).value, (item.payload as { name: string }).name]} />
      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} payload={data.map((d) => ({ value: `${d.name} (${d.value})`, type: 'circle' as const, color: d.fill, id: String(d.name) }))} />
    </RadialBarChart>
  );
}

function FunnelView({ chart, width, height }: { chart: DashboardChart } & Sz) {
  const data = [...chart.data].sort((a, b) => Number(b.value) - Number(a.value)).map((d, i) => ({ ...d, fill: COLORS[i % COLORS.length] }));
  return (
    <FunnelChart width={width} height={height}>
      <Tooltip contentStyle={tooltipStyle} />
      <Funnel data={data} dataKey="value" nameKey="name" isAnimationActive animationDuration={DURATION} animationEasing={EASE}>
        <LabelList position="right" fill="#374151" stroke="none" dataKey="name" fontSize={12} />
        <LabelList position="center" fill="#fff" stroke="none" dataKey="value" fontSize={13} fontWeight={700} />
      </Funnel>
    </FunnelChart>
  );
}

function TreemapCell(props: Record<string, unknown>) {
  const { x, y, width, height, index, name, size } = props as { x: number; y: number; width: number; height: number; index: number; name: string; size: number };
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={6} fill={COLORS[(index ?? 0) % COLORS.length]} stroke="#fff" strokeWidth={3} opacity={0.92} />
      {width > 56 && height > 36 && (
        <>
          <text x={x + 8} y={y + 20} fill="#fff" fontSize={12} fontWeight={600}>{name}</text>
          <text x={x + 8} y={y + 36} fill="#fff" fontSize={11} opacity={0.85}>{size}</text>
        </>
      )}
    </g>
  );
}

function TreemapView({ chart, width, height }: { chart: DashboardChart } & Sz) {
  const data = chart.data.map((d) => ({ name: String(d.name), size: Number(d.value) }));
  return <Treemap width={width} height={height} data={data} dataKey="size" aspectRatio={4 / 3} isAnimationActive animationDuration={DURATION} content={<TreemapCell />} />;
}

function CartesianView({ chart, type, width, height }: { chart: DashboardChart; type: 'bar' | 'hbar' | 'area' | 'line' } & Sz) {
  const series = chart.series ?? [{ key: 'value', label: chart.title }];
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = series.filter((s) => !hidden.has(s.key));
  const legendClick = (o: { dataKey?: unknown }) => {
    const k = String(o.dataKey);
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else if (series.length - n.size > 1) n.add(k);
      return n;
    });
  };
  const legend = series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12, cursor: 'pointer' }} onClick={legendClick} /> : null;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#f0e6e8" vertical={false} />;
  const anim = { isAnimationActive: true, animationDuration: DURATION, animationEasing: EASE } as const;

  if (type === 'hbar') {
    return (
      <BarChart width={width} height={height} data={chart.data} layout="vertical" margin={{ left: 8, right: 24 }}>
        {gradientDefs(series.length)}
        <CartesianGrid strokeDasharray="3 3" stroke="#f0e6e8" horizontal={false} />
        <XAxis type="number" tick={tick} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={130} tick={tick} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(119,8,22,0.05)' }} />
        {legend}
        {shown.map((s) => {
          const i = series.indexOf(s);
          return <Bar key={s.key} dataKey={s.key} name={s.label} fill={`url(#g${i})`} radius={[0, 8, 8, 0]} {...anim} />;
        })}
      </BarChart>
    );
  }
  if (type === 'area') {
    return (
      <AreaChart width={width} height={height} data={chart.data} margin={{ left: -10, right: 12 }}>
        {gradientDefs(series.length)}
        {grid}
        <XAxis dataKey="name" tick={tick} />
        <YAxis tick={tick} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        {legend}
        {shown.map((s) => {
          const i = series.indexOf(s);
          return <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} fill={`url(#ga${i})`} {...anim} />;
        })}
      </AreaChart>
    );
  }
  if (type === 'line') {
    return (
      <LineChart width={width} height={height} data={chart.data} margin={{ left: -10, right: 12 }}>
        {grid}
        <XAxis dataKey="name" tick={tick} />
        <YAxis tick={tick} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        {legend}
        {shown.map((s) => {
          const i = series.indexOf(s);
          return <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={3} dot={{ r: 3.5, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6 }} {...anim} />;
        })}
      </LineChart>
    );
  }
  return (
    <BarChart width={width} height={height} data={chart.data} margin={{ left: -10, right: 12 }}>
      {gradientDefs(series.length)}
      {grid}
      <XAxis dataKey="name" tick={tick} interval={0} />
      <YAxis tick={tick} allowDecimals />
      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(119,8,22,0.05)' }} />
      {legend}
      {shown.map((s) => {
        const i = series.indexOf(s);
        return <Bar key={s.key} dataKey={s.key} name={s.label} fill={`url(#g${i})`} radius={[8, 8, 0, 0]} {...anim} />;
      })}
    </BarChart>
  );
}

// ── card with a view switcher ──────────────────────────────────────

const VIEW_META: Record<ViewType, { label: string; icon: React.ReactNode }> = {
  bar: { label: 'Columns', icon: <BarChart3 size={14} /> },
  hbar: { label: 'Bars', icon: <BarChart3 size={14} className="rotate-90" /> },
  pie: { label: 'Donut', icon: <PieIcon size={14} /> },
  area: { label: 'Area', icon: <LineIcon size={14} /> },
  line: { label: 'Line', icon: <LineIcon size={14} /> },
  radial: { label: 'Rings', icon: <Target size={14} /> },
  funnel: { label: 'Funnel', icon: <Filter size={14} /> },
  treemap: { label: 'Blocks', icon: <LayoutGrid size={14} /> },
};

function viewsFor(chart: DashboardChart): ViewType[] {
  const series = chart.series?.length ?? 1;
  const base = chart.type === 'stacked' ? 'area' : (chart.type as ViewType);
  if (series > 1) return Array.from(new Set<ViewType>([base, 'bar', 'area', 'line']));
  if (base === 'area' || base === 'line') return ['area', 'line', 'bar'];
  const cats = chart.data.length;
  const out: ViewType[] = [base];
  for (const v of ['pie', 'bar', 'hbar', 'radial', 'treemap', 'funnel'] as ViewType[]) if (!out.includes(v)) out.push(v);
  return cats >= 2 ? out : [base];
}

function Body({ chart, view }: { chart: DashboardChart; view: ViewType }) {
  switch (view) {
    case 'pie': return <PieView chart={chart} />;
    case 'radial': return <RadialView chart={chart} />;
    case 'funnel': return <FunnelView chart={chart} />;
    case 'treemap': return <TreemapView chart={chart} />;
    default: return <CartesianView chart={chart} type={view} />;
  }
}

export function ChartCard({ chart, index = 0 }: { chart: DashboardChart; index?: number }) {
  const views = useMemo(() => viewsFor(chart), [chart]);
  const [view, setView] = useState<ViewType>(views[0]);
  const wide = chart.type === 'area' || chart.type === 'stacked' || chart.type === 'line';
  const current = views.includes(view) ? view : views[0];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={{ y: -2 }}
      transition={{ delay: 0.12 + index * 0.06, duration: 0.45, type: 'spring', stiffness: 200, damping: 24 }}
      className={cn('rounded-2xl border border-brand-100/60 bg-white p-4 shadow-sm shadow-brand-900/5 transition-shadow hover:shadow-md', wide && 'xl:col-span-2')}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">{chart.title}</h3>
          {chart.subtitle && <p className="text-xs text-gray-400">{chart.subtitle}</p>}
        </div>
        {views.length > 1 && (
          <div className="flex shrink-0 gap-0.5 rounded-lg bg-gray-100 p-0.5">
            {views.map((v) => (
              <button
                key={v} type="button" onClick={() => setView(v)} title={VIEW_META[v].label} aria-label={VIEW_META[v].label}
                className={cn('relative rounded-md p-1.5 text-gray-500 transition-colors hover:text-gray-800', current === v && 'text-brand-800')}
              >
                {current === v && <motion.span layoutId={`pill-${chart.key}`} className="absolute inset-0 rounded-md bg-white shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
                <span className="relative">{VIEW_META[v].icon}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 h-72 w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22 }}
            className="h-full w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              {Body({ chart, view: current })}
            </ResponsiveContainer>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** Loads the caller's role-specific dashboard and renders its KPIs and charts. */
export function DashboardView({ withRange = true }: { withRange?: boolean }) {
  const [days, setDays] = useState(180);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => dashboardApi.get(days),
    refetchInterval: 120_000,
    placeholderData: (prev) => prev,
  });
  const d = data?.data;
  const bentoQuery = useQuery({
    queryKey: ['dashboard-bento', days],
    queryFn: () => dashboardApi.bento(days),
    refetchInterval: 120_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const bento = bentoQuery.data?.data;
  const bentoOk = !!bento && !!bento.revenue?.series?.length && !!bento.seasonality?.years?.length && !!bento.categories?.items?.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Insights</h2>
        <div className="flex items-center gap-2">
          {withRange && (
            <div className="flex rounded-lg bg-gray-100 p-0.5 text-sm">
              {(d?.ranges ?? [30, 90, 180, 365]).map((r) => (
                <button
                  key={r} type="button" onClick={() => setDays(r)}
                  className={cn('relative rounded-md px-3 py-1.5 font-medium text-gray-500 transition-colors hover:text-gray-800', days === r && 'text-brand-800')}
                >
                  {days === r && <motion.span layoutId="range-pill" className="absolute inset-0 rounded-md bg-white shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
                  <span className="relative">{r}d</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => refetch()} className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-gray-50" aria-label="Refresh">
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isLoading && <p className="py-8 text-center text-sm text-gray-400">Loading insights…</p>}
      {error && <p className="py-4 text-center text-sm text-red-500">Could not load the dashboard.</p>}
      {d && (
        <>
          {d.ai && <SectionHeading className="text-brand-800" icon={<Users size={15} />} title="Transfer operations" subtitle="Requests, students and reviews handled by people" />}
          <KpiGrid key={`k-${d.days}`} kpis={d.kpis} />
          {bentoOk ? (
            <AnalyticsBento className="w-full" {...bento} currency={bento.currency ?? ''} credit={false} fontFamily="inherit" />
          ) : bentoQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-gray-400">Loading charts…</p>
          ) : d.charts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
              Charts appear here as soon as there is data to show.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {d.charts.map((c, i) => <ChartCard key={`${c.key}-${d.days}`} chart={c} index={i} />)}
            </div>
          )}
          {d.ai && <AiSection ai={d.ai} days={d.days} />}
        </>
      )}
    </div>
  );
}

function SectionHeading({ icon, title, subtitle, className }: { icon: React.ReactNode; title: string; subtitle?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-current/10">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

const AI_ACCENT = '#7c3aed';

/** AI usage and spend, visually separated from the regular operations numbers above. */
function AiSection({ ai, days }: { ai: NonNullable<DashboardPayload['ai']>; days: number }) {
  return (
    <section className="space-y-4 rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading
          className="text-violet-800"
          icon={<Sparkles size={15} />}
          title="AI agents"
          subtitle={`Work done by AI and its estimated cost (last ${days} days)`}
        />
        <Link to="/superadmin/settings/ai-controls" className="text-xs font-medium text-violet-700 hover:underline">
          Open AI Controls →
        </Link>
      </div>
      {ai.kpis.length > 0 && <KpiGrid key={`ai-k-${days}`} kpis={ai.kpis} accent={AI_ACCENT} />}
      {ai.charts.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {ai.charts.map((c, i) => <ChartCard key={`${c.key}-${days}`} chart={c} index={i} />)}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-violet-200 bg-white p-6 text-center text-sm text-gray-400">
          No AI calls recorded in this period.
        </p>
      )}
    </section>
  );
}
