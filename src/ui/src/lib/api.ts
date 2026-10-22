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
