import axios, { AxiosError } from 'axios';
import type { AuthTokens, ApiError, CourseTopic, TranscriptSummary, Transcript, User } from '../types';

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
  logout: () => api.post('/auth/logout'),
  me: () => api.get<AuthTokens['user']>('/auth/me'),
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
  upload: (file: File, opts?: { isPublic?: boolean; entityType?: string; entityId?: string }) => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.isPublic) form.append('isPublic', 'true');
    if (opts?.entityType) form.append('entityType', opts.entityType);
    if (opts?.entityId) form.append('entityId', opts.entityId);
    return api.post('/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
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
