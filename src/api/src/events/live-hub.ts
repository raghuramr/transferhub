import type { EventBus, LiveEvent } from './event-bus.service';

export interface HubViewer {
  id: string;
  role: string;
}

/** Decides whether a viewer may see events about a request. Real implementation: EventAccessService. */
export interface EventAccess {
  canSee(viewer: HubViewer, transcriptId: string, audience: LiveEvent['audience']): Promise<boolean>;
}

/** Where bytes go: an Express response in production, an array in tests. */
export interface Sink {
  write(chunk: string): unknown;
  end(): unknown;
}

export interface HubOptions {
  heartbeatMs?: number;
  maxPerUser?: number;
  /** A connection older than this is closed by the server; the browser reconnects with a fresh ticket. */
  maxAgeMs?: number;
  now?: () => number;
}

interface Conn {
  id: number;
  viewer: HubViewer;
  sink: Sink;
  openedAt: number;
}

export const STAFF_ONLY_BLOCKED = ['student', 'agency'];

/**
 * Fans bus events out to open SSE connections. Every event is checked per connection (access is
 * re-evaluated per request, never assumed), heartbeats keep proxies from closing idle streams, and
 * broken connections are dropped as soon as a write fails.
 */
export class LiveHub {
  private conns = new Map<number, Conn>();
  private seq = 0;
  private eventId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly heartbeatMs: number;
  private readonly maxPerUser: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(
    private bus: EventBus,
    private access: EventAccess,
    opts: HubOptions = {},
  ) {
    this.heartbeatMs = opts.heartbeatMs ?? 25_000;
    this.maxPerUser = opts.maxPerUser ?? 5;
    this.maxAgeMs = opts.maxAgeMs ?? 15 * 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  get size() {
    return this.conns.size;
  }

  get heartbeating() {
    return this.timer !== null;
  }

  countFor(userId: string) {
    let n = 0;
    for (const c of this.conns.values()) if (c.viewer.id === userId) n++;
    return n;
  }

  /** null = per-user connection cap reached. */
  connect(viewer: HubViewer, sink: Sink): { close: () => void } | null {
    if (this.countFor(viewer.id) >= this.maxPerUser) return null;
    const conn: Conn = { id: ++this.seq, viewer, sink, openedAt: this.now() };
    this.conns.set(conn.id, conn);
    if (!this.unsubscribe) this.unsubscribe = this.bus.subscribe((e) => void this.dispatch(e));
    if (!this.timer) {
      this.timer = setInterval(() => this.heartbeat(), this.heartbeatMs);
      this.timer.unref?.();
    }
    this.safeWrite(conn, `retry: 3000\nevent: hello\ndata: {"ok":true}\n\n`);
    return { close: () => this.drop(conn.id, false) };
  }

  /** Sends a comment line to every connection, drops broken or over-age ones. Called on a timer. */
  heartbeat() {
    const t = this.now();
    for (const c of [...this.conns.values()]) {
      if (t - c.openedAt > this.maxAgeMs) {
        this.drop(c.id, true);
        continue;
      }
      this.safeWrite(c, `: ping ${t}\n\n`);
    }
  }

  async dispatch(event: LiveEvent) {
    const payload = JSON.stringify(event);
    await Promise.all(
      [...this.conns.values()].map(async (c) => {
        try {
          if (event.audience === 'staff' && STAFF_ONLY_BLOCKED.includes(c.viewer.role)) return;
          if (!(await this.access.canSee(c.viewer, event.transcriptId, event.audience))) return;
          if (!this.conns.has(c.id)) return;
          this.safeWrite(c, `id: ${++this.eventId}\nevent: live\ndata: ${payload}\n\n`);
        } catch {
          // an access-check failure means "do not deliver"
        }
      }),
    );
  }

  private safeWrite(c: Conn, chunk: string) {
    try {
      c.sink.write(chunk);
    } catch {
      this.drop(c.id, false);
    }
  }

  private drop(id: number, endSink: boolean) {
    const c = this.conns.get(id);
    if (!c) return;
    this.conns.delete(id);
    if (endSink) {
      try {
        c.sink.end();
      } catch {
        // already closed
      }
    }
    if (!this.conns.size) this.stop();
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Close everything (app shutdown). */
  shutdown() {
    for (const c of [...this.conns.values()]) this.drop(c.id, true);
    this.stop();
  }
}
