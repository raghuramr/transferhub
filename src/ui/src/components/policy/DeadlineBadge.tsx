import { CalendarClock } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { DeadlineState } from '../../types/policy';

export interface DeadlineLike {
  state: DeadlineState;
  daysLeft: number | null;
  deadlineOn: string | null;
  isEstimate?: boolean;
}

export const DEADLINE_TONE: Record<DeadlineState, { pill: string; label: string }> = {
  on_track: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'On track' },
  not_started: { pill: 'bg-sky-50 text-sky-700 ring-sky-200', label: 'Not started' },
  due_soon: { pill: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'Due soon' },
  urgent: { pill: 'bg-orange-50 text-orange-800 ring-orange-300', label: 'Urgent' },
  overdue: { pill: 'bg-red-50 text-red-700 ring-red-200', label: 'Overdue' },
  unknown: { pill: 'bg-gray-100 text-gray-600 ring-gray-200', label: 'Unknown' },
};

export const formatDeadlineDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

/** "12 days left", "due today", "3 days overdue". */
export function daysText(daysLeft: number | null): string {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue`;
  if (daysLeft === 0) return 'due today';
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

/** Credit-deadline chip (PRG-02) for staff headers and queue rows. Renders nothing when there is no usable deadline. */
export default function DeadlineBadge({ deadline, className }: { deadline?: DeadlineLike | null; className?: string }) {
  if (!deadline || deadline.state === 'unknown' || !deadline.deadlineOn) return null;
  const tone = DEADLINE_TONE[deadline.state];
  const label = deadline.state === 'not_started' ? `Credit deadline ${formatDeadlineDate(deadline.deadlineOn)}` : `Credit deadline: ${daysText(deadline.daysLeft)}`;
  return (
    <span
      data-testid="deadline-badge"
      title={`Credit deadline ${formatDeadlineDate(deadline.deadlineOn)}${deadline.isEstimate ? ' (estimated from the first request; no entry term on file)' : ''}`}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tone.pill, className)}
    >
      <CalendarClock size={11} /> {label}{deadline.isEstimate && ' (est.)'}
    </span>
  );
}
