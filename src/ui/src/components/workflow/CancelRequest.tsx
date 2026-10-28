import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, X } from 'lucide-react';
import { getErrorMessage, transcriptsApi } from '../../lib/api';
import type { CancellationInfo } from '../../types';

const REASONS = [
  'Personal reasons',
  'I chose a different university',
  'I submitted it by mistake',
  'My plans or timing changed',
  'I need to correct my courses first',
  'Other',
];

export interface ProgressNow { coursesTotal: number; coursesDecided: number; creditsAwarded: number; stagesCompleted: number; stagesTotal: number }

export function ProgressLine({ p, className = '' }: { p: ProgressNow; className?: string }) {
  return (
    <ul className={`space-y-0.5 text-sm text-gray-700 ${className}`}>
      <li><span className="font-semibold">{p.coursesDecided}</span> of {p.coursesTotal} courses had a decision</li>
      <li><span className="font-semibold">{p.creditsAwarded}</span> credits accepted so far</li>
      {p.stagesTotal > 0 && <li><span className="font-semibold">{p.stagesCompleted}</span> of {p.stagesTotal} approval steps done</li>}
    </ul>
  );
}

/** Student-facing "cancel this request" dialog. Shows how far the request got, asks for a reason, then cancels. */
export function CancelRequestDialog({ requestId, label, progress, onClose }: { requestId: string; label: string; progress: ProgressNow; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const mut = useMutation({
    mutationFn: () => transcriptsApi.cancel(requestId, { reason, note: note.trim() || undefined }),
    onSuccess: () => {
      for (const k of [['transcript', requestId], ['request', requestId], ['transcripts'], ['student'], ['progress']]) void qc.invalidateQueries({ queryKey: k });
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !mut.isPending && onClose()}>
      <div className="my-8 w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Cancel this request?</h2>
            <p className="mt-0.5 truncate text-sm text-gray-500">{label}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-4">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">How far it got</p>
            <ProgressLine p={progress} />
            <p className="mt-2 text-xs text-gray-500">We keep this summary with the cancelled request. You can start a new request any time.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Why are you cancelling?</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Anything else we should know? <span className="font-normal text-gray-400">(optional)</span></label>
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          {mut.isError && <p className="text-sm text-red-600">{getErrorMessage(mut.error, 'Could not cancel the request.')}</p>}
        </div>
        <div className="flex gap-2 border-t border-gray-200 p-4">
          <button onClick={onClose} disabled={mut.isPending} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50">Keep my request</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:bg-red-300">
            <Ban size={14} /> {mut.isPending ? 'Cancelling…' : 'Cancel request'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown on a cancelled request: when, why, and how far it got. */
export function CancelledBanner({ info }: { info: CancellationInfo }) {
  return (
    <div className="mb-6 rounded-xl border border-gray-300 bg-gray-50 p-5" data-testid="cancelled-banner">
      <p className="flex items-center gap-2 font-semibold text-gray-800"><Ban size={16} className="text-gray-500" /> This request was cancelled</p>
      <p className="mt-1 text-sm text-gray-600">
        {new Date(info.cancelledAt).toLocaleDateString()}{info.reason ? ` · ${info.reason}` : ''}
        {info.note ? <span className="block text-gray-500">&ldquo;{info.note}&rdquo;</span> : null}
      </p>
      {info.progress && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">How far it got{info.progress.stoppedAt ? ` (stopped at "${info.progress.stoppedAt}")` : ''}</p>
          <ProgressLine p={info.progress} className="mt-1" />
        </div>
      )}
    </div>
  );
}
