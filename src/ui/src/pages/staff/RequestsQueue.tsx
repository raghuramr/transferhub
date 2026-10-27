import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCheck, Flag, Inbox, Loader2, Sparkles } from 'lucide-react';
import { requestsApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/cn';
import { durationLabel, formatDateTime } from '../../components/workflow/RequestTimeline';
import DeadlineBadge from '../../components/policy/DeadlineBadge';
import type { Recommendation } from '../../types/workflow';

const REC: Record<Recommendation, { label: string; cls: string }> = {
  approve: { label: 'AI: ready to approve', cls: 'bg-emerald-50 text-emerald-700' },
  review: { label: 'AI: needs a look', cls: 'bg-amber-50 text-amber-700' },
  reject: { label: 'AI: likely reject', cls: 'bg-red-50 text-red-700' },
};

export default function RequestsQueue() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin' || role === 'super_admin';
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [dlFilter, setDlFilter] = useState<'all' | 'soon' | 'overdue'>('all');
  const [sortBy, setSortBy] = useState<'due' | 'deadline'>('due');
  const { data, isLoading, error } = useQuery({
    queryKey: ['requests-queue', scope],
    queryFn: () => requestsApi.queue(scope),
    refetchInterval: 60_000,
  });
  const q = data?.data;
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rank = (r: { deadline?: { daysLeft: number | null; state: string } | null }) => (r.deadline && r.deadline.state !== 'unknown' && r.deadline.daysLeft != null ? r.deadline.daysLeft : Infinity);
  const allRows = q?.rows ?? [];
  const soonCount = allRows.filter((r) => ['due_soon', 'urgent'].includes(r.deadline?.state ?? '')).length;
  const overdueDlCount = allRows.filter((r) => r.deadline?.state === 'overdue').length;
  const visibleRows = allRows
    .filter((r) => dlFilter === 'all' || (dlFilter === 'overdue' ? r.deadline?.state === 'overdue' : ['due_soon', 'urgent', 'overdue'].includes(r.deadline?.state ?? '')))
    .sort((a, b) => (sortBy === 'deadline' ? rank(a) - rank(b) : 0));
  const readyIds = (q?.rows ?? []).filter((r) => r.canAct && r.aiRecommendation === 'approve' && r.flagCount === 0).map((r) => r.transcriptId);
  const bulk = useMutation({
    mutationFn: (ids: string[]) => requestsApi.bulkApprove(ids),
    onSuccess: (res) => {
      const { approved, failed, results } = res.data;
      const firstError = results.find((r) => !r.ok)?.message;
      setBanner({ ok: failed === 0, text: `${approved} approved${failed ? `, ${failed} could not be approved${firstError ? ` (${firstError})` : ''}` : ''}.` });
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['requests-queue'] });
    },
    onError: () => setBanner({ ok: false, text: 'Bulk approve failed. Nothing was changed.' }),
  });

  return (
    <div className="mx-auto w-[95%] max-w-6xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Inbox size={24} /> Approval queue</h1>
          <p className="mt-1 text-gray-500">Requests waiting for your decision. Each one already has the matching and a summary prepared.</p>
        </div>
        {isAdmin && (
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            {(['mine', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={cn('rounded-md px-3 py-1.5 font-medium', scope === s ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-50')}
              >
                {s === 'mine' ? 'Waiting on me' : 'All active'}
              </button>
            ))}
          </div>
        )}
      </div>

      {q && (
        <div className="mb-5 flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">{q.total} waiting</span>
          {q.overdue > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 font-medium text-red-700">
              <AlertTriangle size={13} /> {q.overdue} overdue
            </span>
          )}
          {overdueDlCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 font-medium text-red-700">{overdueDlCount} past credit deadline</span>}
          {soonCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-800">{soonCount} deadline within 90 days</span>}
        </div>
      )}

      {q && q.rows.some((r) => r.deadline && r.deadline.state !== 'unknown') && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-500">Credit deadline:</span>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {([['all', 'All'], ['soon', 'Due soon or overdue'], ['overdue', 'Overdue']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setDlFilter(k)} className={cn('rounded-md px-3 py-1 font-medium', dlFilter === k ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-50')}>{l}</button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-gray-500">Sort
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'due' | 'deadline')} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700">
              <option value="due">Stage due date</option>
              <option value="deadline">Credit deadline (soonest first)</option>
            </select>
          </label>
        </div>
      )}

      {banner && (
        <div className={cn('mb-4 flex items-start justify-between rounded-lg p-3 text-sm', banner.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
          <span>{banner.text}</span><button type="button" onClick={() => setBanner(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {q && q.rows.some((r) => r.canAct) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <button type="button" disabled={readyIds.length === 0} onClick={() => setSelected(new Set(readyIds))} className="font-medium text-brand-800 hover:underline disabled:text-gray-400 disabled:no-underline">
            Select the {readyIds.length} that are ready to approve
          </button>
          {selected.size > 0 && (
            <>
              <button
                type="button"
                disabled={bulk.isPending}
                onClick={() => window.confirm(`Approve ${selected.size} request${selected.size === 1 ? '' : 's'} at their current stage?`) && bulk.mutate([...selected])}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulk.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Approve {selected.size}
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-gray-500 hover:underline">Clear</button>
            </>
          )}
        </div>
      )}

      {isLoading && <p className="text-gray-400">Loading…</p>}
      {error && <p className="text-red-500">Could not load the queue.</p>}
      {q && q.rows.length > 0 && visibleRows.length === 0 && <p className="mb-4 text-sm text-gray-500">No requests match this credit-deadline filter.</p>}
      {q && q.rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          Nothing is waiting on you right now.
        </div>
      )}

      <ul className="space-y-3">
        {visibleRows.map((r) => (
          <li key={r.stageId} className="flex items-stretch gap-2">
            <label className={cn('flex w-6 shrink-0 items-center justify-center', !r.canAct && 'opacity-0')}>
              <input type="checkbox" disabled={!r.canAct} checked={selected.has(r.transcriptId)} onChange={() => toggle(r.transcriptId)} className="h-4 w-4 rounded border-gray-300 text-brand-800" aria-label={`Select ${r.studentName}`} />
            </label>
            <Link
              to={`/requests/${r.transcriptId}`}
              className="group flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow"
            >
              <div className="min-w-[12rem] flex-1">
                <div className="font-semibold text-gray-900">{r.studentName}</div>
                <div className="text-sm text-gray-500">{r.institutionName} · {r.courseCount} courses</div>
              </div>
              <div className="min-w-[10rem]">
                <div className="text-sm font-medium text-gray-800">{r.stageName}</div>
                <div className="text-xs text-gray-500">
                  waiting {durationLabel(r.activatedAt, null) ?? '—'}
                  {r.dueAt && <> · due {formatDateTime(r.dueAt)}</>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {r.aiRecommendation && (
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', REC[r.aiRecommendation].cls)}>
                    <Sparkles size={11} /> {REC[r.aiRecommendation].label}
                  </span>
                )}
                {r.flagCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                    <Flag size={11} /> {r.flagCount} flag{r.flagCount > 1 ? 's' : ''}
                  </span>
                )}
                {r.overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">Overdue</span>}
                <DeadlineBadge deadline={r.deadline} />
                {scope === 'all' && !r.assignedToMe && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">Not assigned to you</span>}
              </div>
              <ArrowRight size={18} className="text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
