import type { DocLayout } from './document-types';

/** The parts of an Azure Document Intelligence `analyzeResult` that the layout needs. */
export interface DiAnalyzeResult {
  content?: string;
  pages?: {
    pageNumber?: number;
    width?: number;
    height?: number;
    words?: { content?: string; polygon?: number[] }[];
  }[];
}

const MAX_WORDS = 6000;
const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Turns DI word polygons (page units: inches for PDFs, pixels for images) into normalised 0..1 boxes
 * [x, y, w, h] so the browser can draw highlights at any size. Returns undefined when DI gave no usable
 * words, so nothing is ever drawn from made-up positions. Pure, unit tested.
 */
export function buildLayout(result: DiAnalyzeResult | undefined | null): DocLayout | undefined {
  if (!result || !Array.isArray(result.pages)) return undefined;
  const pages: DocLayout['pages'] = [];
  let total = 0;
  for (const p of result.pages) {
    const W = Number(p.width);
    const H = Number(p.height);
    if (!(W > 0) || !(H > 0) || !Array.isArray(p.words)) continue;
    const words: DocLayout['pages'][number]['words'] = [];
    for (const w of p.words) {
      const poly = w.polygon;
      if (!w.content || !Array.isArray(poly) || poly.length < 8 || poly.some((n) => typeof n !== 'number' || !Number.isFinite(n))) continue;
      const xs = poly.filter((_, i) => i % 2 === 0);
      const ys = poly.filter((_, i) => i % 2 === 1);
      const x1 = Math.max(0, Math.min(...xs) / W);
      const y1 = Math.max(0, Math.min(...ys) / H);
      const x2 = Math.min(1, Math.max(...xs) / W);
      const y2 = Math.min(1, Math.max(...ys) / H);
      if (x2 <= x1 || y2 <= y1) continue;
      if (++total > MAX_WORDS) break;
      words.push({ t: w.content.slice(0, 80), b: [round(x1), round(y1), round(x2 - x1), round(y2 - y1)] });
    }
    if (words.length) pages.push({ page: Number(p.pageNumber) || pages.length + 1, words });
    if (total > MAX_WORDS) break;
  }
  return pages.length ? { pages } : undefined;
}
