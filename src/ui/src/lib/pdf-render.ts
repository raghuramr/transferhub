import type { TextItem } from './scan-match';
import type { ScanLayout } from './api-scan';

export interface RenderedPage {
  /** Object URL of the page picture (JPEG). Revoke with `disposePages`. */
  url: string;
  /** Picture size in pixels (for the aspect ratio before it loads). */
  width: number;
  height: number;
  items: TextItem[];
  /** Where the positions came from: the PDF's own text layer, the OCR words, or nowhere. */
  source: 'pdf-text' | 'ocr' | 'none';
}

const MAX_PAGES = 8;
const TARGET_WIDTH = 1100;

export function disposePages(pages: RenderedPage[]) {
  for (const p of pages) URL.revokeObjectURL(p.url);
}

function layoutItems(layout: ScanLayout | undefined, page: number): TextItem[] {
  const lp = layout?.pages.find((p) => p.page === page);
  if (!lp) return [];
  return lp.words.map((w) => ({ page: page - 1, str: w.t, x: w.b[0], y: w.b[1], w: w.b[2], h: w.b[3] }));
}

/** An uploaded image: shown as is; positions only come from OCR layout words when the server stored them. */
export async function renderImage(blob: Blob, layout?: ScanLayout): Promise<RenderedPage[]> {
  const url = URL.createObjectURL(blob);
  const dims = await new Promise<{ w: number; h: number }>((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => res({ w: 3, h: 4 });
    img.src = url;
  });
  const items = layoutItems(layout, 1);
  return [{ url, width: dims.w, height: dims.h, items, source: items.length ? 'ocr' : 'none' }];
}

/** Renders PDF pages to pictures and reads their text positions. pdf.js and its worker are loaded on demand. */
export async function renderPdf(blob: Blob, layout?: ScanLayout): Promise<RenderedPage[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  const data = new Uint8Array(await blob.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out: RenderedPage[] = [];
  try {
    const count = Math.min(pdf.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, TARGET_WIDTH / base.width);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const jpeg: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/jpeg', 0.9));

      // Text positions in the unscaled viewport, normalised to 0..1 (top-left origin).
      const items: TextItem[] = [];
      if (base.rotation === 0) {
        const tc = await page.getTextContent();
        for (const it of tc.items) {
          if (!('str' in it) || !it.str.trim()) continue;
          const [vx, vy] = base.convertToViewportPoint(it.transform[4], it.transform[5]);
          const h = it.height || Math.hypot(it.transform[2], it.transform[3]);
          if (!(it.width > 0) || !(h > 0)) continue;
          items.push({ page: n - 1, str: it.str, x: vx / base.width, y: (vy - h) / base.height, w: it.width / base.width, h: (h * 1.15) / base.height });
        }
      }
      let source: RenderedPage['source'] = items.length >= 3 ? 'pdf-text' : 'none';
      let used = items;
      if (source === 'none') {
        // A scanned PDF has no text layer; fall back to OCR words from the reader when it stored them.
        const ocr = layoutItems(layout, n);
        if (ocr.length) { used = ocr; source = 'ocr'; } else used = [];
      }
      out.push({ url: URL.createObjectURL(jpeg), width: canvas.width, height: canvas.height, items: used, source });
      page.cleanup();
    }
  } finally {
    void pdf.destroy();
  }
  return out;
}
