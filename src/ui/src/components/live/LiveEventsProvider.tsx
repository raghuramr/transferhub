import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/cn';
import { liveApi, POLL_KEYS, queryKeysFor, toastFor, type LiveEvent } from '../../lib/api-live';

/** live = SSE open; connecting/reconnecting = trying; polling = SSE unavailable, refreshing every 15 s. */
export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'polling';

interface LiveCtx {
  status: LiveStatus;
  lastEvent: LiveEvent | null;
  subscribe: (fn: (e: LiveEvent) => void) => () => void;
}

const Ctx = createContext<LiveCtx>({ status: 'off', lastEvent: null, subscribe: () => () => undefined });

export const POLL_MS = 15_000;
const BACKOFF = [1000, 2000, 5000, 10_000, 20_000, 30_000];
/** After this many failed connection attempts in a row, polling takes over (SSE keeps retrying in the background). */
const POLL_AFTER_FAILURES = 3;

interface Toast { id: number; tone: 'good' | 'info' | 'bad'; text: string; transcriptId: string }

export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const role = user?.role;
  const [status, setStatus] = useState<LiveStatus>('off');
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const listeners = useRef(new Set<(e: LiveEvent) => void>());
  const toastId = useRef(0);

  const subscribe = useCallback((fn: (e: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  useEffect(() => {
    if (!userId || typeof window === 'undefined') { setStatus('off'); return; }
    let closed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const pending = new Map<string, unknown[]>();

    const flushInvalidations = () => {
      for (const key of pending.values()) void qc.invalidateQueries({ queryKey: key });
      pending.clear();
    };
    const queueInvalidations = (e: LiveEvent) => {
      for (const k of queryKeysFor(e)) pending.set(JSON.stringify(k), k);
      clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(flushInvalidations, 200); // batch bursts (one approval can emit several events)
    };

    const startPolling = () => {
      if (pollTimer) return;
      setStatus('polling');
      pollTimer = setInterval(() => { for (const k of POLL_KEYS) void qc.invalidateQueries({ queryKey: k }); }, POLL_MS);
    };
    const stopPolling = () => { if (pollTimer) clearInterval(pollTimer); pollTimer = undefined; };

    const onEvent = (e: LiveEvent) => {
      setLastEvent(e);
      queueInvalidations(e);
      listeners.current.forEach((fn) => { try { fn(e); } catch { /* a bad listener must not stop the stream */ } });
      if (role === 'student' || role === 'agency') {
        const t = toastFor(e);
        if (t) {
          const id = ++toastId.current;
          setToasts((cur) => [...cur.slice(-2), { id, tone: t.tone, text: t.text, transcriptId: e.transcriptId }]);
          setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 7000);
        }
      }
    };

    const fail = () => {
      es?.close();
      es = null;
      if (closed) return;
      failures++;
      if (failures >= POLL_AFTER_FAILURES) startPolling(); else setStatus('reconnecting');
      retryTimer = setTimeout(() => void connect(), BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)]);
    };

    async function connect() {
      if (closed) return;
      if (failures === 0) setStatus('connecting');
      try {
        const { ticket } = await liveApi.ticket();
        if (closed) return;
        es = new EventSource(liveApi.streamUrl(ticket));
        es.addEventListener('hello', () => {
          failures = 0;
          stopPolling();
          setStatus('live');
          // Anything that happened while we were disconnected is picked up by one refresh.
          for (const k of POLL_KEYS) void qc.invalidateQueries({ queryKey: k });
        });
        es.addEventListener('live', (m) => {
          try { onEvent(JSON.parse((m as MessageEvent).data) as LiveEvent); } catch { /* ignore malformed */ }
        });
        // The server closes aged connections and a ticket is single-use, so every reconnect fetches a new ticket.
        es.onerror = fail;
      } catch {
        fail();
      }
    }

    void connect();
    return () => {
      closed = true;
      es?.close();
      clearTimeout(retryTimer);
      clearTimeout(invalidateTimer);
      stopPolling();
      setStatus('off');
    };
  }, [userId, role, qc]);

  const value = useMemo(() => ({ status, lastEvent, subscribe }), [status, lastEvent, subscribe]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" role="status" aria-live="polite" aria-atomic="false">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg',
                t.tone === 'good' && 'border-emerald-200', t.tone === 'bad' && 'border-red-200', t.tone === 'info' && 'border-sky-200',
              )}
              data-testid="live-toast"
            >
              {t.tone === 'good' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : t.tone === 'bad' ? <XCircle size={18} className="mt-0.5 shrink-0 text-red-600" /> : <Info size={18} className="mt-0.5 shrink-0 text-sky-600" />}
              <button
                type="button"
                className="min-w-0 flex-1 text-left font-medium text-gray-800"
                onClick={() => { navigate(`/${role === 'agency' ? 'agency' : 'student'}/transcript/${t.transcriptId}`); setToasts((c) => c.filter((x) => x.id !== t.id)); }}
              >
                {t.text}
              </button>
              <button type="button" aria-label="Dismiss" className="shrink-0 text-gray-400 hover:text-gray-700" onClick={() => setToasts((c) => c.filter((x) => x.id !== t.id))}>
                <X size={15} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useLiveContext() {
  return useContext(Ctx);
}
