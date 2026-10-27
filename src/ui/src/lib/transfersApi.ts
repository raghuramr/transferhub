import { api } from './api';
import type { ExchangeData, Party, TransferList, TransfersSummary } from '../types/transfers';

export const transfersApi = {
  summary: (params: { institutionId?: number; days?: number }) => api.get<TransfersSummary>('/transfers/summary', { params }),
  list: (params: { direction: 'incoming' | 'outgoing'; institutionId?: number; status?: string; q?: string; page?: number; pageSize?: number }) =>
    api.get<TransferList>('/transfers', { params }),
  detail: (id: string) => api.get<ExchangeData>(`/transfers/${id}`),
  createRequest: (id: string, data: { fromParty: Party; party?: Party; docTypeKey?: string; title?: string; message?: string; dueDate?: string }) =>
    api.post<ExchangeData>(`/transfers/${id}/document-requests`, data),
  cancelRequest: (id: string, rid: number, note?: string) => api.post<ExchangeData>(`/transfers/${id}/document-requests/${rid}/cancel`, { note }),
  declineRequest: (id: string, rid: number, note?: string) => api.post<ExchangeData>(`/transfers/${id}/document-requests/${rid}/decline`, { note }),
  fulfil: (id: string, rid: number, file: File, note?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (note) form.append('note', note);
    return api.post<{ exchange: ExchangeData }>(`/transfers/${id}/document-requests/${rid}/fulfil`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  upload: (id: string, file: File, opts: { party?: Party; documentType?: string; note?: string }) => {
    const form = new FormData();
    form.append('file', file);
    if (opts.party) form.append('party', opts.party);
    if (opts.documentType) form.append('documentType', opts.documentType);
    if (opts.note) form.append('note', opts.note);
    return api.post<{ exchange: ExchangeData }>(`/transfers/${id}/uploads`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  remind: (id: string, data: { toParty: Party; party?: Party; documentRequestId?: number; message?: string }) =>
    api.post<{ sent: number; emailConfigured: boolean; exchange: ExchangeData }>(`/transfers/${id}/reminders`, data),
};
