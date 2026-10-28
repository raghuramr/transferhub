import { useEffect, useRef } from 'react';
import { useLiveContext, type LiveStatus } from '../components/live/LiveEventsProvider';
import type { LiveEvent } from '../lib/api-live';

/**
 * Live connection state for the current page. The single EventSource (auto-reconnect with backoff, 15 s
 * polling fallback, query invalidation, student toasts) lives in <LiveEventsProvider>; this hook reads it.
 * `onEvent` (optional) runs for every event the user may see; pass `transcriptId` to only get that request's.
 */
export function useLiveEvents(opts: { onEvent?: (e: LiveEvent) => void; transcriptId?: string } = {}): { status: LiveStatus; lastEvent: LiveEvent | null } {
  const { status, lastEvent, subscribe } = useLiveContext();
  const cb = useRef(opts.onEvent);
  cb.current = opts.onEvent;
  const wants = !!opts.onEvent;
  const only = opts.transcriptId?.toLowerCase();
  useEffect(() => {
    if (!wants) return;
    return subscribe((e) => {
      if (!only || e.transcriptId === only) cb.current?.(e);
    });
  }, [subscribe, only, wants]);
  return { status, lastEvent };
}
