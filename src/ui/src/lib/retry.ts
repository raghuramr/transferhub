/** Pure retry policy for uploads on flaky mobile networks (unit tested in src/api/scripts/test-capture-logic.ts). */

export interface RetryOptions {
  retries: number;
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 3, baseMs: 800, maxMs: 8000 };

/** Anything shaped like an axios error: a response status, or none when the network dropped. */
export function isRetryable(err: unknown): boolean {
  const e = err as { response?: { status?: number }; code?: string; name?: string } | null;
  if (!e) return false;
  if (e.code === 'ERR_CANCELED' || e.name === 'CanceledError') return false;
  const status = e.response?.status;
  if (status === undefined) return true; // no response at all: offline, timeout, connection reset
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

/** 0-based attempt number -> delay: exponential, capped, with a small deterministic spread. */
export function backoffMs(attempt: number, o: RetryOptions = DEFAULT_RETRY, rand: () => number = Math.random): number {
  const raw = Math.min(o.maxMs, o.baseMs * 2 ** attempt);
  return Math.round(raw * (0.75 + rand() * 0.5));
}

/** Runs `fn`, retrying retryable failures. `onRetry` is told which attempt failed and how long it will wait. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { options?: RetryOptions; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, waitMs: number, err: unknown) => void; shouldStop?: () => boolean } = {},
): Promise<T> {
  const o = opts.options ?? DEFAULT_RETRY;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= o.retries || !isRetryable(err) || opts.shouldStop?.()) throw err;
      const wait = backoffMs(attempt, o);
      opts.onRetry?.(attempt + 1, wait, err);
      await sleep(wait);
    }
  }
}

/** The capture/upload state machine: capturing -> uploading -> reading -> review, with failed reachable from uploading. */
export type CaptureState = 'capturing' | 'uploading' | 'reading' | 'review' | 'failed';

const NEXT: Record<CaptureState, CaptureState[]> = {
  capturing: ['uploading'],
  uploading: ['reading', 'review', 'failed', 'capturing'],
  reading: ['review', 'failed'],
  review: ['capturing'],
  failed: ['uploading', 'capturing'],
};

export function canTransition(from: CaptureState, to: CaptureState): boolean {
  return from === to || NEXT[from].includes(to);
}
