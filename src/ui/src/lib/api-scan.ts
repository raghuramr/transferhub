import { api } from './api';
import type { IntakeDetail, IntakeItem } from './api';
import { withRetry } from './retry';

/** Layout words an OCR reader (Azure Document Intelligence) may have stored with the extraction. */
export interface ScanLayout {
  pages: { page: number; words: { t: string; b: [number, number, number, number] }[] }[];
}

/** The private file behind a document, fetched with the session (the download endpoint is authenticated). */
export async function fetchUploadBlob(uploadId: string, signal?: AbortSignal): Promise<Blob> {
  const res = await api.get<Blob>(`/uploads/${uploadId}`, { responseType: 'blob', signal });
  return res.data;
}

export async function fetchIntakeDetail(id: string): Promise<IntakeDetail & { extracted: (IntakeDetail['extracted'] & { layout?: ScanLayout }) | null }> {
  return (await api.get(`/documents/intakes/${id}`)).data;
}

export interface UploadHandlers {
  onProgress?: (percent: number) => void;
  onRetry?: (attempt: number, waitMs: number) => void;
  signal?: AbortSignal;
}

/**
 * Sends files to Smart Upload with progress and automatic retries (network drops, 5xx, 429).
 * Not chunked - a retry restarts the request, which is fine for the 15 MB limit.
 */
export function uploadSmartDocuments(files: File[], h: UploadHandlers = {}): Promise<IntakeItem[]> {
  return withRetry(
    async () => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
      h.onProgress?.(0);
      const res = await api.post<{ items: IntakeItem[] }>('/documents/smart-upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
        signal: h.signal,
        onUploadProgress: (e) => {
          if (e.total) h.onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
        },
      });
      h.onProgress?.(100);
      return res.data.items;
    },
    { onRetry: (attempt, wait) => h.onRetry?.(attempt, wait), shouldStop: () => !!h.signal?.aborted },
  );
}
