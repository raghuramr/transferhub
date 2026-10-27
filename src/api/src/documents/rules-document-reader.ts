import { Injectable, Logger } from '@nestjs/common';
import { Availability, DocumentReader, ReadInput, ReadResult } from './document-reader';
import { RULES_MODEL, extractFromText } from './rules-helpers';

// pdf-parse's package root runs a self-test when loaded without a parent; the lib file is the safe entry point.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadPdfParse = (): ((b: Buffer | Uint8Array, o?: Record<string, unknown>) => Promise<{ text: string }>) => require('pdf-parse/lib/pdf-parse.js');

const MAX_BYTES = 15_000_000;
const MAX_PAGES = 15;
const PDF_TIMEOUT_MS = 20_000;
const TEXT_EXT = /\.(txt|csv|md|text|log|json|xml|html?)$/i;

export const RULES_REASON = 'AI reading is unavailable, so documents are read by the built-in reader (less accurate - please check the fields).';

/** Same-row items joined with spaces so table rows ("CS 101  Intro  3.0  A") stay on one line. */
async function pageRender(page: any): Promise<string> {
  const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  const rows: { y: number; items: { x: number; s: string }[] }[] = [];
  for (const it of content.items as { str: string; transform: number[] }[]) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5];
    const x = it.transform[4];
    let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (!row) rows.push((row = { y, items: [] }));
    row.items.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join('  ')).join('\n');
}

export async function pdfToText(bytes: Buffer): Promise<string> {
  const parse = loadPdfParse();
  // pdf.js 1.x mis-reads a pooled Buffer ("bad XRef entry"); a plain Uint8Array copy is fine.
  const run = parse(new Uint8Array(bytes), { max: MAX_PAGES, pagerender: pageRender });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('PDF took too long to read')), PDF_TIMEOUT_MS); });
  try {
    return (await Promise.race([run, timeout])).text ?? '';
  } finally {
    if (timer) clearTimeout(timer);
    run.catch(() => undefined); // a late rejection after the timeout must not become unhandled
  }
}

/**
 * Zero-AI reader: PDF/text extraction + keyword classification + regex field extraction. Roughly "half as good"
 * as the model - results are always low enough in confidence, or incomplete enough, that a person reviews them.
 */
@Injectable()
export class RulesDocumentReader implements DocumentReader {
  readonly name = 'rules';
  private readonly logger = new Logger(RulesDocumentReader.name);

  async isAvailable(): Promise<Availability> {
    return { available: true, reason: RULES_REASON };
  }

  async read(input: ReadInput): Promise<ReadResult> {
    const mime = (input.mimeType || '').toLowerCase();
    const name = input.fileName || '';
    let text = '';
    let note = '';
    try {
      if (input.bytes.length > MAX_BYTES) {
        note = 'File is too large for the built-in reader.';
      } else if (mime === 'application/pdf' || /\.pdf$/i.test(name) || input.bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
        try {
          text = await pdfToText(input.bytes);
        } catch (err) {
          this.logger.warn(`PDF text extraction failed for "${name}": ${(err as Error).message}`);
          note = 'This PDF could not be read (damaged, encrypted or scanned).';
        }
        if (!note && text.trim().length < 20) note = 'This PDF has no text layer (probably a scan) and the built-in reader cannot do OCR.';
      } else if (mime.startsWith('text/') || TEXT_EXT.test(name)) {
        text = input.bytes.toString('utf8').replace(/<[^>]+>/g, ' ');
      } else if (mime.startsWith('image/')) {
        note = 'Images cannot be read without OCR.';
      } else {
        note = 'This file type cannot be read by the built-in reader.';
      }
    } catch (err) {
      note = `Could not read the file: ${(err as Error).message}`;
    }
    const { extracted } = extractFromText(text, name, note);
    return { extracted, model: RULES_MODEL, inputTokens: 0, outputTokens: 0, costUsd: 0, escalated: false };
  }
}
