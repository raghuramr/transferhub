/** Pure helpers for the camera capture flow (no DOM): sizing, page layout, reorder/delete, auto-levels. Unit tested. */

export const MAX_EDGE = 2000;
export const A4: [number, number] = [595.28, 841.89];

/** Scale (w, h) down so the long edge is at most `max`; never upscales. Always whole pixels >= 1. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): { width: number; height: number; scale: number } {
  const long = Math.max(w, h);
  const scale = long > max ? max / long : 1;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

export interface PagePlan {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One image on one PDF page: A4 portrait or landscape (matching the photo), image fitted inside the margin and centred. */
export function planPage(imgW: number, imgH: number, margin = 14, size: [number, number] = A4): PagePlan {
  const landscape = imgW > imgH;
  const pageWidth = landscape ? size[1] : size[0];
  const pageHeight = landscape ? size[0] : size[1];
  const availW = pageWidth - margin * 2;
  const availH = pageHeight - margin * 2;
  const k = Math.min(availW / imgW, availH / imgH);
  const width = imgW * k;
  const height = imgH * k;
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return [...arr];
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function removeAt<T>(arr: readonly T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

/**
 * Auto-levels for document photos: from a 256-bin luminance histogram, the black and white points that clip
 * `clip` of the pixels at each end. Returns null when the image is already well spread (no change needed) or flat.
 */
export function computeLevels(hist: ArrayLike<number>, clip = 0.01): { lo: number; hi: number } | null {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i] || 0;
  if (!total) return null;
  let acc = 0;
  let lo = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i] || 0; if (acc >= total * clip) { lo = i; break; } }
  acc = 0;
  let hi = 255;
  for (let i = 255; i >= 0; i--) { acc += hist[i] || 0; if (acc >= total * clip) { hi = i; break; } }
  if (hi - lo < 24) return null; // practically flat: stretching would only amplify noise
  if (lo <= 4 && hi >= 251) return null;
  return { lo, hi };
}

/** Lookup table that stretches [lo, hi] to [0, 255] (with a slight lift so paper looks white, not grey). */
export function levelsTable(lo: number, hi: number, lift = 1.0): Uint8Array {
  const t = new Uint8Array(256);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, Math.max(0, (i - lo) / span));
    t[i] = Math.round(Math.pow(v, 1 / lift) * 255);
  }
  return t;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
