/**
 * Small, hand-built chart primitives for the dashboards (plain SVG + framer-motion).
 *
 * Colour rules (validated with the dataviz palette checker against a white surface):
 * - CATEGORICAL is a fixed order, assigned in sequence, never cycled past its length
 *   (worst adjacent CVD dE 16.7, normal-vision dE >= 15, every slot >= 3:1 on white).
 * - BRAND_RAMP / AI_RAMP are one-hue ordinal ramps (dark = first/best), light end >= 2:1.
 * - Text always uses the ink tokens, never a series colour.
 * The app has no dark theme, so only the light steps are defined.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus, Table2 } from 'lucide-react';
import { cn } from '../../lib/cn';

// ── tokens ─────────────────────────────────────────────────────────
export const INK = { primary: '#1d1517', secondary: '#5b5153', muted: '#8b8183' };
export const GRID = '#efe9ea';
export const AXIS = '#d9d0d2';
export const NEUTRAL = '#cdc5c7';
export const DEEMPH = '#bfb6b8';
export const BRAND = '#770816';
export const AI = '#7c3aed';
export const CATEGORICAL = ['#a3243c', '#c98500', '#2a78d6', '#0f8a6a', '#6250d6', '#d4608a'];
export const BRAND_RAMP = ['#5c0712', '#88152f', '#b52a45', '#d9566c', '#e98596'];
export const AI_RAMP = ['#4c1d95', '#6d28d9', '#8b5cf6', '#a78bfa'];
const GOOD_INK = '#0f6b2e';
const BAD_INK = '#b42318';

export type Accent = 'brand' | 'ai';
export const accentColor = (a: Accent = 'brand') => (a === 'ai' ? AI : BRAND);

// ── formatting ─────────────────────────────────────────────────────
export type Unit = 'count' | 'usd' | 'pct' | 'days' | 'ms';

export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}K`;
  return Number.isInteger(n) ? n.toLocaleString('en-US') : (+n.toFixed(1)).toLocaleString('en-US');
}

export function usd(n: number): string {
  if (n === 0) return '$0';
  const a = Math.abs(n);
  if (a < 0.01) return `$${n.toPrecision(2)}`;
  if (a < 1) return `$${n.toFixed(a >= 0.1 ? 2 : 3)}`;
  if (a >= 1e4) return `$${compact(n)}`;
  return `$${n.toFixed(2)}`;
}

/** Splits a value into the number and a quieter unit suffix. */
export function formatValue(n: number, unit: Unit = 'count'): { main: string; suffix?: string } {
  switch (unit) {
    case 'usd': return { main: usd(n) };
    case 'pct': return { main: `${Math.round(n)}`, suffix: '%' };
    case 'days': return { main: (+n.toFixed(1)).toString(), suffix: n === 1 ? 'day' : 'days' };
    case 'ms': return n >= 1000 ? { main: (n / 1000).toFixed(1), suffix: 's' } : { main: String(Math.round(n)), suffix: 'ms' };
    default: return { main: compact(n) };
  }
}

