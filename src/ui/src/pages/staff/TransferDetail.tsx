import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Eye } from 'lucide-react';
import { requestsApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import { RequestTimeline, formatDateTime } from '../../components/workflow/RequestTimeline';
import ExchangePanel, { OpenRequestsBanner, useExchange } from '../../components/transfers/ExchangePanel';
import type { TransferBucket } from '../../types/transfers';

const BUCKET_STYLE: Record<TransferBucket, string> = {
  new: 'bg-gray-100 text-gray-700', in_review: 'bg-brand-50 text-brand-800', approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-red-50 text-red-700',
};

/** One transfer as seen by either university: progress, and the document / reminder exchange. */
export default function TransferDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: d, isLoading, error } = useExchange(id!);
  const tl = useQuery({ queryKey: ['request', id], queryFn: () => requestsApi.timeline(id!), retry: false });

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading…</div>;
  if (error || !d) return <div className="p-8 text-center text-red-500">Could not load this transfer.</div>;
  const t = d.transfer;

  return (
    <div className="mx-auto w-[95%] max-w-6xl p-4 sm:p-6">
      <Link to="/transfers" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> Transfers</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.studentName}</h1>
          <p className="mt-1 text-gray-500">{t.source.name} → {t.target.name ?? 'no receiving university set'} · submitted {formatDateTime(t.receivedAt)}</p>
          {t.studentEmail && <p className="mt-0.5 text-xs text-gray-400">{t.studentEmail}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-3 py-1 text-sm font-medium', BUCKET_STYLE[t.bucket])}>{t.bucketLabel}{t.stageName && t.bucket === 'in_review' ? ` · ${t.stageName}` : ''}</span>
          {!d.viewer.readOnly && <Link to={`/requests/${t.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Open full review</Link>}
        </div>
      </div>

      {d.viewer.readOnly && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <Eye size={16} className="mt-0.5 shrink-0" /> This is an outgoing transfer. You can follow its progress, add documents, ask for documents and send reminders; the decision is made by {t.target.name ?? 'the receiving university'}.
        </div>
      )}

      <OpenRequestsBanner transcriptId={t.id} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2"><ExchangePanel transcriptId={t.id} /></div>
        <div className="min-w-0">
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Progress</h2>
            {tl.data?.data.stages.length ? <RequestTimeline stages={tl.data.data.stages} /> : <p className="text-sm text-gray-500">This request has no approval stages yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
