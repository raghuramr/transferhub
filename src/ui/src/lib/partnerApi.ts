/** Client for the public partner API (/api/public/v1). Uses the partner's API key, never a user login. */
const BASE = import.meta.env.VITE_API_URL ?? '/api';

export interface PartnerIdentity {
  universityName: string;
  universityCode: string;
  contactName: string;
}

export interface SubmissionResult {
  reference: string;
  status: string;
  received: { universities: number; programs: number; courses: number; students?: number };
  validation: { valid: number; warnings: number; errors: number };
}

export interface SubmissionListItem {
  reference: string;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  counts: { total?: number; pending?: number; created?: number; updated?: number; rejected?: number; failed?: number; errors?: number };
}

export interface SubmissionDetail extends SubmissionListItem {
  message: string | null;
  rows: { rowNo: number; type: string; item: string; status: string; message: string }[];
}

export interface FormatDoc {
  notes: string[];
  schemas: Record<string, { description: string; requiredFields: string[]; optionalFields: string[]; example: unknown }>;
}

export interface SubmissionBody {
  note?: string;
  universities?: Record<string, unknown>[];
  programs?: Record<string, unknown>[];
  courses?: Record<string, unknown>[];
  students?: Record<string, unknown>[];
}

async function call<T>(path: string, key: string | null, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}/public/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const m = data?.message;
    throw new Error(Array.isArray(m) ? m.join(' ') : m ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const partnerApi = {
  me: (key: string) => call<PartnerIdentity>('/me', key),
  format: () => call<FormatDoc>('/format', null),
  submit: (key: string, body: SubmissionBody) => call<SubmissionResult>('/submissions', key, { method: 'POST', body }),
  list: (key: string) => call<{ submissions: SubmissionListItem[] }>('/submissions', key),
  get: (key: string, ref: string) => call<SubmissionDetail>(`/submissions/${encodeURIComponent(ref)}`, key),
};