export const fmtNum = (n: number, unit: Unit = 'count') => {
  const f = formatValue(n, unit);
  return f.suffix ? `${f.main}${f.suffix === '%' ? '' : ' '}${f.suffix}` : f.main;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM' -> 'Oct', 'YYYY-MM-DD' -> 'Oct 3'; anything else unchanged. */
export function shortLabel(s: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (!m) return s;
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  if (m[3]) return `${mon} ${Number(m[3])}`;
  return withYear ? `${mon} ${m[1].slice(2)}` : mon;
}
export const isDateLike = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(s);

// ── hooks ──────────────────────────────────────────────────────────
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * p;
}
/** Clean axis ticks from 0: a "nice" step (1/2/2.5/5 x 10^n) so labels are round numbers, about `count` steps. */
function ticks(max: number, count = 3): number[] {
  if (max <= 0) return [0, 1];
  const step = niceMax(max / count);
  const n = Math.max(1, Math.ceil(max / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => +(step * i).toPrecision(6));
}

// ── tooltip ────────────────────────────────────────────────────────
export interface TipRow { color?: string; kind?: 'line' | 'rect'; value: string; label: string }
export interface TipState { x: number; y: number; title?: string; rows: TipRow[] }

/** Value first and strong, label second; positioned inside a `relative` parent and kept on-screen. */
export function Tip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width - 170;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 min-w-[120px] max-w-[220px] rounded-lg border border-[#ece4e6] bg-white/95 px-2.5 py-2 text-xs shadow-[0_8px_24px_-12px_rgba(40,10,16,.35)] backdrop-blur"
      style={{ left: flip ? undefined : tip.x + 12, right: flip ? width - tip.x + 12 : undefined, top: Math.max(0, tip.y - 12) }}
    >
      {tip.title && <p className="mb-1 font-medium" style={{ color: INK.muted }}>{tip.title}</p>}
      {tip.rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 leading-5">
          {r.color && (r.kind === 'rect'
            ? <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: r.color }} />
            : <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />)}
          <span className="font-semibold tabular-nums" style={{ color: INK.primary }}>{r.value}</span>
          <span className="truncate" style={{ color: INK.secondary }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── card ───────────────────────────────────────────────────────────
export interface TableView { columns: string[]; rows: (string | number)[][] }

export function Card({
  title, subtitle, aside, table, children, className, delay = 0,
}: { title: string; subtitle?: string; aside?: ReactNode; table?: TableView; children: ReactNode; className?: string; delay?: number }) {
  const [asTable, setAsTable] = useState(false);
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn('min-w-0 rounded-xl border border-[#ece4e6] bg-white p-4', className)}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold tracking-[-0.005em]" style={{ color: INK.primary }}>{title}</h3>
          {subtitle && <p className="truncate text-xs" style={{ color: INK.muted }}>{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aside}
          {table && (
            <button
              type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}
              aria-label={asTable ? 'Show chart' : 'Show as table'} title={asTable ? 'Show chart' : 'Show as table'}
              className={cn('rounded-md p-1 text-[#8b8183] transition-colors hover:bg-[#f6f1f2] hover:text-[#1d1517]', asTable && 'bg-[#f6f1f2] text-[#1d1517]')}
            >
              <Table2 size={14} />
            </button>
          )}
        </div>
      </header>
      {asTable && table ? <DataTableView table={table} /> : children}
    </motion.section>
  );
}

