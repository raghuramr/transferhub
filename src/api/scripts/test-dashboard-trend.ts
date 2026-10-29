/**
 * Offline test for the dashboard sparkline/delta helpers (no database).
 * Run: npx tsx scripts/test-dashboard-trend.ts
 */
import { bucketize, relDelta } from '../src/dashboard/dashboard.service';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// 12 days, 4 buckets of 3 days each; "ago" 0 = today = last bucket.
const rows = [
  { ago: 0, n: 1 }, { ago: 2, n: 2 }, // newest bucket
  { ago: 3, n: '4' }, // BIGINT sums arrive as strings
  { ago: 11, n: 5 }, // oldest bucket
  { ago: 12, n: 7 }, { ago: 23, n: 1 }, // previous period
  { ago: 24, n: 100 }, // outside both periods
  { ago: -1, n: 100 }, // clock skew: ignored
];
const b = bucketize(rows, 12, ['n'], 4);
eq('current buckets, oldest first', b.cur.n, [5, 0, 4, 3]);
eq('previous period total', b.prev.n, 8);
eq('current total', b.total('n'), 12);
eq('relDelta up', relDelta(12, 8), 0.5);
eq('relDelta down', relDelta(6, 8), -0.25);
eq('relDelta no baseline', relDelta(5, 0), null);

// Uneven split (30 days into 12 buckets) keeps every row in range.
const all = bucketize(Array.from({ length: 30 }, (_, ago) => ({ ago, n: 1 })), 30, ['n']);
eq('30 days spread over 12 buckets', all.total('n'), 30);
eq('12 buckets', all.cur.n.length, 12);

process.exit(failed ? 1 : 0);
