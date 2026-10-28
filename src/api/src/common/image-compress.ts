import { Logger } from '@nestjs/common';
import type { UploadedFileLike } from './uploaded-file.interface';

const log = new Logger('ImageCompress');
const COMPRESSIBLE = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Shrinks an uploaded raster image before it is stored: auto-rotates from EXIF, fits it inside maxEdge x maxEdge (never
 * enlarges) and re-encodes as WebP (public images) or JPEG (documents - Azure Document Intelligence does not read WebP). Keeps the original if sharp is unavailable, the file is not a JPEG/PNG/WebP, or the
 * result is not smaller - so a failure here never blocks an upload. PDFs/SVGs/GIFs are left alone.
 */
export async function compressImage(file: UploadedFileLike, maxEdge: number, quality = 80, format: 'webp' | 'jpeg' = 'webp'): Promise<UploadedFileLike> {
  if (!COMPRESSIBLE.includes(file.mimetype)) return file;
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(file.buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .toFormat(format, { quality })
      .toBuffer();
    if (out.length >= file.buffer.length) return file;
    const base = file.originalname.replace(/\.[^.]+$/, '') || 'image';
    return { originalname: `${base}.${format === 'jpeg' ? 'jpg' : 'webp'}`, buffer: out, mimetype: `image/${format}`, size: out.length };
  } catch (e) {
    log.warn(`Image not compressed (${(e as Error).message}); storing the original`);
    return file;
  }
}
