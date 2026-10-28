import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Bot, Check, ChevronDown, Clock, FastForward, Lock, MessageSquare, Minus, Sparkles, Undo2, Users, X, Eye,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import type { Recommendation, StageStatus, TimelineNote, TimelineStage } from '../../types/workflow';

const STATUS: Record<StageStatus, { label: string; dot: string; line: string; chip: string; icon: ReactNode }> = {
  pending:  { label: 'Not started', dot: 'border-gray-300 bg-white text-gray-400',          line: 'bg-gray-200',   chip: 'bg-gray-100 text-gray-500',     icon: <Minus size={14} /> },
  active:   { label: 'In progress', dot: 'border-brand-700 bg-brand-700 text-white',        line: 'bg-brand-300',  chip: 'bg-brand-50 text-brand-800',    icon: <Clock size={15} /> },
  approved: { label: 'Approved',    dot: 'border-emerald-600 bg-emerald-600 text-white',    line: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700', icon: <Check size={15} /> },
  rejected: { label: 'Rejected',    dot: 'border-red-600 bg-red-600 text-white',            line: 'bg-red-300',    chip: 'bg-red-50 text-red-700',        icon: <X size={15} /> },
  returned: { label: 'Sent back',   dot: 'border-amber-500 bg-amber-500 text-white',        line: 'bg-amber-300',  chip: 'bg-amber-50 text-amber-700',    icon: <Undo2 size={14} /> },
  skipped:  { label: 'Not reached', dot: 'border-gray-300 bg-gray-100 text-gray-400',       line: 'bg-gray-200',   chip: 'bg-gray-100 text-gray-500',     icon: <Minus size={14} /> },
  bypassed: { label: 'Bypassed',    dot: 'border-violet-500 bg-violet-500 text-white',      line: 'bg-violet-300', chip: 'bg-violet-50 text-violet-700',  icon: <FastForward size={14} /> },
};

const RECOMMENDATION: Record<Recommendation, { label: string; cls: string }> = {
  approve: { label: 'AI suggests: approve', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  review:  { label: 'AI suggests: needs a closer look', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  reject:  { label: 'AI suggests: reject', cls: 'bg-red-50 text-red-700 border-red-200' },
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function durationLabel(from: string | null, to: string | null): string | null {
  if (!from) return null;
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  if (ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function NoteList({ notes }: { notes: TimelineNote[] }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {notes.map((n) => (
        <li
          key={n.id}
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            n.audience === 'internal' ? 'border-amber-200 bg-amber-50/60' : 'border-sky-200 bg-sky-50/60',
          )}
        >
          <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
                n.audience === 'internal' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800',
              )}
            >
              {n.audience === 'internal' ? <Lock size={11} /> : <Eye size={11} />}
              {n.audience === 'internal' ? 'Internal' : 'Visible to student'}
            </span>
            <span className="font-medium text-gray-700">{n.author}</span>
            {n.kind === 'decision' && <span className="text-gray-500">· decision</span>}
            <span className="text-gray-400">{formatDateTime(n.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-gray-700">{n.body}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Vertical, animated progress timeline for a transfer request. Each stage
 * shows who owns it, when it started/finished, how long it took (or has
 * been waiting), its SLA state, and the notes the viewer is allowed to see.
 * `renderActive` lets a page (e.g. the approver review screen) render its
 * action panel directly beneath the active stage.
 */
export function RequestTimeline({
  stages,
  renderActive,
  showApprovers = true,
}: {
  stages: TimelineStage[];
  renderActive?: (stage: TimelineStage) => ReactNode;
  showApprovers?: boolean;
}) {
  const [open, setOpen] = useState<Record<number, boolean>>({});

  return (
    <ol className="relative">
      {stages.map((s, i) => {
        const st = STATUS[s.status];
        const last = i === stages.length - 1;
        const isActive = s.status === 'active';
        const shown = open[s.id] ?? isActive;
        const took = durationLabel(s.activatedAt, s.completedAt);
        const noteCount = s.notes.length;

        return (
          <motion.li
            key={s.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
            className="relative flex gap-4 pb-8 last:pb-0"
          >
            {!last && (
              <motion.span
                aria-hidden
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: i * 0.06 + 0.1, duration: 0.35 }}
                style={{ originY: 0 }}
                className={cn('absolute left-[17px] top-9 bottom-0 w-0.5 rounded-full', st.line)}
              />
            )}

            <div className="relative shrink-0">
              {isActive && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-brand-500/40"
                  animate={{ scale: [1, 1.7], opacity: [0.7, 0] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: 'easeOut' }}
                />
              )}
              <div className={cn('relative flex h-9 w-9 items-center justify-center rounded-full border-2 shadow-sm', st.dot)}>
                {s.type === 'system' && s.status === 'pending' ? <Bot size={15} /> : st.icon}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className={cn('text-base font-semibold', s.status === 'pending' || s.status === 'skipped' ? 'text-gray-500' : 'text-gray-900')}>
                  {s.name}
                </h3>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', st.chip)}>{st.label}</span>
                {s.type === 'system' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    <Sparkles size={11} /> Automated
                  </span>
                )}
                {s.overdue && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    <AlertTriangle size={11} /> Overdue
                  </span>
                )}
                {s.aiRecommendation && isActive && (
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', RECOMMENDATION[s.aiRecommendation].cls)}>
                    {RECOMMENDATION[s.aiRecommendation].label}
                  </span>
                )}
              </div>

              {s.description && s.status === 'pending' && <p className="mt-0.5 text-sm text-gray-400">{s.description}</p>}

              <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-gray-500">
                {s.activatedAt && (
                  <div><dt className="inline text-gray-400">Started </dt><dd className="inline">{formatDateTime(s.activatedAt)}</dd></div>
                )}
                {s.completedAt && (
                  <div><dt className="inline text-gray-400">Finished </dt><dd className="inline">{formatDateTime(s.completedAt)}</dd></div>
                )}
                {took && s.completedAt && <div><dt className="inline text-gray-400">Took </dt><dd className="inline">{took}</dd></div>}
                {isActive && took && <div><dt className="inline text-gray-400">Waiting </dt><dd className="inline font-medium text-gray-700">{took}</dd></div>}
                {s.dueAt && s.status === 'active' && (
                  <div><dt className="inline text-gray-400">Due </dt><dd className={cn('inline', s.overdue && 'font-medium text-red-600')}>{formatDateTime(s.dueAt)}</dd></div>
                )}
                {s.decidedBy && <div><dt className="inline text-gray-400">By </dt><dd className="inline">{s.decidedBy.name}</dd></div>}
              </dl>

              {showApprovers && s.type !== 'system' && s.approvers.length > 0 && s.status !== 'approved' && s.status !== 'bypassed' && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <Users size={12} className="text-gray-400" />
                  <span className="text-gray-400">{isActive ? 'Waiting on' : 'Assigned to'}</span>
                  {s.approvers.map((a) => (
                    <span key={a} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{a}</span>
                  ))}
                </div>
              )}

              {noteCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [s.id]: !shown }))}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800"
                >
                  <MessageSquare size={12} />
                  {noteCount} {noteCount === 1 ? 'note' : 'notes'}
                  <ChevronDown size={12} className={cn('transition-transform', shown && 'rotate-180')} />
                </button>
              )}
              {shown && <NoteList notes={s.notes} />}

              {isActive && renderActive && <div className="mt-4">{renderActive(s)}</div>}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

export function GeneralNotes({ notes }: { notes: TimelineNote[] }) {
  if (!notes.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-700">Other notes</h3>
      <NoteList notes={notes} />
    </div>
  );
}

/** Notes only, grouped under the step they were written on (the steps themselves are shown by the progress tracker). */
export function NotesByStage({ stages, general }: { stages: TimelineStage[]; general: TimelineNote[] }) {
  const withNotes = stages.filter((s) => s.notes.length);
  if (!withNotes.length && !general.length) return <p className="text-sm text-gray-500">No notes yet.</p>;
  return (
    <div className="space-y-4">
      {withNotes.map((s) => (
        <div key={s.id}>
          <h3 className="mb-1 text-sm font-semibold text-gray-700">{s.name}</h3>
          <NoteList notes={s.notes} />
        </div>
      ))}
      <GeneralNotes notes={general} />
    </div>
  );
}
