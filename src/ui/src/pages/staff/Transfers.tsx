import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, FileQuestion, Search } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { transfersApi } from '../../lib/transfersApi';
import { cn } from '../../lib/cn';
import type { SummarySide, TransferBucket } from '../../types/transfers';

type Direction = 'incoming' | 'outgoing';

const BUCKET_STYLE: Record<TransferBucket, string> = {
  new: 'bg-gray-100 text-gray-700',
  in_review: 'bg-brand-50 text-brand-800',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
};
const BUCKET_BAR: Record<TransferBucket, string> = { new: 'bg-gray-400', in_review: 'bg-brand-700', approved: 'bg-emerald-600', rejected: 'bg-red-500' };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const weekLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className={cn('text-2xl font-bold text-gray-900', tone)}>{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
    </div>
  );
}

function SidePanel({ s, direction, days }: { s: SummarySide; direction: Direction; days: number }) {
  const max = Math.max(1, ...s.byStatus.map((b) => b.count));
  const stageMax = Math.max(1, ...s.byStage.map((b) => b.count));
  const trend = s.trend.map((t) => ({ week: weekLabel(t.week), count: t.count }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={direction === 'incoming' ? 'Coming in (all time)' : 'Going out (all time)'} value={s.total} />
        <Kpi label="Still open" value={s.open} />
        <Kpi label={`New in the last ${days} days`} value={s.inWindow} />
        <Kpi label="Stage overdue" value={s.overdue} tone={s.overdue ? 'text-red-600' : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-800">By status</h3>
          <ul className="space-y-2">
            {s.byStatus.map((b) => (
              <li key={b.key} className="text-sm">
                <div className="mb-0.5 flex justify-between text-gray-600"><span>{b.label}</span><span className="font-medium text-gray-900">{b.count}</span></div>
                <div className="h-2 rounded-full bg-gray-100"><div className={cn('h-2 rounded-full', BUCKET_BAR[b.key])} style={{ width: `${(b.count / max) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
          {s.byStage.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-sm font-semibold text-gray-800">Waiting in stage</h3>
              <ul className="space-y-2">
                {s.byStage.map((b) => (
                  <li key={b.stage} className="text-sm">
                    <div className="mb-0.5 flex justify-between text-gray-600"><span className="truncate pr-2">{b.stage}</span><span className="font-medium text-gray-900">{b.count}</span></div>
                    <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${(b.count / stageMax) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-gray-800">{direction === 'incoming' ? 'Requests received per week' : 'Requests sent per week'}</h3>
          <p className="mb-2 text-xs text-gray-500">Last {days} days</p>
          {trend.length === 0 ? <p className="py-10 text-center text-sm text-gray-400">No transfers in this period.</p> : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eadcde" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#6b5f61' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b5f61' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#fbe1e4' }} formatter={(v: number) => [v, 'Requests']} />
                  <Bar dataKey="count" fill="#88152f" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {s.counterparts.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{direction === 'incoming' ? 'Top sending universities' : 'Top receiving universities'}</h4>
              <ul className="flex flex-wrap gap-2 text-sm">
                {s.counterparts.map((c) => <li key={c.name} className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{c.name} <span className="font-semibold text-gray-900">{c.count}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Transfers() {
  const [direction, setDirection] = useState<Direction>('incoming');
  const [institutionId, setInstitutionId] = useState<number | undefined>(undefined);
  const [days, setDays] = useState(90);
  const [status, setStatus] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const h = setTimeout(() => { setQ(qInput); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [qInput]);

  const summary = useQuery({ queryKey: ['transfers-summary', institutionId, days], queryFn: async () => (await transfersApi.summary({ institutionId, days })).data, retry: false });
  const list = useQuery({
    queryKey: ['transfers-list', direction, institutionId, status, q, page],
    queryFn: async () => (await transfersApi.list({ direction, institutionId, status: status || undefined, q: q || undefined, page, pageSize: 25 })).data,
    retry: false,
  });
  const sum = summary.data;
  const side = sum ? sum[direction] : null;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const tabBtn = (d: Direction, label: string, icon: React.ReactNode, count?: number) => (
    <button type="button" role="tab" aria-selected={direction === d} onClick={() => { setDirection(d); setPage(1); setStatus(''); }}
      className={cn('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        direction === d ? 'bg-brand-800 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100')}>
      {icon} {label}
      {count != null && <span className={cn('rounded-full px-2 py-0.5 text-xs', direction === d ? 'bg-white/20' : 'bg-gray-100 text-gray-700')}>{count}</span>}
    </button>
  );

  return (
    <div className="mx-auto w-[95%] p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transfers</h1>
          <p className="mt-1 text-gray-500">Students moving out of your university, and into it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sum && sum.scope.institutions.length > 0 && (
            <select aria-label="University" value={institutionId ?? ''} onChange={(e) => { setInstitutionId(e.target.value ? Number(e.target.value) : undefined); setPage(1); }}
              className="max-w-[16rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800">
              <option value="">{sum.scope.unrestricted ? 'All universities' : 'All my universities'}</option>
              {sum.scope.institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          )}
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800">
            {[30, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>
      </div>

      {sum && sum.scope.exchangeReady && sum.documentRequests.waiting > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <FileQuestion size={16} /> {sum.documentRequests.waiting} document request{sum.documentRequests.waiting === 1 ? ' is' : 's are'} waiting on your university.
          {sum.documentRequests.asked > 0 && <span className="text-amber-800/80"> You are waiting on {sum.documentRequests.asked}.</span>}
        </div>
      )}

      <div role="tablist" className="mb-4 inline-flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
        {tabBtn('incoming', 'Incoming', <ArrowDownLeft size={16} />, sum?.incoming.total)}
        {tabBtn('outgoing', 'Outgoing', <ArrowUpRight size={16} />, sum?.outgoing.total)}
      </div>

      {summary.isError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load the summary.</div>}
      {side && <SidePanel s={side} direction={direction} days={sum!.days} />}

      <div className="mt-6 rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search student or university" aria-label="Search"
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[['', 'All'], ['new', 'New'], ['in_review', 'In review'], ['approved', 'Completed'], ['rejected', 'Not approved']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => { setStatus(v); setPage(1); }}
                className={cn('rounded-full px-3 py-1 text-xs font-medium', status === v ? 'bg-brand-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>{l}</button>
            ))}
          </div>
        </div>

        {list.isLoading ? <p className="p-8 text-center text-sm text-gray-400">Loading…</p>
          : list.isError ? <p className="p-8 text-center text-sm text-red-500">Could not load transfers.</p>
          : !list.data?.rows.length ? <p className="p-8 text-center text-sm text-gray-500">No {direction} transfers match.</p> : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="px-4 py-2.5">Student</th><th className="px-3">From</th><th className="px-3">To</th><th className="px-3">Status</th><th className="px-3">Stage</th><th className="px-3 text-center">Courses</th><th className="px-3 text-center">Doc requests</th><th className="px-3">Received</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {list.data.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/70">
                      <td className="px-4 py-2.5"><Link to={`/transfers/${r.id}`} className="font-medium text-brand-800 hover:underline">{r.studentName}</Link></td>
                      <td className="px-3 text-gray-700">{r.sourceName}</td>
                      <td className="px-3 text-gray-700">{r.targetName ?? '-'}</td>
                      <td className="px-3"><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', BUCKET_STYLE[r.bucket])}>{r.bucketLabel}</span></td>
                      <td className="px-3 text-gray-600">{r.stageName ?? '-'}</td>
                      <td className="px-3 text-center text-gray-600">{r.courseCount}</td>
                      <td className="px-3 text-center">{r.openDocRequests > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{r.openDocRequests} open</span> : <span className="text-gray-400">-</span>}</td>
                      <td className="px-3 text-gray-500">{fmtDate(r.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-gray-100 md:hidden">
              {list.data.rows.map((r) => (
                <li key={r.id} className="p-4">
                  <Link to={`/transfers/${r.id}`} className="font-medium text-brand-800 hover:underline">{r.studentName}</Link>
                  <p className="mt-0.5 text-sm text-gray-600">{r.sourceName} → {r.targetName ?? '-'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn('rounded-full px-2.5 py-0.5 font-medium', BUCKET_STYLE[r.bucket])}>{r.bucketLabel}</span>
                    {r.stageName && <span className="text-gray-500">{r.stageName}</span>}
                    {r.openDocRequests > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">{r.openDocRequests} doc request{r.openDocRequests === 1 ? '' : 's'}</span>}
                    <span className="text-gray-400">{fmtDate(r.receivedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5 text-sm text-gray-600">
              <span>{list.data.total} transfer{list.data.total === 1 ? '' : 's'}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40">Previous</button>
                <span>Page {page} of {pages}</span>
                <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
