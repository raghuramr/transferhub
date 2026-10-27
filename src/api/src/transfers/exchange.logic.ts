import type { Party } from '../policy/scope.service';

/** Pure helpers for the transfer exchange (no database), unit-tested in scripts/test-exchange-logic.ts. */

export const PARTY_REMINDER_HOURS = 12;
export const PARTY_VALUES: Party[] = ['student', 'source_university', 'target_university'];

export const isParty = (v: unknown): v is Party => typeof v === 'string' && (PARTY_VALUES as string[]).includes(v);

/**
 * Which side the caller is speaking for. `allowed` = the sides their account may speak for on this transfer.
 * An explicit request must be one of them; with several (unscoped staff) and no choice, the receiving
 * university is the default because that is the side staff normally work from.
 */
export function pickParty(allowed: Party[], requested?: string | null): Party | null {
  if (!allowed.length) return null;
  if (requested) return isParty(requested) && allowed.includes(requested) ? requested : null;
  if (allowed.length === 1) return allowed[0];
  return allowed.includes('target_university') ? 'target_university' : allowed[0];
}

/** Can `by` ask `from` for a document? Two different sides, and the caller must be able to speak for `by`. */
export function validateAsk(allowed: Party[], by: Party, from: Party): string | null {
  if (!allowed.includes(by)) return 'You cannot act for that side of this transfer.';
  if (by === from) return 'A request needs two different sides.';
  return null;
}

/** True while the last reminder is newer than the window - a new one must wait. */
export function reminderBlocked(lastAt: Date | string | null | undefined, now: number, hours = PARTY_REMINDER_HOURS): boolean {
  if (!lastAt) return false;
  return now - new Date(lastAt).getTime() < hours * 3_600_000;
}

/** Collapses Transcripts.Status + WorkflowStatus + EvaluationKind into the buckets the Transfers page shows. */
export type TransferBucket = 'new' | 'in_review' | 'approved' | 'rejected';
export function statusBucket(workflowStatus: string | null | undefined, status: string | null | undefined): TransferBucket {
  if (workflowStatus === 'approved' || workflowStatus === 'bypassed') return 'approved';
  if (workflowStatus === 'rejected') return 'rejected';
  if (workflowStatus === 'active') return 'in_review';
  return status === 'complete' ? 'approved' : 'new';
}

export const BUCKET_LABEL: Record<TransferBucket, string> = {
  new: 'New', in_review: 'In review', approved: 'Completed', rejected: 'Not approved',
};

/** "Northeastern University" for a university side, "the student" for the student side. */
export function partyName(party: Party, names: { source?: string | null; target?: string | null; student?: string | null }): string {
  if (party === 'student') return names.student || 'the student';
  if (party === 'source_university') return names.source || 'the sending university';
  return names.target || 'the receiving university';
}

export const PARTY_SHORT: Record<Party, string> = { student: 'Student', source_university: 'From University 1', target_university: 'From University 2' };

/** Default title of a document request when the asker only picked a document type. */
export function defaultTitle(label: string | null | undefined, title?: string | null): string {
  const t = (title ?? '').trim();
  if (t) return t.slice(0, 200);
  return (label ?? 'Document').slice(0, 200);
}

/** Clamps an optional ISO date (YYYY-MM-DD) to a valid date string or null. */
export function cleanDueDate(v?: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(`${v.trim()}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== Number(m[2]) ? null : v.trim();
}
