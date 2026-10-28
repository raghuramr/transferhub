import { randomBytes } from 'node:crypto';

export interface TicketViewer {
  id: string;
  role: string;
}

/**
 * Short-lived, single-use tickets for the SSE endpoint. EventSource cannot send an Authorization
 * header and a JWT in a URL would end up in access logs, so the client first POSTs (authenticated) to
 * get a random ticket that is valid for ~30 s and can be redeemed exactly once.
 */
export class TicketStore {
  private tickets = new Map<string, { viewer: TicketViewer; expires: number }>();

  constructor(
    private ttlMs = 30_000,
    private now: () => number = () => Date.now(),
    private maxOutstanding = 10_000,
  ) {}

  issue(viewer: TicketViewer): { ticket: string; expiresInSec: number } {
    this.sweep();
    if (this.tickets.size >= this.maxOutstanding) {
      const oldest = this.tickets.keys().next().value;
      if (oldest) this.tickets.delete(oldest);
    }
    const ticket = randomBytes(32).toString('hex');
    this.tickets.set(ticket, { viewer: { id: viewer.id, role: viewer.role }, expires: this.now() + this.ttlMs });
    return { ticket, expiresInSec: Math.round(this.ttlMs / 1000) };
  }

  /** Returns the viewer and burns the ticket; null when unknown, used or expired. */
  redeem(ticket: string | undefined): TicketViewer | null {
    if (!ticket) return null;
    const t = this.tickets.get(ticket);
    if (!t) return null;
    this.tickets.delete(ticket);
    return t.expires >= this.now() ? t.viewer : null;
  }

  sweep() {
    const n = this.now();
    for (const [k, v] of this.tickets) if (v.expires < n) this.tickets.delete(k);
  }

  get size() {
    return this.tickets.size;
  }
}
