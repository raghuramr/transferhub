/** Run: npx tsx scripts/test-di-layout.ts - Azure Document Intelligence polygons -> normalised word boxes (stub data, no network). */
import assert from 'node:assert/strict';
import { buildLayout } from '../src/documents/di-layout';

// A letter page in inches (8.5 x 11) and one image page in pixels.
const l = buildLayout({
  pages: [
    { pageNumber: 1, width: 8.5, height: 11, words: [
      { content: 'CS', polygon: [0.85, 1.1, 1.275, 1.1, 1.275, 1.32, 0.85, 1.32] },
      { content: '1800', polygon: [1.7, 1.1, 2.55, 1.1, 2.55, 1.32, 1.7, 1.32] },
      { content: 'broken', polygon: [1, 2] },
      { content: '', polygon: [0, 0, 1, 0, 1, 1, 0, 1] },
    ] },
    { pageNumber: 2, width: 1000, height: 500, words: [{ content: 'A', polygon: [100, 50, 150, 50, 150, 100, 100, 100] }] },
  ],
})!;
assert.equal(l.pages.length, 2);
assert.equal(l.pages[0].words.length, 2, 'malformed and empty words are dropped');
assert.deepEqual(l.pages[0].words[0].b, [0.1, 0.1, 0.05, 0.02]);
assert.deepEqual(l.pages[1].words[0].b, [0.1, 0.1, 0.05, 0.1]);
assert.equal(buildLayout(undefined), undefined);
assert.equal(buildLayout({ pages: [] }), undefined, 'no words -> no layout (nothing fabricated)');
assert.equal(buildLayout({ pages: [{ pageNumber: 1, width: 0, height: 0, words: [{ content: 'x', polygon: [0, 0, 1, 0, 1, 1, 0, 1] }] }] }), undefined);
console.log('di-layout ok');
