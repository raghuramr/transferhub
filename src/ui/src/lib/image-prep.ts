import { computeLevels, fitWithin, levelsTable, MAX_EDGE } from './capture-logic';

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  /** Object URL for thumbnails; the caller revokes it. */
  url: string;
}

async function decode(src: Blob): Promise<{ draw: CanvasImageSource; width: number; height: number; close: () => void }> {
  // 'from-image' applies the EXIF orientation, so portrait phone photos are not sideways.
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
      return { draw: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode(); // modern browsers apply EXIF orientation to <img> by default
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Auto-levels in place; only touches the pixels when the page is visibly washed out. */
function autoLevels(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 16) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  const lv = computeLevels(hist);
  if (!lv) return;
  const t = levelsTable(lv.lo, lv.hi, 1.05);
  for (let i = 0; i < d.length; i += 4) { d[i] = t[d[i]]; d[i + 1] = t[d[i + 1]]; d[i + 2] = t[d[i + 2]]; }
  ctx.putImageData(img, 0, 0);
}

/**
 * Camera photo / chosen image -> upload-ready JPEG: EXIF-rotated, long edge <= 2000 px, quality ~0.8, optional
 * contrast boost. The server compresses again; this keeps mobile uploads small and fast.
 */
export async function prepareImage(src: Blob, opts: { enhance?: boolean; maxEdge?: number; quality?: number } = {}): Promise<PreparedImage> {
  const dec = await decode(src);
  try {
    const { width, height } = fitWithin(dec.width, dec.height, opts.maxEdge ?? MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: !!opts.enhance });
    if (!ctx) throw new Error('Canvas is not available in this browser');
    ctx.fillStyle = '#fff'; // PNG transparency -> white, JPEG has no alpha
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(dec.draw, 0, 0, width, height);
    if (opts.enhance) autoLevels(ctx, width, height);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), 'image/jpeg', opts.quality ?? 0.8));
    return { blob, width, height, url: URL.createObjectURL(blob) };
  } finally {
    dec.close();
  }
}
