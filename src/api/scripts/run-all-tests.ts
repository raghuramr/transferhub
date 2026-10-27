/**
 * Runs every offline unit test (scripts/test-*.ts) with tsx and prints a pass/fail table.
 * Run: npm run test:unit            (from src/api)
 * Options: --filter <text>  only tests whose file name contains <text>;  --verbose  print each test's output.
 * Exit code: 0 when all pass, 1 when any fail (or none found).
 * These tests need no database and no network.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const fi = args.indexOf('--filter');
const filter = fi >= 0 ? args[fi + 1] : '';
const dir = __dirname;

const files = readdirSync(dir)
  .filter((f) => /^test-.*\.ts$/.test(f) && (!filter || f.includes(filter)))
  .sort();

if (!files.length) {
  console.error('No test-*.ts files found' + (filter ? ` matching "${filter}"` : ''));
  process.exit(1);
}

interface Row { file: string; ok: boolean; ms: number; out: string }
const rows: Row[] = [];
const tsxBin = join(dir, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

for (const f of files) {
  const t0 = Date.now();
  // Prefer the local tsx binary; fall back to npx when it is not installed locally.
  const local = spawnSync(tsxBin, [join(dir, f)], { cwd: join(dir, '..'), encoding: 'utf8', shell: process.platform === 'win32' });
  const r = local.error ? spawnSync('npx', ['tsx', join(dir, f)], { cwd: join(dir, '..'), encoding: 'utf8', shell: process.platform === 'win32' }) : local;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // A script that prints "FAIL" lines but forgets to set the exit code still counts as failed.
  const printedFail = /^\s*(FAIL|✗|not ok)\b/m.test(out);
  const ok = r.status === 0 && !printedFail;
  rows.push({ file: f, ok, ms: Date.now() - t0, out });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}  (${rows[rows.length - 1].ms} ms)`);
  if (verbose || !ok) console.log(out.split('\n').map((l) => '      ' + l).join('\n'));
}

const failed = rows.filter((r) => !r.ok);
const w = Math.max(...rows.map((r) => r.file.length));
console.log('\n' + '-'.repeat(w + 22));
for (const r of rows) console.log(`${r.file.padEnd(w)}  ${r.ok ? 'PASS' : 'FAIL'}  ${String(r.ms).padStart(6)} ms`);
console.log('-'.repeat(w + 22));
console.log(`${rows.length - failed.length}/${rows.length} test files passed`);
process.exit(failed.length ? 1 : 0);
