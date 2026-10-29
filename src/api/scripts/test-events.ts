/**
 * Offline tests for the live-event plumbing (no DB, no network).
 * Run: npx tsx scripts/test-events.ts
 */
import assert from 'node:assert/strict';
import { EventBus, type LiveEvent } from '../src/events/event-bus.service';
import { TicketStore } from '../src/events/event-tickets';
import { EventAccessService } from '../src/events/event-access.service';
import { LiveHub, type EventAccess, type HubViewer, type Sink } from '../src/events/live-hub';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n${(e as Error).stack}`);
    process.exitCode = 1;
  }
}

class MemSink implements Sink {
  chunks: string[] = [];
  ended = false;
  failNext = false;
  write(c: string) {
    if (this.failNext) throw new Error('socket closed');
    this.chunks.push(c);
  }
  end() {
    this.ended = true;
  }
  get live(): LiveEvent[] {
    return this.chunks
      .filter((c) => c.includes('event: live'))
      .map((c) => JSON.parse(c.split('\ndata: ')[1].split('\n')[0]));
  }
}

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
const STUDENT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const STUDENT_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const FACULTY = 'ffffffff-0000-0000-0000-000000000003';
const ADMIN_IN = 'cccccccc-0000-0000-0000-000000000004';
const ADMIN_OUT = 'dddddddd-0000-0000-0000-000000000005';

/** Mirrors EventAccessService's rules with fixed data: T1 belongs to student A, T2 to student B; the scoped admin ADMIN_OUT sees neither. */
const access: EventAccess = {
  async canSee(v: HubViewer, tid, audience) {
    if (v.role === 'student') return audience === 'all' && ((v.id === STUDENT_A && tid === T1) || (v.id === STUDENT_B && tid === T2));
    if (v.role === 'admin') return v.id === ADMIN_IN;
    return v.role === 'faculty' || v.role === 'super_admin';
  },
};

const ev = (over: Partial<Parameters<EventBus['emit']>[0]> = {}) =>
  ({ type: 'stage_approved', transcriptId: T1, text: 'Stage "Faculty review" approved', ...over }) as Parameters<EventBus['emit']>[0];
const settle = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  await test('bus: fan-out, unsubscribe, listener errors are isolated, emit never throws', () => {
    const bus = new EventBus();
    const got: string[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const off = bus.subscribe((e) => got.push(e.type));
    bus.emit(ev());
    assert.deepEqual(got, ['stage_approved']);
    off();
    bus.emit(ev());
    assert.equal(got.length, 1);
    assert.doesNotThrow(() => bus.emit(undefined as never));
    assert.doesNotThrow(() => bus.emit({ type: 'note_added', transcriptId: '', text: 'x' }));
  });

  await test('bus: normalises id, defaults audience, trims text', () => {
    const bus = new EventBus();
    let e: LiveEvent | undefined;
    bus.subscribe((x) => (e = x));
    bus.emit(ev({ transcriptId: T1.toUpperCase(), text: 'x'.repeat(500) }));
    assert.equal(e!.transcriptId, T1);
    assert.equal(e!.audience, 'all');
    assert.equal(e!.text.length, 200);
    assert.ok(!Number.isNaN(Date.parse(e!.at)));
  });

  await test('hub: scope filtering - each viewer only gets events they may see', async () => {
    const bus = new EventBus();
    const hub = new LiveHub(bus, access);
    const a = new MemSink(), b = new MemSink(), f = new MemSink(), adminIn = new MemSink(), adminOut = new MemSink();
    hub.connect({ id: STUDENT_A, role: 'student' }, a);
    hub.connect({ id: STUDENT_B, role: 'student' }, b);
    hub.connect({ id: FACULTY, role: 'faculty' }, f);
    hub.connect({ id: ADMIN_IN, role: 'admin' }, adminIn);
    hub.connect({ id: ADMIN_OUT, role: 'admin' }, adminOut);
    bus.emit(ev({ transcriptId: T1 }));
    bus.emit(ev({ transcriptId: T2, type: 'stage_activated' }));
    await settle();
    assert.deepEqual(a.live.map((e) => e.transcriptId), [T1]);
    assert.deepEqual(b.live.map((e) => e.transcriptId), [T2]);
    assert.equal(f.live.length, 2);
    assert.equal(adminIn.live.length, 2);
    assert.equal(adminOut.live.length, 0);
    hub.shutdown();
  });

  await test('hub: staff-only events never reach students, even their own request', async () => {
    const bus = new EventBus();
    const hub = new LiveHub(bus, { canSee: async () => true }); // even a permissive resolver cannot leak them
    const s = new MemSink(), f = new MemSink();
    hub.connect({ id: STUDENT_A, role: 'student' }, s);
    hub.connect({ id: 'ag', role: 'agency' }, new MemSink());
    hub.connect({ id: FACULTY, role: 'faculty' }, f);
    bus.emit(ev({ type: 'note_added', audience: 'staff', text: 'New internal note' }));
    await settle();
    assert.equal(s.live.length, 0);
    assert.equal(f.live.length, 1);
    hub.shutdown();
  });

  await test('hub: an access check that throws means no delivery (and no crash)', async () => {
    const bus = new EventBus();
    const hub = new LiveHub(bus, { canSee: async () => { throw new Error('db down'); } });
    const s = new MemSink();
    hub.connect({ id: FACULTY, role: 'faculty' }, s);
    bus.emit(ev());
    await settle();
    assert.equal(s.live.length, 0);
    hub.shutdown();
  });

  await test('hub: per-user connection cap', () => {
    const hub = new LiveHub(new EventBus(), access, { maxPerUser: 2 });
    const v = { id: STUDENT_A, role: 'student' };
    const c1 = hub.connect(v, new MemSink());
    assert.ok(c1);
    assert.ok(hub.connect(v, new MemSink()));
    assert.equal(hub.connect(v, new MemSink()), null);
    assert.ok(hub.connect({ id: STUDENT_B, role: 'student' }, new MemSink()), 'other users are unaffected');
    c1!.close();
    assert.ok(hub.connect(v, new MemSink()), 'a slot frees up after close');
    hub.shutdown();
  });

  await test('hub: heartbeat writes a comment, drops broken sinks, closes over-age ones, stops timer when empty', () => {
    let now = 1_000;
    const bus = new EventBus();
    const hub = new LiveHub(bus, access, { heartbeatMs: 25_000, maxAgeMs: 60_000, now: () => now });
    const ok = new MemSink(), broken = new MemSink();
    hub.connect({ id: FACULTY, role: 'faculty' }, ok);
    hub.connect({ id: ADMIN_IN, role: 'admin' }, broken);
    assert.ok(hub.heartbeating);
    assert.equal(bus.listenerCount, 1);
    now += 25_000;
    broken.failNext = true;
    hub.heartbeat();
    assert.ok(ok.chunks.some((c) => c.startsWith(': ping')));
    assert.equal(hub.size, 1, 'broken connection dropped');
    now += 40_000; // > maxAge
    hub.heartbeat();
    assert.equal(hub.size, 0);
    assert.ok(ok.ended, 'over-age connection is ended so the browser reconnects');
    assert.equal(hub.heartbeating, false, 'timer stopped');
    assert.equal(bus.listenerCount, 0, 'bus unsubscribed');
  });

  await test('hub: close() cleans up and later events are not written', async () => {
    const bus = new EventBus();
    const hub = new LiveHub(bus, access);
    const s = new MemSink();
    const c = hub.connect({ id: FACULTY, role: 'faculty' }, s)!;
    c.close();
    bus.emit(ev());
    await settle();
    assert.equal(s.live.length, 0);
    assert.equal(hub.size, 0);
    assert.equal(bus.listenerCount, 0);
  });

  await test('hub: a write failure during dispatch drops that connection only', async () => {
    const bus = new EventBus();
    const hub = new LiveHub(bus, access);
    const bad = new MemSink(), good = new MemSink();
    hub.connect({ id: FACULTY, role: 'faculty' }, bad);
    hub.connect({ id: 'f2', role: 'faculty' }, good);
    bad.failNext = true;
    bus.emit(ev());
    await settle();
    assert.equal(hub.size, 1);
    assert.equal(good.live.length, 1);
    hub.shutdown();
  });

  await test('tickets: single use', () => {
    const t = new TicketStore();
    const { ticket } = t.issue({ id: STUDENT_A, role: 'student' });
    assert.match(ticket, /^[0-9a-f]{64}$/);
    assert.deepEqual(t.redeem(ticket), { id: STUDENT_A, role: 'student' });
    assert.equal(t.redeem(ticket), null, 'second redeem fails');
    assert.equal(t.redeem('nope'), null);
    assert.equal(t.redeem(undefined), null);
  });

  await test('tickets: expiry and sweep; tickets are unique', () => {
    let now = 0;
    const t = new TicketStore(30_000, () => now);
    const a = t.issue({ id: 'u1', role: 'student' }).ticket;
    const b = t.issue({ id: 'u1', role: 'student' }).ticket;
    assert.notEqual(a, b);
    now = 29_999;
    assert.ok(t.redeem(a));
    now = 30_001;
    assert.equal(t.redeem(b), null, 'expired');
    assert.equal(t.size, 0);
    const c = t.issue({ id: 'u2', role: 'admin' }).ticket;
    now = 100_000;
    t.issue({ id: 'u3', role: 'admin' }); // sweeps c
    assert.equal(t.redeem(c), null);
  });

  await test('tickets: outstanding cap evicts the oldest', () => {
    const t = new TicketStore(30_000, () => 0, 2);
    const first = t.issue({ id: '1', role: 'student' }).ticket;
    t.issue({ id: '2', role: 'student' });
    t.issue({ id: '3', role: 'student' });
    assert.equal(t.size, 2);
    assert.equal(t.redeem(first), null);
  });

  await test('EventAccessService: owner/submitter/scope rules with a stubbed DB', async () => {
    let queries = 0;
    const db = { query: async () => { queries++; return { recordset: [{ StudentUserId: STUDENT_A.toUpperCase(), SubmittedById: 'AGENCY-1' }] }; } };
    // Faculty are now narrowed by their university assignment exactly like admins: only the two
    // staff ids that belong to this transfer's universities pass canViewTranscript.
    const scope = { canViewTranscript: async (v: { id: string }) => v.id === ADMIN_IN || v.id === FACULTY };
    const svc = new EventAccessService(db as never, scope as never);
    assert.equal(await svc.canSee({ id: STUDENT_A, role: 'student' }, T1, 'all'), true);
    assert.equal(await svc.canSee({ id: STUDENT_B, role: 'student' }, T1, 'all'), false);
    assert.equal(await svc.canSee({ id: STUDENT_A, role: 'student' }, T1, 'staff'), false);
    assert.equal(await svc.canSee({ id: 'agency-1', role: 'agency' }, T1, 'all'), true);
    assert.equal(await svc.canSee({ id: 'agency-2', role: 'agency' }, T1, 'all'), false);
    assert.equal(queries, 1, 'owner lookup is cached');
    assert.equal(await svc.canSee({ id: ADMIN_IN, role: 'admin' }, T1, 'all'), true);
    assert.equal(await svc.canSee({ id: ADMIN_OUT, role: 'admin' }, T1, 'staff'), false);
    assert.equal(await svc.canSee({ id: FACULTY, role: 'faculty' }, T1, 'staff'), true);
    assert.equal(await svc.canSee({ id: ADMIN_OUT, role: 'faculty' }, T1, 'staff'), false, 'a faculty member of another university gets nothing');
    assert.equal(await svc.canSee({ id: 'x', role: 'super_admin' }, T1, 'staff'), true, 'super admins are never narrowed');
    assert.equal(await svc.canSee({ id: 'x', role: 'unknown' }, T1, 'all'), false);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
