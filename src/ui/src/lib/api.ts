import axios, { AxiosError } from 'axios';
import type { AuthTokens, ApiError } from '../types';

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
  list: (params?: Record<string, unknown>) => api.get('/users', { params }),
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
  update: (id: number, data: unknown) => api.patch(`/courses/${id}`, data),
  deactivate: (id: number) => api.delete(`/courses/${id}`),
  institutions: () => api.get('/courses/institutions'),
  programs: (institutionId?: number) => api.get('/courses/programs', { params: { institutionId } }),
  export: () => api.get('/courses/export', { responseType: 'blob' }),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/courses/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ── Course Topics endpoints (reference-link detail per course) ────
export const courseTopicsApi = {
  list: (courseId: number) => api.get(`/courses/${courseId}/topics`),
  create: (courseId: number, data: unknown) => api.post(`/courses/${courseId}/topics`, data),
  update: (id: number, data: unknown) => api.patch(`/course-topics/${id}`, data),
  remove: (id: number) => api.delete(`/course-topics/${id}`),
};

// ── Transcripts endpoints ─────────────────────────────────────
export const transcriptsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get('/transcripts', { params }),
  get: (id: string) => api.get(`/transcripts/${id}`),
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
