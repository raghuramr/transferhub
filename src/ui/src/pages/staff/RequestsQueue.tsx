import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Flag, Inbox, Sparkles } from 'lucide-react';
import { requestsApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/cn';
import { durationLabel, formatDateTime } from '../../components/workflow/RequestTimeline';
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
  const { data, isLoading, error } = useQuery({
    queryKey: ['requests-queue', scope],
    queryFn: () => requestsApi.queue(scope),
    refetchInterval: 60_000,
  });
  const q = data?.data;

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
        </div>
      )}

      {isLoading && <p className="text-gray-400">Loading…</p>}
      {error && <p className="text-red-500">Could not load the queue.</p>}
      {q && q.rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          Nothing is waiting on you right now.
        </div>
      )}

      <ul className="space-y-3">
        {q?.rows.map((r) => (
          <li key={r.stageId}>
            <Link
              to={`/requests/${r.transcriptId}`}
              className="group flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow"
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
