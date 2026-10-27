import axios, { AxiosError } from 'axios';
import type { Appeal, CreditSummary, ExamCreditRule, TransferPolicy } from '../types/policy';
import type { Partner, PartnerInput, IssuedKey, BatchSummary, BatchDetail, ImportRunResult } from '../types/import';
import type { AuthTokens, ApiError, CourseTopic, TranscriptSummary, Transcript, User } from '../types';
import type {
  AgentSkill, AiSettings, ApproverGroup, QueueRow, RequestTimeline, RequestUsageDetail, RequestUsageRow,
  BulkApproveResult, Readiness, StaffUser, UsageSummary, WorkflowDetail, WorkflowInsights, WorkflowStageDef, WorkflowSummary,
} from '../types/workflow';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
});

// ── Attach access token ──────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Auto-refresh on 401 ──────────────────────────────────────
let isRefreshing = false;
let queue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<ApiError>) => {
    const original = err.config as typeof err.config & { _retry?: boolean };
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      if (isRefreshing) {
        return new Promise((resolve) => {
          queue.push((token) => {
            original!.headers!.Authorization = `Bearer ${token}`;
            resolve(api(original!));
          });
        });
      }
      isRefreshing = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        const { data } = await axios.post<AuthTokens>(`${BASE}/auth/refresh`, {
          refreshToken,
        });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        queue.forEach((cb) => cb(data.accessToken));
        queue = [];
        original!.headers!.Authorization = `Bearer ${data.accessToken}`;
        return api(original!);
      } catch {
        localStorage.clear();
        window.location.href = '/login';
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(err);
  },
);

// ── Error helper ──────────────────────────────────────────────
/** Extracts the backend's error message from a failed mutation/query, falling back if the shape is unexpected. */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as ApiError | undefined;
    if (data?.message) return data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ── Auth endpoints ───────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthTokens>('/auth/login', { email, password }),
  refresh: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refreshToken }),
  /** Fire-and-forget on sign-out: the session is already cleared locally, so the tokens are passed explicitly. */
  logout: (refreshToken?: string, accessToken?: string) =>
    // Plain axios (no refresh interceptor): a 401 here must never wipe a session that is signed in again right after.
    axios.post(`${BASE}/auth/logout`, { refreshToken }, accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined),
  me: () => api.get<AuthTokens['user']>('/auth/me'),
  /** Public (no auth) — student self-registration; response auto-logs in like login(). */
  register: (data: unknown) => api.post<AuthTokens>('/auth/register', data),
  /** Public (no auth) — registration-page dropdown data. */
  publicRegistrationForm: () =>
    api.get<{ id: number; title: string; description: string | null; fields: import('../types').FormField[] } | ''>('/auth/registration-form'),
  publicUniversities: () => api.get<{ id: number; code: string; name: string }[]>('/auth/universities'),
  publicPrograms: (institutionId: number) =>
    api.get<{ id: number; name: string; degree: string | null; area: string | null }[]>('/auth/programs', {
      params: { institutionId },
    }),
  /** Public (no auth) — a university's schools/colleges (transfer applicants must choose one). */
  publicAcademicUnits: (institutionId: number) =>
    api.get<{ id: number; name: string; code: string | null }[]>('/auth/academic-units', { params: { institutionId } }),
};

