/** Run: npx tsx scripts/test-capture-logic.ts - camera capture logic: sizing, page plan, reorder, levels, retry policy, multi-page PDF. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import sharp from 'sharp';
import { computeLevels, fitWithin, levelsTable, moveItem, planPage, removeAt } from '../../ui/src/lib/capture-logic';
import { buildPdf } from '../../ui/src/lib/capture-pdf';
import { backoffMs, canTransition, isRetryable, withRetry } from '../../ui/src/lib/retry';

async function main() {
  // sizing: downscale to a 2000 px long edge, never upscale
  assert.deepEqual(fitWithin(4000, 3000), { width: 2000, height: 1500, scale: 0.5 });
  assert.deepEqual(fitWithin(1200, 800), { width: 1200, height: 800, scale: 1 });
  assert.equal(fitWithin(3000, 4000).height, 2000);

  // page plan: portrait photo -> A4 portrait, landscape -> A4 landscape; always inside the margins, centred
  const p = planPage(3000, 4000);
  assert.ok(p.pageWidth < p.pageHeight);
  assert.ok(p.x >= 14 - 1e-6 && p.y >= 14 - 1e-6 && p.x + p.width <= p.pageWidth - 14 + 1e-6 && p.y + p.height <= p.pageHeight - 14 + 1e-6);
  assert.ok(Math.abs(p.width / p.height - 0.75) < 1e-9, 'aspect ratio preserved');
  const l = planPage(4000, 3000);
  assert.ok(l.pageWidth > l.pageHeight);

  // reorder / delete
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b']);
  assert.deepEqual(moveItem(['a', 'b'], 0, 5), ['a', 'b'], 'out of range is a no-op');
  assert.deepEqual(removeAt(['a', 'b', 'c'], 1), ['a', 'c']);

  // auto levels: a washed-out page gets stretched, a good one is left alone
  const washed = new Array(256).fill(0);
  for (let i = 90; i <= 200; i++) washed[i] = 10;
  const lv = computeLevels(washed)!;
  assert.ok(lv && lv.lo >= 90 && lv.hi <= 200);
  const t = levelsTable(lv.lo, lv.hi);
  assert.equal(t[lv.lo], 0);
  assert.equal(t[lv.hi], 255);
  const good = new Array(256).fill(1);
  assert.equal(computeLevels(good), null);
  const flat = new Array(256).fill(0);
  flat[128] = 1000;
  assert.equal(computeLevels(flat), null);

  // retry policy
  assert.equal(isRetryable({ response: { status: 503 } }), true);
  assert.equal(isRetryable({ response: { status: 429 } }), true);
  assert.equal(isRetryable({ code: 'ERR_NETWORK' }), true, 'no response = flaky network');
  assert.equal(isRetryable({ response: { status: 400 } }), false);
  assert.equal(isRetryable({ response: { status: 413 } }), false);
  assert.equal(isRetryable({ code: 'ERR_CANCELED' }), false);
  assert.ok(backoffMs(0, undefined, () => 0.5) === 800 && backoffMs(10, undefined, () => 0.5) === 8000);
  let calls = 0;
  const waits: number[] = [];
  const out = await withRetry(async () => { if (++calls < 3) throw { code: 'ERR_NETWORK' }; return 'ok'; }, { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
  calls = 0;
  await assert.rejects(() => withRetry(async () => { calls++; throw { response: { status: 400 } }; }, { sleep: async () => {} }));
  assert.equal(calls, 1, 'a 4xx is not retried');
  calls = 0;
  await assert.rejects(() => withRetry(async () => { calls++; throw { code: 'ERR_NETWORK' }; }, { sleep: async () => {} }));
  assert.equal(calls, 4, 'gives up after 3 retries');

  // state machine
  assert.ok(canTransition('capturing', 'uploading') && canTransition('uploading', 'reading') && canTransition('reading', 'review'));
  assert.ok(!canTransition('capturing', 'review') && !canTransition('review', 'uploading'));
  assert.ok(canTransition('failed', 'uploading'), 'retry after a failure');

  // three captured pages -> ONE pdf with three pages, in order (needs src/ui dependencies; skipped when not installed)
  const uiRequire = createRequire(join(__dirname, '..', '..', 'ui', 'package.json'));
  let pdfLib: any = null;
  try { pdfLib = uiRequire('pdf-lib'); } catch { console.log('pdf-lib not installed in src/ui - skipping the PDF combine check'); }
  let pdfBytes = 0;
  if (pdfLib) {
    const mk = async (w: number, h: number, c: string) => {
      const bytes = await sharp({ create: { width: w, height: h, channels: 3, background: c } }).jpeg().toBuffer();
      return { bytes: new Uint8Array(bytes), width: w, height: h };
    };
    const pdf = await buildPdf([await mk(300, 400, '#ff0000'), await mk(400, 300, '#00ff00'), await mk(300, 400, '#0000ff')]);
    assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
    const back = await pdfLib.PDFDocument.load(pdf);
    assert.equal(back.getPageCount(), 3);
    assert.ok(back.getPage(1).getWidth() > back.getPage(1).getHeight(), 'landscape photo -> landscape page');
    assert.ok(back.getPage(0).getWidth() < back.getPage(0).getHeight());
    await assert.rejects(() => buildPdf([]));
    pdfBytes = pdf.length;
  }
  console.log('capture-logic ok, pdf bytes:', pdfBytes);
}

main().catch((e) => { console.error(e); process.exit(1); });