function DataTableView({ table }: { table: TableView }) {
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>{table.columns.map((c, i) => <th key={i} className={cn('sticky top-0 bg-white pb-1.5 font-medium', i ? 'text-right' : 'text-left')} style={{ color: INK.muted }}>{c}</th>)}</tr>
        </thead>
        <tbody className="tabular-nums">
          {table.rows.map((r, i) => (
            <tr key={i} className="border-t border-[#f3eeef]">
              {r.map((c, j) => <td key={j} className={cn('py-1', j ? 'text-right' : 'text-left')} style={{ color: j ? INK.primary : INK.secondary }}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── delta + meter + sparkline ──────────────────────────────────────
export function Delta({ value, good, label, className }: { value: number | null | undefined; good?: 'up' | 'down'; label?: string; className?: string }) {
  if (value === undefined) return null;
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn('text-[11px]', className)} style={{ color: INK.muted }}>no prior data</span>;
  }
  const flat = Math.abs(value) < 0.005;
  const up = value > 0;
  const tone = flat || !good ? INK.secondary : (up === (good === 'up') ? GOOD_INK : BAD_INK);
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const pct = Math.abs(value) >= 10 ? `${Math.round(value * 100).toLocaleString('en-US')}%` : `${(Math.abs(value) * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%`;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', className)} style={{ color: tone }}>
      <Icon size={12} strokeWidth={2.5} aria-hidden />
      <span>{flat ? '0%' : `${up ? '+' : '−'}${pct.replace('-', '')}`}</span>
      {label && <span className="ml-1 font-normal" style={{ color: INK.muted }}>{label}</span>}
    </span>
  );
}

/** Thin meter: fill on a lighter step of the same hue. */
export function Meter({ pct, color, label }: { pct: number; color: string; label?: string }) {
  const reduce = useReducedMotion();
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex w-full items-center gap-2" title={label}>
      <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: `color-mix(in oklab, ${color} 14%, white)` }}>
        <motion.div
          className="h-full rounded-full" style={{ background: color }}
          initial={reduce ? false : { width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="text-[11px] tabular-nums" style={{ color: INK.secondary }}>{Math.round(v)}%</span>
    </div>
  );
}

/** Bucket i of n across the last `days` days, as "Sep 12 – Sep 26". */
function bucketRange(i: number, n: number, days: number): string {
  const now = Date.now();
  const span = days / n;
  const start = new Date(now - (n - i) * span * 86_400_000);
  const end = new Date(now - (n - i - 1) * span * 86_400_000);
  const f = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return f(start) === f(end) ? f(end) : `${f(start)} – ${f(end)}`;
}

/** De-emphasised history with the current bucket in the accent; hover reads any bucket. */
export function Sparkline({ values, color, days, unit = 'count', height = 30 }: { values: number[]; color: string; days?: number; unit?: Unit; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  if (!values.length) return null;
  const pad = 4;
  const max = Math.max(...values, 0);
  const min = Math.min(...values) - (Math.max(...values) - Math.min(...values)) * 0.15;
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / span);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const last = values.length - 1;
  const h = hover ?? last;
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {w > 0 && (
        <svg
          width={w} height={height} className="block overflow-visible" aria-hidden
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            setHover(Math.max(0, Math.min(last, Math.round(((e.clientX - r.left - pad) / (w - pad * 2)) * last))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`sp${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.12" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`M${pts.join('L')}L${x(last)},${height}L${x(0)},${height}Z`} fill={`url(#sp${id})`} />
          <polyline points={pts.join(' ')} fill="none" stroke={DEEMPH} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={pts.slice(-2).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
          {hover !== null && <line x1={x(h)} x2={x(h)} y1={0} y2={height} stroke={AXIS} strokeWidth={1} />}
          <circle cx={x(h)} cy={y(values[h])} r={3.5} fill={hover === null ? color : INK.primary} stroke="white" strokeWidth={2} />
        </svg>
      )}
      {hover !== null && (
        <div className="pointer-events-none absolute -top-6 right-0 whitespace-nowrap rounded bg-[#1d1517] px-1.5 py-0.5 text-[10px] text-white tabular-nums">
          {fmtNum(values[hover], unit)}{days ? ` · ${bucketRange(hover, values.length, days)}` : ''}
        </div>
      )}
    </div>
  );
}

// ── column strip (hero) ────────────────────────────────────────────
export function ColumnStrip({
  series, color = BRAND, height = 96, unit = 'count',
}: { series: { label: string; value: number }[]; color?: string; height?: number; unit?: Unit }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const n = series.length;
  const max = Math.max(1, ...series.map((s) => s.value));
  const avg = series.reduce((a, s) => a + s.value, 0) / Math.max(1, n);
  const peak = series.reduce((b, s, i) => (s.value > series[b].value ? i : b), 0);
  const top = 14;
  const slot = w / Math.max(1, n);
  const bw = Math.max(2, Math.min(18, slot - 3));
  const yv = (v: number) => top + (height - top) * (1 - v / max);
  return (
    <div ref={ref} className="relative" style={{ height: height + 18 }} data-hover-demo>
      {w > 0 && (
        <svg width={w} height={height + 18} className="block overflow-visible" role="img" aria-label={`Daily values, peak ${series[peak]?.value} on ${series[peak]?.label}`}>
          {series.map((s, i) => {
            const h = Math.max(s.value > 0 ? 2 : 0, height - yv(s.value));
            const x = i * slot + (slot - bw) / 2;
            const r = Math.min(4, bw / 2, h);
            const isLast = i === n - 1;
            const fill = hover === i || isLast ? color : `color-mix(in oklab, ${color} 40%, white)`;
            return (
              <g key={i}>
                <motion.path
                  d={`M${x},${height} V${height - h + r} Q${x},${height - h} ${x + r},${height - h} H${x + bw - r} Q${x + bw},${height - h} ${x + bw},${height - h + r} V${height} Z`}
                  fill={fill}
                  style={{ transformOrigin: `0px ${height}px`, transformBox: 'view-box' }}
                  initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
                  transition={{ duration: 0.5, delay: reduce ? 0 : i * 0.012, ease: [0.22, 1, 0.36, 1] }}
                />
                <rect
                  x={i * slot} y={0} width={slot} height={height} fill="transparent"
                  onPointerEnter={() => { setHover(i); setTip({ x: x + bw / 2, y: yv(s.value), rows: [{ value: fmtNum(s.value, unit), label: s.label, color, kind: 'rect' }] }); }}
                  onPointerLeave={() => { setHover(null); setTip(null); }}
                />
              </g>
            );
          })}
          <line x1={0} x2={w} y1={height + 0.5} y2={height + 0.5} stroke={AXIS} strokeWidth={1} />
          <line x1={0} x2={w} y1={yv(avg)} y2={yv(avg)} stroke={INK.primary} strokeOpacity={0.45} strokeWidth={1} pointerEvents="none" />
          {n > 0 && (
            <>
              <text x={0} y={height + 14} fontSize={10} fill={INK.muted}>{series[0].label}</text>
              <text x={w} y={height + 14} fontSize={10} fill={INK.muted} textAnchor="end">{series[n - 1].label}</text>
              <g transform={`translate(${w / 2} ${height + 14})`}>
                <line x1={-40} x2={-28} y1={-3.5} y2={-3.5} stroke={INK.primary} strokeOpacity={0.45} strokeWidth={1} />
                <text x={-24} y={0} fontSize={10} fill={INK.muted}>avg {compact(+avg.toFixed(1))} a day</text>
              </g>
              {peak > 2 && peak < n - 3 && series[peak].value > 0 && (
                <text x={peak * slot + slot / 2} y={yv(series[peak].value) - 4} fontSize={10} fontWeight={600} fill={INK.secondary} textAnchor="middle">
                  {compact(series[peak].value)}
                </text>
              )}
            </>
          )}
        </svg>
      )}
      <Tip tip={tip} width={w} />
    </div>
  );
}

// ── line trend (crosshair + direct end labels) ─────────────────────
export interface LineSeries { key: string; label: string; color: string; values: (number | null)[]; area?: boolean; muted?: boolean }

export function LineTrend({
  labels, series, height = 180, unit = 'count', withYear = false,
}: { labels: string[]; series: LineSeries[]; height?: number; unit?: Unit; withYear?: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const gid = useId();
  const n = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const tk = ticks(Math.max(0, ...all));
  const top = tk[tk.length - 1] || 1;
  const narrow = w < 420;
  const left = 30;
  const right = series.length > 1 && !narrow ? 76 : 14;
  const plotW = Math.max(10, w - left - right);
  const plotH = height - 22;
  const x = (i: number) => left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => 6 + (plotH - 6) * (1 - v / top);
  const every = Math.max(1, Math.ceil(n / (narrow ? 4 : 7)));

  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const lastIdx = (vals: (number | null)[]) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i; return -1; };

  // End labels: drop them when two ends would collide (legend + tooltip carry identity instead).
  const ends = series.map((s) => { const i = lastIdx(s.values); return i < 0 ? null : { s, i, y: y(s.values[i] as number) }; }).filter(Boolean) as { s: LineSeries; i: number; y: number }[];
  const collide = ends.some((a, i) => ends.some((b, j) => i < j && Math.abs(a.y - b.y) < 22));
  const showEnds = right > 20 && !collide;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - left) / plotW) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, i)));
  };
  const tip: TipState | null = hi === null ? null : {
    x: x(hi), y: 4, title: shortLabel(labels[hi], true),
    rows: series.filter((s) => s.values[hi] != null).map((s) => ({ color: s.color, value: fmtNum(s.values[hi] as number, unit), label: s.label })),
  };

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: INK.secondary }}>
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      )}
      <div ref={ref} className="relative" style={{ height }}>
        {w > 0 && (
          <svg width={w} height={height} className="block overflow-visible" onPointerMove={onMove} onPointerLeave={() => setHi(null)} role="img" aria-label={series.map((s) => s.label).join(', ')}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={i} id={`lg${gid}${i}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity="0.14" />
                  <stop offset="1" stopColor={s.color} stopOpacity="0.01" />
                </linearGradient>
              ))}
            </defs>
            {tk.map((t, i) => (
              <g key={i}>
                <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke={i === 0 ? AXIS : GRID} strokeWidth={1} />
                <text x={left - 6} y={y(t) + 3} fontSize={10} fill={INK.muted} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {unit === 'usd' ? usd(t) : compact(t)}
                </text>
              </g>
            ))}
            {labels.map((l, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every / 2) ? (
              <text key={i} x={x(i)} y={height - 4} fontSize={10} fill={INK.muted} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}>
                {shortLabel(l, withYear && (i === 0 || l.endsWith('-01')))}
              </text>
            ) : null)}
            {series.map((s, si) => {
              const d = path(s.values);
              const li = lastIdx(s.values);
              const fi = s.values.findIndex((v) => v != null);
              return (
                <g key={s.key}>
                  {s.area && li > fi && (
                    <motion.path d={`${d}L${x(li)},${y(0)}L${x(fi)},${y(0)}Z`} fill={`url(#lg${gid}${si})`}
                      initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.3 }} />
                  )}
                  <motion.path
                    d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                    initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: si * 0.08 }}
                  />
                </g>
              );
            })}
            {ends.map(({ s, i, y: ey }) => (
              <g key={s.key}>
                <circle cx={x(i)} cy={ey} r={4} fill={s.color} stroke="white" strokeWidth={2} />
                {showEnds && (
                  <text x={x(i) + 8} y={ey + 3.5} fontSize={11}>
                    <tspan fontWeight={600} fill={INK.primary}>{fmtNum(s.values[i] as number, unit)}</tspan>
                    <tspan dx={4} fill={INK.muted}>{s.label}</tspan>
                  </text>
                )}
              </g>
            ))}
            {hi !== null && (
              <g>
                <line x1={x(hi)} x2={x(hi)} y1={6} y2={plotH} stroke={INK.muted} strokeWidth={1} opacity={0.5} />
                {series.map((s) => s.values[hi] != null && (
                  <circle key={s.key} cx={x(hi)} cy={y(s.values[hi] as number)} r={4} fill={s.color} stroke="white" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        <Tip tip={tip} width={w} />
      </div>
    </div>
  );
}

// ── grouped columns (small series counts over categories) ─────────
export function Columns({
  labels, series, height = 170, unit = 'count',
}: { labels: string[]; series: { key: string; label: string; color: string; values: number[] }[]; height?: number; unit?: Unit }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const n = labels.length;
  const tk = ticks(Math.max(0, ...series.flatMap((s) => s.values)));
  const top = tk[tk.length - 1] || 1;
  const left = 30;
  const plotW = Math.max(10, w - left - 4);
  const plotH = height - 22;
  const slot = plotW / Math.max(1, n);
  const gap = 2;
  const bw = Math.max(3, Math.min(24, (slot * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = bw * series.length + gap * (series.length - 1);
  const y = (v: number) => 6 + (plotH - 6) * (1 - v / top);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
  const tip: TipState | null = hi === null ? null : {
    x: left + hi * slot + slot / 2, y: 4, title: shortLabel(labels[hi], true),
    rows: series.map((s) => ({ color: s.color, kind: 'rect', value: fmtNum(s.values[hi] ?? 0, unit), label: s.label })),
  };
  return (
    <div>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: INK.secondary }}>
          {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <div ref={ref} className="relative" style={{ height }}>
        {w > 0 && (
          <svg width={w} height={height} className="block overflow-visible" onPointerLeave={() => setHi(null)}>
            {tk.map((t, i) => (
              <g key={i}>
                <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke={i === 0 ? AXIS : GRID} />
                <text x={left - 6} y={y(t) + 3} fontSize={10} fill={INK.muted} textAnchor="end">{unit === 'usd' ? usd(t) : compact(t)}</text>
              </g>
            ))}
            {labels.map((l, i) => {
              const gx = left + i * slot + (slot - groupW) / 2;
              return (
                <g key={i}>
                  {hi === i && <rect x={left + i * slot} y={6} width={slot} height={plotH - 6} fill="#f7f2f3" />}
                  {series.map((s, si) => {
                    const v = s.values[i] ?? 0;
                    const h = Math.max(v > 0 ? 2 : 0, y(0) - y(v));
                    const x0 = gx + si * (bw + gap);
                    const r = Math.min(4, bw / 2, h);
                    return (
                      <motion.path
                        key={s.key}
                        d={`M${x0},${y(0)} V${y(0) - h + r} Q${x0},${y(0) - h} ${x0 + r},${y(0) - h} H${x0 + bw - r} Q${x0 + bw},${y(0) - h} ${x0 + bw},${y(0) - h + r} V${y(0)} Z`}
                        fill={s.color}
                        style={{ transformOrigin: `0px ${y(0)}px`, transformBox: 'view-box' }}
                        initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
                        transition={{ duration: 0.5, delay: reduce ? 0 : i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                      />
                    );
                  })}
                  {(i % every === 0) && (
                    <text x={left + i * slot + slot / 2} y={height - 4} fontSize={10} fill={INK.muted} textAnchor="middle">
                      {truncate(shortLabel(l), Math.max(4, Math.floor((slot * every) / 6)))}
                    </text>
                  )}
                  <rect x={left + i * slot} y={0} width={slot} height={plotH} fill="transparent" onPointerEnter={() => setHi(i)} />
                </g>
              );
            })}
          </svg>
        )}
        <Tip tip={tip} width={w} />
      </div>
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

// ── composition (100% stacked bar + legend) ────────────────────────
export interface Part { name: string; value: number; color: string }

export function Composition({ parts, unit = 'count', title, total }: { parts: Part[]; unit?: Unit; title?: string; total?: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const sum = parts.reduce((a, p) => a + p.value, 0);
  const gap = 2;
  const h = 10;
  const visible = parts.filter((p) => p.value > 0);
  const usable = Math.max(0, w - gap * (visible.length - 1));
  let cursor = 0;
  const segs = visible.map((p) => {
    const sw = sum ? Math.max(2, (p.value / sum) * usable) : 0;
    const s = { p, x: cursor, w: sw };
    cursor += sw + gap;
    return s;
  });
  const hp = hi !== null ? segs[hi] : null;
  return (
    <div>
      {title && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-medium" style={{ color: INK.secondary }}>{title}</span>
          {total && <span className="text-xs tabular-nums" style={{ color: INK.muted }}>{fmtNum(sum, unit)}</span>}
        </div>
      )}
      <div ref={ref} className="relative" style={{ height: h }}>
        {w > 0 && (
          <svg width={w} height={h} className="block overflow-visible" role="img" aria-label={visible.map((p) => `${p.name} ${p.value}`).join(', ')}>
            {segs.map((s, i) => {
              const first = i === 0;
              const last = i === segs.length - 1;
              const r = Math.min(4, s.w / 2);
              const d = `M${s.x + (first ? r : 0)},0 H${s.x + s.w - (last ? r : 0)} ${last ? `Q${s.x + s.w},0 ${s.x + s.w},${r} V${h - r} Q${s.x + s.w},${h} ${s.x + s.w - r},${h}` : `V${h}`} H${s.x + (first ? r : 0)} ${first ? `Q${s.x},${h} ${s.x},${h - r} V${r} Q${s.x},0 ${s.x + r},0` : `V0`} Z`;
              return (
                <motion.path
                  key={s.p.name} d={d} fill={s.p.color} opacity={hi === null || hi === i ? 1 : 0.35}
                  initial={reduce ? false : { opacity: 0 }} animate={{ opacity: hi === null || hi === i ? 1 : 0.35 }}
                  transition={{ duration: 0.25, delay: hi === null && !reduce ? 0.1 + i * 0.05 : 0 }}
                  onPointerEnter={() => setHi(i)} onPointerLeave={() => setHi(null)}
                />
              );
            })}
          </svg>
        )}
        {hp && (
          <Tip width={w} tip={{ x: hp.x + hp.w / 2, y: -46, rows: [{ color: hp.p.color, kind: 'rect', value: `${fmtNum(hp.p.value, unit)} · ${Math.round((hp.p.value / (sum || 1)) * 100)}%`, label: hp.p.name }] }} />
        )}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
        {parts.map((p) => (
          <li
            key={p.name} className="flex min-w-0 items-center gap-1.5 text-[11px]"
            onPointerEnter={() => setHi(visible.indexOf(p) >= 0 ? visible.indexOf(p) : null)} onPointerLeave={() => setHi(null)}
            style={{ opacity: hi === null || segs[hi]?.p === p ? 1 : 0.5 }}
          >
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: p.color }} />
            <span className="truncate" style={{ color: INK.secondary }}>{p.name}</span>
            <span className="ml-auto pl-1 tabular-nums font-medium" style={{ color: INK.primary }}>{fmtNum(p.value, unit)}</span>
            <span className="w-8 text-right tabular-nums" style={{ color: INK.muted }}>{sum ? `${Math.round((p.value / sum) * 100)}%` : '–'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── ranked list ────────────────────────────────────────────────────
export function Ranked({ items, color, unit = 'count', limit = 6, columns = false }: { items: { name: string; value: number }[]; color: string; unit?: Unit; limit?: number; columns?: boolean }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  const shown = open ? items : items.slice(0, limit);
  return (
    <div>
      <ol className={cn('space-y-2', columns && 'sm:grid sm:grid-cols-2 sm:gap-x-8 sm:gap-y-2 sm:space-y-0')}>
        {shown.map((it, i) => (
          <li key={`${it.name}-${i}`} className="group" title={`${it.name}: ${fmtNum(it.value, unit)} (${total ? Math.round((it.value / total) * 100) : 0}% of total)`}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate" style={{ color: INK.secondary }}>
                <span className="mr-1.5 inline-block w-3 text-right tabular-nums" style={{ color: INK.muted }}>{i + 1}</span>
                {it.name}
              </span>
              <span className="shrink-0 font-semibold tabular-nums" style={{ color: INK.primary }}>{fmtNum(it.value, unit)}</span>
            </div>
            <div className="mt-1 ml-[18px] h-1.5 rounded-full bg-[#f5f0f1]">
              <motion.div
                className="h-full rounded-full transition-[filter] group-hover:brightness-90" style={{ background: color }}
                initial={reduce ? false : { width: 0 }} animate={{ width: `${Math.max(it.value > 0 ? 1.5 : 0, (it.value / max) * 100)}%` }}
                transition={{ duration: 0.7, delay: reduce ? 0 : 0.05 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </li>
        ))}
      </ol>
      {items.length > limit && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 ml-[18px] text-[11px] font-medium hover:underline" style={{ color: INK.secondary }}>
          {open ? 'Show fewer' : `+${items.length - limit} more`}
        </button>
      )}
    </div>
  );
}

// ── hour-of-day heat strips (small multiples, one sequential hue) ──
export function HourHeat({ rows, color = BRAND, cellHeight = 22 }: { rows: { label: string; values: number[] }[]; color?: string; cellHeight?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const reduce = useReducedMotion();
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const labelW = 64;
  const cellGap = 2;
  const cw = Math.max(4, (w - labelW - cellGap * 23) / 24);
  const ch = cellHeight;
  const shade = (v: number) => (v <= 0 ? '#f4eff0' : `color-mix(in oklab, ${color} ${Math.round(14 + (v / max) * 86)}%, #fbf7f8)`);
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg width={w} height={rows.length * (ch + 6) + 16} className="block">
          {rows.map((r, ri) => {
            const peak = r.values.reduce((b, v, i) => (v > r.values[b] ? i : b), 0);
            return (
              <g key={r.label} transform={`translate(0 ${ri * (ch + 6)})`}>
                <text x={0} y={ch / 2 + 4} fontSize={11} fill={INK.secondary}>{r.label}</text>
                {r.values.slice(0, 24).map((v, h) => {
                  const x = labelW + h * (cw + cellGap);
                  return (
                    <motion.rect
                      key={h} x={x} y={0} width={cw} height={ch} rx={3} fill={shade(v)}
                      stroke={h === peak && v > 0 ? INK.primary : 'none'} strokeWidth={h === peak && v > 0 ? 1 : 0}
                      initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: reduce ? 0 : ri * 0.1 + h * 0.012 }}
                      onPointerEnter={() => setTip({ x: x + cw / 2, y: ri * (ch + 6) - 30, title: hourLabel(h), rows: [{ color: shade(v), kind: 'rect', value: compact(v), label: r.label }] })}
                      onPointerLeave={() => setTip(null)}
                    />
                  );
                })}
              </g>
            );
          })}
          {[0, 6, 12, 18, 23].map((h) => (
            <text key={h} x={labelW + h * (cw + cellGap) + (h === 23 ? cw : 0)} y={rows.length * (ch + 6) + 10} fontSize={10} fill={INK.muted} textAnchor={h === 23 ? 'end' : 'start'}>
              {h === 23 ? '23h' : `${h}h`}
            </text>
          ))}
        </svg>
      )}
      <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px]" style={{ color: INK.muted }}>
        <span>Fewer</span>
        <span className="h-1.5 w-16 rounded-full" style={{ background: `linear-gradient(90deg, ${shade(0.0001)}, ${shade(max)})` }} />
        <span>More</span>
      </div>
      <Tip tip={tip} width={w} />
    </div>
  );
}

/** Re-renders "x minutes ago" once a minute. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

