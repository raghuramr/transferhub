import type { TimelineStage } from '../types/workflow';

/** "just now", "5 min ago", "2h ago", "3d ago". */
export function agoLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Minutes -> "about 3 hours" / "about 2 days". */
export function approxDuration(mins: number): string {
  if (mins < 60) return 'under an hour';
  const h = Math.round(mins / 60);
  if (h < 24) return `about ${h} ${h === 1 ? 'hour' : 'hours'}`;
  const d = Math.round(h / 24);
  return `about ${d} ${d === 1 ? 'day' : 'days'}`;
}

export interface FinishEstimate {
  /** Minutes still expected. */
  minutes: number;
  /** The current stage has already taken longer than its average. */
  slower: boolean;
}

/**
 * Estimated time left: what is left of the active stage's average plus the average of every stage still to come.
 * Returns null unless every remaining stage has an average (from recent completed requests) - a partial sum would mislead.
 */
export function estimateFinish(stages: TimelineStage[], now = Date.now()): FinishEstimate | null {
  const active = stages.find((s) => s.status === 'active');
  if (!active) return null;
  const todo = stages.filter((s) => s.status === 'pending' || s.status === 'returned');
  if (active.avgMinutes == null || todo.some((s) => s.avgMinutes == null)) return null;
  const elapsed = active.activatedAt ? Math.max(0, (now - new Date(active.activatedAt).getTime()) / 60_000) : 0;
  const slower = elapsed > active.avgMinutes;
  const left = slower ? 0 : active.avgMinutes - elapsed;
  return { minutes: Math.round(left + todo.reduce((n, s) => n + (s.avgMinutes ?? 0), 0)), slower };
}

/** Stages worth showing to a student: skip ones that will never be reached. */
export const trackerStages = (stages: TimelineStage[]) => stages.filter((s) => s.status !== 'skipped');

/** One-sentence status for screen readers (aria-live). */
export function statusSentence(stages: TimelineStage[], workflowStatus: string | null | undefined, now = Date.now()): string {
  if (workflowStatus === 'rejected') return 'Your request was not approved.';
  if (workflowStatus === 'approved' || workflowStatus === 'bypassed') return 'Your request is complete.';
  const active = stages.find((s) => s.status === 'active');
  if (!active) return 'Your request is being prepared.';
  const who = active.type === 'system' ? 'automatic processing' : active.approvers.join(', ') || 'a reviewer';
  return `Currently at ${active.name}. Waiting on ${who}${active.activatedAt ? `, since ${agoLabel(active.activatedAt, now)}` : ''}.`;
}
