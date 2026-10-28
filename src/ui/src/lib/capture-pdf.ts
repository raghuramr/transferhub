import { planPage } from './capture-logic';

export interface JpegPage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Combines captured JPEG pages (in order) into ONE PDF, entirely in the browser. pdf-lib is loaded on demand so it
 * is not part of the main bundle. Each page is A4 (portrait or landscape to match the photo) with the image centred.
 */
export async function buildPdf(pages: JpegPage[], title = 'Scanned document'): Promise<Uint8Array> {
  if (!pages.length) throw new Error('No pages to combine');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('TransferHub');
  for (const p of pages) {
    const img = await doc.embedJpg(p.bytes);
    const plan = planPage(p.width, p.height);
    const page = doc.addPage([plan.pageWidth, plan.pageHeight]);
    page.drawImage(img, { x: plan.x, y: plan.y, width: plan.width, height: plan.height });
  }
  return doc.save();
}