// ── Users endpoints ───────────────────────────────────────────
export const usersApi = {
  list: (params?: Record<string, unknown>) => api.get<User[]>('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: unknown) => api.post('/users', data),
  update: (id: string, data: unknown) => api.patch(`/users/${id}`, data),
  deactivate: (id: string) => api.delete(`/users/${id}`),
  unlock: (id: string) => api.post(`/users/${id}/unlock`),
  getScope: (id: string) => api.get(`/users/${id}/scope`),
  setScope: (id: string, data: unknown) => api.put(`/users/${id}/scope`, data),
  export: () => api.get('/users/export', { responseType: 'blob' }),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/users/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ── Universities endpoints (SQL `Institutions` table) ──────────
export const universitiesApi = {
  list: (params?: Record<string, unknown>) => api.get('/universities', { params }),
  get: (id: number) => api.get(`/universities/${id}`),
  create: (data: unknown) => api.post('/universities', data),
  update: (id: number, data: unknown) => api.patch(`/universities/${id}`, data),
  deactivate: (id: number) => api.delete(`/universities/${id}`),
  export: () => api.get('/universities/export', { responseType: 'blob' }),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/universities/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  generatePage: (id: number) => api.post(`/universities/${id}/generate-page`),
};

// ── Institutions endpoints (SQL `AcademicUnits` table) ──────────
export const institutionsApi = {
  list: (params?: Record<string, unknown>) => api.get('/institutions', { params }),
  get: (id: number) => api.get(`/institutions/${id}`),
  create: (data: unknown) => api.post('/institutions', data),
  update: (id: number, data: unknown) => api.patch(`/institutions/${id}`, data),
  deactivate: (id: number) => api.delete(`/institutions/${id}`),
  export: (params?: Record<string, unknown>) => api.get('/institutions/export', { params, responseType: 'blob' }),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/institutions/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ── Agencies endpoints ───────────────────────────────────────────
export const agenciesApi = {
  list: (params?: Record<string, unknown>) => api.get('/agencies', { params }),
  get: (id: number) => api.get(`/agencies/${id}`),
  create: (data: unknown) => api.post('/agencies', data),
  update: (id: number, data: unknown) => api.patch(`/agencies/${id}`, data),
  deactivate: (id: number) => api.delete(`/agencies/${id}`),
  export: () => api.get('/agencies/export', { responseType: 'blob' }),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/agencies/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ── Courses endpoints ─────────────────────────────────────────
export const coursesApi = {
  listBU: (program?: string) =>
    api.get('/courses/bu', { params: { program } }),
  listExternal: (institution?: string) =>
    api.get('/courses/external', { params: { institution } }),
  equivalency: (code: string, institution: string) =>
    api.get('/courses/equivalency', { params: { code, institution } }),
  search: (q: string, institution?: string) =>
    api.get('/courses/search', { params: { q, institution } }),
  get: (id: number) => api.get(`/courses/${id}`),
  create: (data: unknown) => api.post('/courses', data),
  update: (id: number, data: unknown) => api.patch(`/courses/${id}`, data),
  deactivate: (id: number) => api.delete(`/courses/${id}`),
  institutions: () => api.get('/courses/institutions'),
  programs: (institutionId?: number, includeInactive?: boolean) =>
    api.get('/courses/programs', { params: { institutionId, includeInactive } }),
  byInstitution: (institutionId: number, search?: string) =>
    api.get(`/courses/by-institution/${institutionId}`, { params: { search } }),
  createProgram: (data: unknown) => api.post('/courses/programs', data),
  updateProgram: (id: number, data: unknown) => api.patch(`/courses/programs/${id}`, data),
  deactivateProgram: (id: number) => api.delete(`/courses/programs/${id}`),
  export: () => api.get('/courses/export', { responseType: 'blob' }),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/courses/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ── Uploads (private docs + public logo/hero images) ──────────
export const uploadsApi = {
  upload: (file: File, opts?: { isPublic?: boolean; entityType?: string; entityId?: string; documentType?: string }) => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.isPublic) form.append('isPublic', 'true');
    if (opts?.entityType) form.append('entityType', opts.entityType);
    if (opts?.entityId) form.append('entityId', opts.entityId);
    if (opts?.documentType) form.append('documentType', opts.documentType);
    return api.post('/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  list: (params?: { userId?: string; entityType?: string }) => api.get('/uploads', { params }),
};

// ── Course Topics endpoints (reference-link detail per course) ────
export const courseTopicsApi = {
  list: (courseId: number, institutionId?: number) =>
    api.get<CourseTopic[]>(`/courses/${courseId}/topics`, { params: { institutionId } }),
  create: (courseId: number, data: unknown) => api.post(`/courses/${courseId}/topics`, data),
  update: (id: number, data: unknown) => api.patch(`/course-topics/${id}`, data),
  remove: (id: number) => api.delete(`/course-topics/${id}`),
  /** Per-(University, Topic) active/inactive override — see migration 011. */
  setUniversityStatus: (id: number, institutionId: number, isActive: boolean) =>
    api.put(`/course-topics/${id}/university-status`, { institutionId, isActive }),
};

// ── Program <-> University / Course sharing (migration 011) ─────
export const programSharingApi = {
  listUniversities: (programId: number) => api.get(`/courses/programs/${programId}/universities`),
  addUniversity: (programId: number, institutionId: number) =>
    api.post(`/courses/programs/${programId}/universities`, { institutionId }),
  removeUniversity: (programId: number, institutionId: number) =>
    api.delete(`/courses/programs/${programId}/universities/${institutionId}`),
  listCourses: (programId: number) => api.get(`/courses/programs/${programId}/courses`),
  addCourse: (programId: number, courseId: number) =>
    api.post(`/courses/programs/${programId}/courses`, { courseId }),
  removeCourse: (programId: number, courseId: number) =>
    api.delete(`/courses/programs/${programId}/courses/${courseId}`),
};

// ── Transcripts endpoints ─────────────────────────────────────
export const transcriptsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<TranscriptSummary[]>('/transcripts', { params }),
  get: (id: string) => api.get<Transcript>(`/transcripts/${id}`),
  status: (id: string) => api.get(`/transcripts/${id}/status`),
  submit: (data: unknown) => api.post('/transcripts', data),
  document: (id: string) => api.get(`/transcripts/${id}/document`, { responseType: 'blob' }),
};

// ── Evaluations endpoints ─────────────────────────────────────
export const evaluationsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/evaluations', { params }),
  get: (id: string) => api.get(`/evaluations/${id}`),
  decide: (id: string, data: unknown) =>
    api.post(`/evaluations/${id}/decide`, data),
  assign: (id: string, data: unknown) =>
    api.post(`/evaluations/${id}/assign`, data),
  post: (id: string) => api.post(`/evaluations/${id}/post`),
};

// ── AI endpoints ──────────────────────────────────────────────
export const aiApi = {
  match: (evaluationId: string) =>
    api.post(`/ai/match/${evaluationId}`),
  analyzeSyllabus: (syllabusId: string) =>
    api.post(`/ai/analyze-syllabus/${syllabusId}`),
  candidates: (evaluationId: string) =>
    api.get(`/ai/candidates/${evaluationId}`),
};

// ── Custom Pages (CMS) endpoints ──────────────────────────────
export const pagesApi = {
  list: () => api.get('/pages'),
  nav: () => api.get('/pages/nav'),
  bySlug: (slug: string) => api.get(`/pages/by-slug/${slug}`),
  get: (id: number) => api.get(`/pages/${id}`),
  create: (data: unknown) => api.post('/pages', data),
  update: (id: number, data: unknown) => api.put(`/pages/${id}`, data),
  remove: (id: number) => api.delete(`/pages/${id}`),
};

// ── Custom Forms (JSON-schema) endpoints ──────────────────────
export const formsApi = {
  list: () => api.get('/forms'),
  bySlug: (slug: string) => api.get(`/forms/by-slug/${slug}`),
  get: (id: number) => api.get(`/forms/${id}`),
  create: (data: unknown) => api.post('/forms', data),
  update: (id: number, data: unknown) => api.put(`/forms/${id}`, data),
  remove: (id: number) => api.delete(`/forms/${id}`),
  submit: (id: number, data: unknown) => api.post(`/forms/${id}/submit`, { data }),
  submissions: (id: number) => api.get(`/forms/${id}/submissions`),
  decideSubmission: (submissionId: string, data: unknown) =>
    api.post(`/forms/submissions/${submissionId}/decide`, data),
};

// ── Roles & Permissions master-data endpoints (super_admin only, except `my`) ─
export const permissionsApi = {
  getModules: () => api.get('/permissions/modules'),
  getOperations: () => api.get('/permissions/operations'),
  getMatrix: () => api.get('/permissions/matrix'),
  saveMatrix: (entries: { roleId: number; moduleId: number; operationId: number; isAllowed: boolean }[]) =>
    api.put('/permissions/matrix', { entries }),
  /** The logged-in user's own effective grants: { [moduleKey]: { [operationKey]: boolean } }. */
  my: () => api.get<Record<string, Record<string, boolean>>>('/permissions/my'),
};


// ── Data Import endpoints (super_admin only) ──────────────────
export interface EmailAttempt { ok: boolean; id?: string; error?: string; to: string; subject: string; at: string }
export interface EmailTemplateSample { id: number; key: string; name: string; audience: string; subject: string; html: string }
export interface EmailStatus {
  configured: boolean;
  fromAddress: string;
  fromName: string;
  fromDomain: string;
  fromIsDefault: boolean;
  supportEmail: string;
  appBaseUrl: string;
  recent: EmailAttempt[];
}

export interface DemoLoginUser { userId: string; label: string; role: string; }
export interface DemoLoginPublic {
  enabled: boolean;
  users?: DemoLoginUser[];
}
export interface DemoLoginAdmin {
  enabled: boolean;
  users: Record<string, string>;
  resolved: DemoLoginUser[];
  ready: boolean;
}

export const demoLoginApi = {
  /** Public (no auth) - the accounts the login page may offer. */
  publicGet: () => api.get<DemoLoginPublic>('/auth/demo-login'),
  /** Public (no auth) - one-click sign-in as a configured demo user; returns a normal session. */
  loginAs: (userId: string) => api.post<AuthTokens>('/auth/demo-login', { userId }),
  get: () => api.get<DemoLoginAdmin>('/settings/demo-login'),
  save: (data: { enabled: boolean; users: Record<string, string> }) => api.put<DemoLoginAdmin>('/settings/demo-login', data),
};

export const emailApi = {
  status: () => api.get<EmailStatus>('/email/status'),
  test: (to?: string) => api.post<EmailAttempt>('/email/test', to ? { to } : {}),
  templates: () => api.get<EmailTemplateSample[]>('/email/templates'),
  sendSample: (id: number, to?: string) => api.post<EmailAttempt>(`/email/templates/${id}/send`, to ? { to } : {}),
};

export const importApi = {
  getFormat: () => api.get('/import/format'),
  endpointInfo: () => api.get<{ baseUrl: string; submitUrl: string; formatUrl: string }>('/import/endpoint-info'),
  preview: (type: string, data: unknown[]) => api.post('/import/preview', { type, data }),
  execute: (type: string, data: unknown[]) => api.post('/import', { type, data }),
  // partners & API keys
  partners: () => api.get<Partner[]>('/import/partners'),
  createPartner: (data: PartnerInput) => api.post<IssuedKey & { partnerId: number }>('/import/partners', data),
  updatePartner: (id: number, data: Partial<PartnerInput>) => api.patch(`/import/partners/${id}`, data),
  setPartnerActive: (id: number, active: boolean) => api.post(`/import/partners/${id}/${active ? 'activate' : 'deactivate'}`),
  issueKey: (id: number, data: { label?: string; expiresInDays?: number; emailKey?: boolean }) =>
    api.post<IssuedKey>(`/import/partners/${id}/keys`, data),
  revokeKey: (id: number, keyId: number) => api.delete(`/import/partners/${id}/keys/${keyId}`),
  // submissions (staging + review)
  batches: (params?: { status?: string; partnerId?: number }) => api.get<BatchSummary[]>('/import/batches', { params }),
  batch: (id: number) => api.get<BatchDetail>(`/import/batches/${id}`),
  stage: (body: { note?: string; universities?: unknown[]; programs?: unknown[]; courses?: unknown[] }) =>
    api.post<{ reference: string; batchId: number }>('/import/batches', body),
  editRow: (id: number, rowId: number, payload: Record<string, unknown>) => api.patch(`/import/batches/${id}/rows/${rowId}`, { payload }),
  rejectRows: (id: number, rowIds: number[], note?: string) => api.post(`/import/batches/${id}/rows/reject`, { rowIds, note }),
  restoreRows: (id: number, rowIds: number[]) => api.post(`/import/batches/${id}/rows/restore`, { rowIds }),
  importRows: (id: number, rowIds: number[], opts: { sendReport?: boolean; note?: string }) =>
    api.post<ImportRunResult>(`/import/batches/${id}/import`, { rowIds, ...opts }),
  rejectBatch: (id: number, note: string, sendReport = true) => api.post(`/import/batches/${id}/reject`, { note, sendReport }),
  sendReport: (id: number, note?: string) => api.post<{ sent: boolean; message: string }>(`/import/batches/${id}/send-report`, { note }),
};

// ── Transfer request workflow (stages, decisions, notes, reminders) ───
export const requestsApi = {
  queue: (scope: 'mine' | 'all') =>
    api.get<{ scope: string; total: number; overdue: number; rows: QueueRow[] }>('/requests/queue', { params: { scope } }),
  timeline: (id: string) => api.get<RequestTimeline>(`/requests/${id}`),
  decide: (id: string, data: { decision: 'approve' | 'reject' | 'return'; comment?: string; studentComment?: string }) =>
    api.post<{ message: string; timeline: RequestTimeline }>(`/requests/${id}/decision`, data),
  acceptSuggestions: (id: string, minConfidence: number) =>
    api.post<{ accepted: number; belowThreshold: number; timeline: RequestTimeline }>(`/requests/${id}/accept-suggestions`, { minConfidence }),
  makeOfficial: (id: string) => api.post<{ message: string; timeline: RequestTimeline }>(`/requests/${id}/make-official`),
  passFailException: (id: string, courseId: string, exception: boolean) =>
    api.post<{ message: string; timeline: RequestTimeline }>(`/requests/${id}/courses/${courseId}/pass-fail-exception`, { exception }),
  bulkApprove: (ids: string[], comment?: string) => api.post<BulkApproveResult>('/requests/bulk-approve', { ids, comment }),
  skipStage: (id: string, reason: string) => api.post<{ timeline: RequestTimeline }>(`/requests/${id}/skip-stage`, { reason }),
  accept: (id: string, reason: string) => api.post<{ timeline: RequestTimeline }>(`/requests/${id}/accept`, { reason }),
  startWorkflow: (id: string) => api.post<{ timeline: RequestTimeline }>(`/requests/${id}/start-workflow`),
  resume: (id: string) => api.post<{ timeline: RequestTimeline }>(`/requests/${id}/resume`),
  addNote: (id: string, data: { audience: 'internal' | 'student'; body: string; stageId?: number }) =>
    api.post<RequestTimeline>(`/requests/${id}/notes`, data),
  addDocument: (id: string, data: { docTypeKey: string; uploadId: string; transcriptCourseId?: string; notes?: string }) =>
    api.post<RequestTimeline>(`/requests/${id}/documents`, data),
  removeDocument: (id: string, docId: number) => api.delete<RequestTimeline>(`/requests/${id}/documents/${docId}`),
  remind: (id: string, message?: string) =>
    api.post<{ sent: number; direction: string; emailConfigured: boolean }>(`/requests/${id}/remind`, { message }),
  aiUsage: (id: string) => api.get<RequestUsageDetail>(`/requests/${id}/ai-usage`),
};

// ── Workflow designer + approver groups ───────────────────────
export interface SaveWorkflowPayload {
  name: string;
  description?: string | null;
  allowBypass: boolean;
  isActive: boolean;
  stages: WorkflowStageDef[];
  requiredDocs: { docTypeKey: string; isRequired: boolean }[];
}
export const workflowsApi = {
  insights: (days: number) => api.get<WorkflowInsights>('/workflows/insights', { params: { days } }),
  list: () => api.get<WorkflowSummary[]>('/workflows'),
  get: (id: number) => api.get<WorkflowDetail>(`/workflows/${id}`),
  lookups: () =>
    api.get<{ staff: StaffUser[]; groups: ApproverGroup[]; documentTypes: { docTypeKey: string; label: string }[] }>('/workflows/lookups'),
  create: (data: { institutionId: number; name: string; copyFromWorkflowId?: number }) => api.post<WorkflowDetail>('/workflows', data),
  save: (id: number, data: SaveWorkflowPayload) => api.put<WorkflowDetail>(`/workflows/${id}`, data),
  remove: (id: number) => api.delete<{ message: string }>(`/workflows/${id}`),
  saveGroup: (id: number | null, data: { name: string; description?: string; isActive: boolean; memberUserIds: string[] }) =>
    id ? api.put<ApproverGroup>(`/approver-groups/${id}`, data) : api.post<ApproverGroup>('/approver-groups', data),
  removeGroup: (id: number) => api.delete<{ message: string }>(`/approver-groups/${id}`),
};

// ── AI controls: spend switches, agent playbook, token accounting ──
export const aiControlsApi = {
  readiness: () => api.get<Readiness>('/ai-controls/readiness'),
  settings: () => api.get<AiSettings[]>('/ai-controls/settings'),
  saveSettings: (data: Partial<AiSettings> & { institutionId?: number | null }) => api.put<AiSettings>('/ai-controls/settings', data),
  removeOverride: (institutionId: number) => api.delete(`/ai-controls/settings/${institutionId}`),
  skills: () => api.get<AgentSkill[]>('/ai-controls/skills'),
  saveSkill: (id: number | null, data: Omit<AgentSkill, 'id' | 'tokenEstimate' | 'skillKey'> & { skillKey?: string }) =>
    id ? api.put<AgentSkill>(`/ai-controls/skills/${id}`, data) : api.post<AgentSkill>('/ai-controls/skills', data),
  removeSkill: (id: number) => api.delete(`/ai-controls/skills/${id}`),
  promptPreview: () => api.get<{ text: string; tokenEstimate: number; skillCount: number }>('/ai-controls/prompt-preview'),
  summary: (days: number) => api.get<UsageSummary>('/ai-controls/usage/summary', { params: { days } }),
  byRequest: (days: number) => api.get<RequestUsageRow[]>('/ai-controls/usage/requests', { params: { days } }),
  clearCache: () => api.post<{ cleared: number }>('/ai-controls/cache/clear'),
};

// ── Transfer policy (per-university rules) ──
export const policiesApi = {
  list: () => api.get<TransferPolicy[]>('/policies'),
  save: (data: Partial<TransferPolicy> & { institutionId?: number | null }) => api.put<TransferPolicy>('/policies', data),
  removeOverride: (institutionId: number) => api.delete(`/policies/${institutionId}`),
  myCredit: () => api.get<CreditSummary>('/policies/my-credit'),
  examRules: (institutionId?: number | null) => api.get<ExamCreditRule[]>('/policies/exam-rules', { params: institutionId ? { institutionId } : {} }),
  saveExamRule: (rule: Partial<ExamCreditRule>) => api.put<ExamCreditRule>('/policies/exam-rules', rule),
  removeExamRule: (id: number) => api.delete(`/policies/exam-rules/${id}`),
};

// ── Transfer credit appeals (BU Transfer Credit Appeal Form) ──
export const appealsApi = {
  create: (requestId: string, courseId: string, data: { proposedBUCourseId?: number; proposedEquivalent?: string; reason: string; syllabusUploadId?: string }) =>
    api.post<{ id: number; message: string }>(`/requests/${requestId}/courses/${courseId}/appeal`, data),
  forRequest: (requestId: string) => api.get<Appeal[]>(`/requests/${requestId}/appeals`),
  list: (status: 'open' | 'decided' | 'all') => api.get<Appeal[]>('/appeals', { params: { status } }),
  decide: (id: number, data: {
    outcome: 'equivalent' | 'elective' | 'no_credit' | 'denied'; buCourseId?: number; awardedCredits?: number; satisfiesRequirement?: string;
    denialReason?: string; departmentName: string; comments?: string; signedName: string;
  }) => api.post<{ message: string }>(`/appeals/${id}/decide`, data),
};

// ── Course equivalencies (with effective-date windows) ────────────
export const equivalenciesApi = {
  list: (params?: { status?: string; search?: string; externalCourseId?: number; buCourseId?: number }) =>
    api.get('/equivalencies', { params }),
  create: (data: unknown) => api.post('/equivalencies', data),
  update: (id: number, data: unknown) => api.patch(`/equivalencies/${id}`, data),
  deactivate: (id: number) => api.delete(`/equivalencies/${id}`),
};

// ── Account: profile photo + email change ─────────────────────────
export const accountApi = {
  photo: (userId: string) => api.get<Blob>(`/account/photo/${userId}`, { responseType: 'blob' }),
  setPhoto: (blob: Blob) => {
    const form = new FormData();
    form.append('file', blob, 'photo.jpg');
    return api.put('/account/photo', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  removePhoto: () => api.delete('/account/photo'),
  setUserPhoto: (userId: string, blob: Blob) => {
    const form = new FormData();
    form.append('file', blob, 'photo.jpg');
    return api.put(`/account/photo/${userId}`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  removeUserPhoto: (userId: string) => api.delete(`/account/photo/${userId}`),
  resetDefaultPhotos: () => api.post<{ cleared: number }>('/account/photos/reset-defaults'),
  requestEmailChange: (newEmail: string, password: string) =>
    api.post<{ message: string; emailSent: boolean }>('/account/email-change', { newEmail, password }),
  confirmEmailChange: (token: string) => api.post<{ email: string }>('/account/email-change/confirm', { token }),
  // Student target university / program
  targets: () => api.get<TargetUniversityOption[]>('/account/targets'),
  setTarget: (institutionId: number, programId?: number) =>
    api.put<{ ok: boolean; warning: string | null }>('/account/target', { institutionId, ...(programId ? { programId } : {}) }),
  studentOverview: () => api.get<StudentOverview>('/account/student-overview'),
  updateStudentProfile: (patch: { currentInstitution?: string | null; currentProgram?: string | null }) =>
    api.put<{ ok: boolean }>('/account/student-profile', patch),
};

export interface TargetUniversityOption {
  id: number; code: string; name: string;
  programs: { id: number; name: string; degree: string | null }[];
}
export interface StudentOverview {
  currentInstitution: string | null; currentProgram: string | null; highestEducationLevel: string | null;
  targetInstitutionId: number | null; targetInstitutionName: string | null; targetInstitutionCode: string | null;
  targetProgramId: number | null; targetProgramName: string | null; targetProgramDegree: string | null;
  creditsCompleted: number | null; submittedCourses: number; submittedCredits: number | null;
}

// ── Course verification requests (faculty raise, admins resolve) ──
export const verificationApi = {
  list: (params?: { status?: string; mine?: boolean }) => api.get('/verification-requests', { params }),
  raise: (courseId: number, reason: string) => api.post('/verification-requests', { courseId, reason }),
  resolve: (id: number, status: 'verified' | 'rejected', note?: string) => api.post(`/verification-requests/${id}/resolve`, { status, note }),
};

// ── Dashboards (role-aware KPIs + charts) ─────────────────────────
export interface DashboardKpi { key: string; label: string; value: number | string; hint?: string; tone?: 'good' | 'warn' | 'bad' | 'neutral'; gauge?: number }
export interface DashboardChart {
  key: string;
  title: string;
  subtitle?: string;
  type: 'bar' | 'hbar' | 'pie' | 'area' | 'line' | 'stacked';
  data: Record<string, string | number>[];
  series?: { key: string; label: string }[];
}
export interface DashboardPayload { role: string; days: number; ranges: number[]; generatedAt: string; kpis: DashboardKpi[]; charts: DashboardChart[] }
export interface BentoPayload {
  currency: string;
  revenue: { label: string; value: number; delta: string; note?: string; caption?: string; series: { label: string; value: number }[] };
  sessions: {
    label: string; value: number; delta: string; note?: string;
    desktop: number[][]; mobile: number[][];
    labels?: { desktop: string; mobile: string; prior: string; current: string };
  };
  categories: {
    title: string;
    groups: { id: string; name: string; color: string; ink?: 'dark' | 'light' }[];
    periods: { label: string; total: number; delta: string; compare: string }[];
    items: { name: string; group: string; values: number[] }[];
    table?: { columns: string[]; rows: { label: string; values: string[] }[] };
  };
  seasonality: {
    title: string;
    axis?: string[];
    years: {
      label: string;
      values: number[];
      stats: { label: string; value: number; delta: string; note: string }[];
      rows: { label: string; value: string }[];
    }[];
  };
}
export const dashboardApi = {
  get: (days?: number) => api.get<DashboardPayload>('/dashboard', { params: { days } }),
  bento: (days?: number) => api.get<BentoPayload>('/dashboard/bento', { params: { days } }),
};

// ── Student intake (look up records from a previous university) ──
export interface IntakeCourse { courseCode: string; courseTitle: string; credits: number; grade: string; term?: string | null }
export interface IntakeSession {
  profile: {
    firstName: string; lastName: string; email: string; idType: string; maskedId: string;
    institutionCode: string; institutionName: string; programName?: string | null; degree?: string | null;
    fieldOfStudy?: string | null; gpa?: number | null; graduationYear?: number | null; creditsCompleted?: number | null;
    country?: string | null; phone?: string | null;
  };
  courses: IntakeCourse[];
  documents: { docType: string; fileName: string }[];
  universities: { id: number; code: string; name: string }[];
  accountExists: boolean;
}
export interface IntakeOverview {
  shareUrl: string;
  counts: { profiles: number; mockProfiles: number; openSessions: number; claimed: number };
  demoProfiles: { id: number; externalId: string; idType: string; email: string; institutionCode: string; firstName: string; lastName: string; claimed: boolean }[];
  recentSessions: { id: string; email: string; channel: string; status: string; createdAt: string; claimedAt: string | null; institutionCode: string }[];
}
export const intakeApi = {
  lookup: (data: { idNumber: string; email: string; universityCode?: string; channel?: string }) =>
    api.post<{ message: string; demo?: { claimUrl: string } }>('/intake/lookup', data),
  session: (token: string) => api.get<IntakeSession>('/intake/session', { params: { token } }),
  claim: (data: { token: string; password: string; consent: true; targetInstitutionId?: number; mobile?: string; submitForEvaluation?: boolean }) =>
    api.post<AuthTokens>('/intake/claim', data),
  adminOverview: () => api.get<IntakeOverview>('/intake/admin/overview'),
  adminInvite: (sourceProfileId: number) => api.post<{ sent: boolean }>('/intake/admin/invite', { sourceProfileId }),
};

// ── AI document reading (smart upload) ────────────────────────────
export type IntakeStatus = 'uploaded' | 'reading' | 'read' | 'needs_review' | 'confirmed' | 'failed' | 'skipped';
export interface IntakeItem {
  id: string;
  fileName: string;
  status: IntakeStatus;
  docType: string | null;
  confidence: number | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  aiEnabled: boolean;
}
export interface ExtractedDocument {
  docType: string;
  confidence: number;
  summary: string;
  fields: Record<string, unknown>;
}
export interface IntakeDetail extends IntakeItem {
  extracted: ExtractedDocument | null;
  uploadId: string;
  mimeType: string;
  confirmedAt: string | null;
}
export interface TranscriptPrefill {
  institutionName: string;
  institutionCode: string;
  calendar: string;
  studentName: string;
  studentId: string;
  courses: { courseCode: string; courseTitle: string; originalCredits: number; grade: string; term?: string; termSeason?: string; termYear?: number }[];
  documentUploadId: string;
  isOutsideUS?: boolean;
}
export interface DocumentsStatus {
  /** True only when the Anthropic reader is active. */
  aiAvailable?: boolean;
  /** 'anthropic' | 'rules' (built-in, no AI) | 'paused' */
  reader?: 'anthropic' | 'rules' | 'paused';
  /** True when the built-in rules reader is standing in for AI. */
  fallback?: boolean;
  reason?: string | null;
  docTypes: { key: string; label: string }[];
}
export const documentsApi = {
  status: () => api.get<DocumentsStatus>('/documents/status'),
  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return api.post<{ items: IntakeItem[] }>('/documents/smart-upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  list: () => api.get<IntakeItem[]>('/documents/intakes'),
  get: (id: string) => api.get<IntakeDetail>(`/documents/intakes/${id}`),
  update: (id: string, data: { docType?: string; extracted?: ExtractedDocument }) => api.patch<IntakeDetail>(`/documents/intakes/${id}`, data),
  retry: (id: string) => api.post<IntakeItem>(`/documents/intakes/${id}/retry`),
  confirm: (id: string) =>
    api.post<{ ok: boolean; docType: string; applied: { education: boolean; profile: boolean }; prefill?: TranscriptPrefill }>(`/documents/intakes/${id}/confirm`),
  prefill: (id: string) => api.get<TranscriptPrefill>(`/documents/intakes/${id}/prefill`),
};
