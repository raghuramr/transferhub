/** Shared helpers for the smoke suite: tiny fetch wrapper, result types, assertions. */

export const ROLES = ['student', 'faculty', 'admin', 'agency', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];
export type Status = 'PASS' | 'FAIL' | 'SKIP' | 'INFO';

export interface Session { token: string; user: any; email: string }
export interface Result { name: string; status: Status; detail: string; ms: number; info: string[] }

/** Thrown by a check when a precondition is missing (counts as SKIP, never as a failure). */
export class SkipError extends Error {}

export interface Res { status: number; json: any; text: string }

export class Http {
  constructor(private base: string, private timeoutMs: number) {}

  async req(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
      return { status: res.status, json, text };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      throw new Error(`${method} ${path}: ${err.name === 'AbortError' ? `timed out after ${this.timeoutMs} ms` : `${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`}`);
    } finally { clearTimeout(timer); }
  }
  get(path: string, token?: string) { return this.req('GET', path, token); }
  post(path: string, body: unknown, token?: string) { return this.req('POST', path, token, body); }
}

export interface Ctx {
  http: Http;
  write: boolean;
  sessions: Partial<Record<Role, Session>>;
  info: (msg: string) => void;
}

export function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type Kind = 'string' | 'number' | 'boolean' | 'object' | 'array';
const kindOf = (v: unknown): string => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/** Asserts that `obj` has each key with the stated JS kind. */
export function shape(obj: any, spec: Record<string, Kind>, label: string): void {
  expect(obj && typeof obj === 'object', `${label}: expected an object, got ${kindOf(obj)}`);
  for (const [k, kind] of Object.entries(spec)) {
    const got = kindOf(obj[k]);
    expect(got === kind, `${label}.${k}: expected ${kind}, got ${got}`);
  }
}
