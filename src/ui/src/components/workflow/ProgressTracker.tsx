import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Check, Clock, FastForward, Minus, Timer, Undo2, Users, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { TimelineStage } from '../../types/workflow';
import { agoLabel, approxDuration, estimateFinish, statusSentence, trackerStages } from '../../lib/tracker';
import { LiveIndicator } from '../live/LiveIndicator';

const DOT: Record<string, string> = {
  pending: 'border-gray-300 bg-white text-gray-400',
  active: 'border-brand-700 bg-brand-700 text-white',
  approved: 'border-emerald-600 bg-emerald-600 text-white',
  bypassed: 'border-violet-500 bg-violet-500 text-white',
  rejected: 'border-red-600 bg-red-600 text-white',
  returned: 'border-amber-500 bg-amber-500 text-white',
  skipped: 'border-gray-300 bg-gray-100 text-gray-400',
};
const LINE_DONE = 'bg-emerald-500';

function StepIcon({ s }: { s: TimelineStage }) {
  if (s.status === 'approved') return <Check size={16} strokeWidth={3} />;
  if (s.status === 'bypassed') return <FastForward size={15} />;
  if (s.status === 'rejected') return <X size={16} strokeWidth={3} />;
  if (s.status === 'returned') return <Undo2 size={15} />;
  if (s.status === 'active') return <Clock size={16} />;
  return s.type === 'system' ? <Bot size={15} /> : <Minus size={14} />;
}

/**
 * "Pizza tracker" for a transfer request, always vertical (easier to read with names, times and who it waits on). Completed steps are
 * checked, the current one pulses with who it is waiting on and since when, and a step animates when a live
 * event changes it. The status sentence is an aria-live region so screen readers hear the changes.
 */
export function ProgressTracker({ stages, workflowStatus }: { stages: TimelineStage[]; workflowStatus?: string | null }) {
  const steps = useMemo(() => trackerStages(stages), [stages]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Highlight the step that just changed (an event arrived) for a moment.
  const [flash, setFlash] = useState<number | null>(null);
  const prev = useRef<Record<number, string>>({});
  useEffect(() => {
    let changed: number | null = null;
    for (const s of steps) {
      if (prev.current[s.id] && prev.current[s.id] !== s.status) changed = s.id;
      prev.current[s.id] = s.status;
    }
    if (changed != null) {
      setFlash(changed);
      const t = setTimeout(() => setFlash(null), 2500);
      return () => clearTimeout(t);
    }
  }, [steps]);

  const estimate = workflowStatus === 'active' || !workflowStatus ? estimateFinish(stages, now) : null;
  const done = steps.filter((s) => s.status === 'approved' || s.status === 'bypassed').length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  return (
    <div data-testid="progress-tracker">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700" aria-live="polite" data-testid="tracker-sentence">{statusSentence(stages, workflowStatus, now)}</p>
        <LiveIndicator />
      </div>

      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Request progress">
        <motion.div className="h-full rounded-full bg-emerald-500" initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      </div>

      <ol className="flex flex-col">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const active = s.status === 'active';
          const completed = s.status === 'approved' || s.status === 'bypassed';
          const waitingOn = s.type === 'system' ? 'Automatic processing' : s.approvers.join(', ') || 'A reviewer';
          return (
            <li key={s.id} className="relative flex gap-3 pb-6 last:pb-0" aria-current={active ? 'step' : undefined}>
              {/* connector drawn from this dot down to the next */}
              {!last && (
                <span aria-hidden className={cn('absolute left-[17px] top-9 bottom-0 w-0.5 rounded-full', completed ? LINE_DONE : 'bg-gray-200')} />
              )}

              <div className="relative z-10 shrink-0">
                {active && (
                  <motion.span aria-hidden className="absolute inset-0 rounded-full bg-brand-500/40" animate={{ scale: [1, 1.7], opacity: [0.7, 0] }} transition={{ repeat: Infinity, duration: 1.8, ease: 'easeOut' }} />
                )}
                <div className={cn('relative flex h-9 w-9 items-center justify-center rounded-full border-2 shadow-sm transition-shadow', DOT[s.status] ?? DOT.pending, flash === s.id && 'ring-4 ring-emerald-200')}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={s.status} initial={{ scale: 0.3, opacity: 0, rotate: -40 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.3, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }} className="flex">
                      <StepIcon s={s} />
                    </motion.span>
                  </AnimatePresence>
                </div>
              </div>

              <div className="min-w-0 flex-1 pt-1.5">
                <p className={cn('text-sm font-semibold', completed || active ? 'text-gray-900' : 'text-gray-500')}>{s.name}</p>
                {completed && <p className="text-xs text-emerald-700">{s.status === 'bypassed' ? 'Not needed' : 'Done'}{s.completedAt ? ` · ${agoLabel(s.completedAt, now)}` : ''}</p>}
                {s.status === 'rejected' && <p className="text-xs text-red-700">Not approved</p>}
                {s.status === 'returned' && <p className="text-xs text-amber-700">Sent back for another look</p>}
                {active && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-0.5 space-y-0.5 text-xs text-gray-600">
                    <p className="flex flex-wrap items-center gap-1"><Users size={12} className="text-gray-400" /> Waiting on: <span className="font-medium text-gray-800">{waitingOn}</span></p>
                    {s.activatedAt && <p className="text-gray-500">since {agoLabel(s.activatedAt, now)}</p>}
                    {s.overdue && <p className="font-medium text-red-600">Taking longer than planned</p>}
                  </motion.div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {estimate && (
        <p className="mt-5 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600" data-testid="tracker-estimate">
          <Timer size={14} className="mr-1.5 inline -mt-0.5 text-gray-400" />
          {estimate.slower && estimate.minutes === 0
            ? 'This step is taking longer than usual.'
            : <>Estimated time to finish: <span className="font-medium text-gray-800">{approxDuration(estimate.minutes)}</span> <span className="text-gray-400">(based on recent requests)</span></>}
        </p>
      )}
    </div>
  );
}
