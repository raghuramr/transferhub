import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { dashboardApi, type DashboardChart, type DashboardKpi } from '../../lib/api';
import { cn } from '../../lib/cn';

const COLORS = ['#770816', '#c9a227', '#1e4a80', '#2f8a4c', '#7c3aed', '#0f766e', '#d97706', '#64748b', '#be185d', '#0369a1'];
const TONE: Record<NonNullable<DashboardKpi['tone']>, string> = {
  good: 'text-green-700',
  warn: 'text-amber-600',
  bad: 'text-red-600',
  neutral: 'text-gray-900',
};

export function KpiGrid({ kpis }: { kpis: DashboardKpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {kpis.map((k, i) => (
        <motion.div
          key={k.key}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.3 }}
          className="rounded-xl border border-brand-100/60 bg-white p-4 shadow-sm shadow-brand-900/5"
        >
          <p className={cn('text-2xl font-bold', TONE[k.tone ?? 'neutral'])}>{k.value}</p>
          <p className="mt-0.5 text-sm text-gray-600">{k.label}</p>
          {k.hint && <p className="text-xs text-gray-400">{k.hint}</p>}
        </motion.div>
      ))}
    </div>
  );
}

function ChartBody({ chart }: { chart: DashboardChart }) {
  const series = chart.series ?? [{ key: 'value', label: chart.title }];
  const tick = { fontSize: 11, fill: '#6b7280' };
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#eee" />;

  if (chart.type === 'pie') {
    return (
      <PieChart>
        <Pie data={chart.data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {chart.data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    );
  }
  if (chart.type === 'hbar') {
    return (
      <BarChart data={chart.data} layout="vertical" margin={{ left: 8, right: 16 }}>
        {grid}
        <XAxis type="number" tick={tick} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={130} tick={tick} />
        <Tooltip />
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={[0, 4, 4, 0]} />)}
      </BarChart>
    );
  }
  if (chart.type === 'area' || chart.type === 'stacked') {
    return (
      <AreaChart data={chart.data} margin={{ left: -10, right: 8 }}>
        {grid}
        <XAxis dataKey="name" tick={tick} />
        <YAxis tick={tick} allowDecimals={false} />
        <Tooltip />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.18} stackId={chart.type === 'stacked' ? 'a' : undefined} />
        ))}
      </AreaChart>
    );
  }
  if (chart.type === 'line') {
    return (
      <LineChart data={chart.data} margin={{ left: -10, right: 8 }}>
        {grid}
        <XAxis dataKey="name" tick={tick} />
        <YAxis tick={tick} allowDecimals={false} />
        <Tooltip />
        {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />)}
      </LineChart>
    );
  }
  return (
    <BarChart data={chart.data} margin={{ left: -10, right: 8 }}>
      {grid}
      <XAxis dataKey="name" tick={tick} interval={0} />
      <YAxis tick={tick} allowDecimals />
      <Tooltip />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
      {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />)}
    </BarChart>
  );
}

export function ChartCard({ chart, index = 0 }: { chart: DashboardChart; index?: number }) {
  const wide = chart.type === 'area' || chart.type === 'stacked' || chart.type === 'line';
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.05, duration: 0.35 }}
      className={cn('rounded-2xl border border-brand-100/60 bg-white p-4 shadow-sm shadow-brand-900/5', wide && 'lg:col-span-2')}
    >
      <h3 className="font-semibold text-gray-900">{chart.title}</h3>
      {chart.subtitle && <p className="mb-2 text-xs text-gray-400">{chart.subtitle}</p>}
      <div className="mt-2 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {ChartBody({ chart })}
        </ResponsiveContainer>
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
  });
  const d = data?.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Insights</h2>
        <div className="flex items-center gap-2">
          {withRange && (
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {(d?.ranges ?? [30, 90, 180, 365]).map((r) => <option key={r} value={r}>Last {r} days</option>)}
            </select>
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
          <KpiGrid kpis={d.kpis} />
          {d.charts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
              Charts appear here as soon as there is data to show.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {d.charts.map((c, i) => <ChartCard key={c.key} chart={c} index={i} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
