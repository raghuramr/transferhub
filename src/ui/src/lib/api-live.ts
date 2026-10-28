import { api } from './api';

/** Mirrors api/src/events/event-bus.service.ts - minimal on purpose. */
export type LiveEventType =
  | 'stage_activated' | 'stage_approved' | 'stage_rejected' | 'stage_returned' | 'stage_bypassed' | 'stage_auto_approved'
  | 'request_completed' | 'note_added' | 'document_added' | 'document_requested' | 'evaluation_decided' | 'evaluation_posted' | 'reminder_sent';

export interface LiveEvent {
  type: LiveEventType;
  transcriptId: string;
  at: string;
  audience: 'all' | 'staff';
  stage?: { order?: number; name?: string; status?: string };
  text: string;
}

const BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');

export const liveApi = {
  /** Authenticated; returns a ~30 s single-use ticket for the stream (EventSource cannot send headers). */
  ticket: async () => (await api.post<{ ticket: string; expiresInSec: number }>('/events/ticket')).data,
  streamUrl: (ticket: string) => `${BASE}/events/stream?ticket=${encodeURIComponent(ticket)}`,
};

/** TanStack Query keys that may now be stale because of this event (prefix match). */
export function queryKeysFor(e: Pick<LiveEvent, 'transcriptId' | 'type'>): unknown[][] {
  const id = e.transcriptId;
  const keys: unknown[][] = [['transcript', id], ['request', id], ['requests-queue'], ['transcripts'], ['student', 'overview'], ['progress']];
  if (e.type === 'evaluation_decided' || e.type === 'evaluation_posted') keys.push(['request-ai-usage', id], ['evaluations']);
  if (e.type === 'document_added' || e.type === 'document_requested' || e.type === 'reminder_sent') keys.push(['exchange', id]);
  return keys;
}

/** Keys refreshed on the 15 s polling fallback. */
export const POLL_KEYS: unknown[][] = [['transcript'], ['request'], ['requests-queue'], ['transcripts']];

/** Which events deserve a toast for the student (notes/documents refresh silently). */
export function toastFor(e: LiveEvent): { tone: 'good' | 'info' | 'bad'; text: string } | null {
  const name = e.stage?.name;
  switch (e.type) {
    case 'stage_approved': return { tone: 'good', text: name ? `Stage '${name}' approved` : 'A stage was approved' };
    case 'stage_auto_approved': return { tone: 'good', text: name ? `Stage '${name}' completed automatically` : 'A stage was completed automatically' };
    case 'stage_bypassed': return { tone: 'info', text: name ? `Stage '${name}' was not needed` : 'A stage was skipped' };
    case 'stage_rejected': return { tone: 'bad', text: name ? `Stage '${name}' was not approved` : 'Your request was not approved' };
    case 'stage_returned': return { tone: 'info', text: name ? `Stage '${name}' was sent back for another look` : 'A stage was sent back' };
    case 'stage_activated': return { tone: 'info', text: name ? `Your request is now at '${name}'` : 'Your request moved to the next stage' };
    case 'request_completed': return { tone: 'good', text: 'Your request is complete' };
    case 'document_requested': return { tone: 'info', text: 'A document was requested for your request' };
    case 'evaluation_posted': return { tone: 'good', text: 'A course result was posted' };
    default: return null;
  }
}
