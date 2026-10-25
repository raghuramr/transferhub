#!/usr/bin/env node
import { resolve } from 'node:path';
import sql from 'mssql';
import { getDbSettings, buildMssqlConfig } from './config.js';
import { listScripts, runScripts, type ScriptInfo } from './scriptRunner.js';

/**
 * CI-friendly, non-interactive "apply everything pending" runner — the
 * automated counterpart to the PowerShell GUI (tools/db-script-runner/) and
 * the MCP server's own run_migrations/run_seeds tools, sharing the exact
 * same dbo.__ScriptRunnerHistory ledger so a script applied through any of
 * the three shows as Applied in the others. Intended to run from CI (see
 * .github/workflows/main_codecrafters.yml) right before the app deploy
 * step, so the database schema a new deploy expects is already in place by
 * the time it starts serving traffic.
 *
 * Applies database/migrations/ then database/seed/, in filename order,
 * skipping 001_database.sql (the CREATE DATABASE step — can't run against
 * Azure SQL mid-connection, and the database already exists as its own
 * Azure resource; see that file's own header). Runs every script whose
 * status isn't already "applied" (not_applied, changed, or a previous
 * failed attempt), and stops at the first failure within a folder — a
 * migrations failure skips seeds entirely. Exits non-zero on any failure so
 * the CI job fails loudly instead of silently deploying app code against a
 * stale/broken schema.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const FOLDERS = [
  { label: 'migrations', path: resolve(REPO_ROOT, 'database/migrations') },
  { label: 'seed', path: resolve(REPO_ROOT, 'database/seed') },
];
const SKIP_FILES = new Set(['001_database.sql']);

function scriptsToRun(infos: ScriptInfo[]): string[] {
  return infos.filter((s) => s.status !== 'applied' && !SKIP_FILES.has(s.name)).map((s) => s.name);
}

async function main() {
  const settings = getDbSettings();
  const pool = await new sql.ConnectionPool(buildMssqlConfig(settings)).connect();

  let anyFailure = false;
  try {
    for (const folder of FOLDERS) {
      console.log(`\n=== ${folder.label} (${folder.path}) ===`);
      const infos = await listScripts(pool, folder.path);
      const pending = scriptsToRun(infos);

      if (pending.length === 0) {
        console.log('Nothing pending — every script already applied.');
        continue;
      }

      console.log(`Applying ${pending.length} script(s): ${pending.join(', ')}`);
      const results = await runScripts(pool, folder.path, pending);
      for (const r of results) {
        const tag = r.skipped ? 'SKIPPED' : r.success ? 'OK' : 'FAILED';
        console.log(`  [${tag}] ${r.name}${r.message ? ` — ${r.message}` : ''}`);
      }

      if (results.some((r) => !r.success)) {
        anyFailure = true;
        console.error(`\n${folder.label} had a failure — stopping before the next folder.`);
        break;
      }
    }
  } finally {
    await pool.close();
  }

  if (anyFailure) {
    console.error('\nDatabase script apply FAILED.');
    process.exit(1);
  }
  console.log('\nDatabase scripts are all up to date.');
}

main().catch((err) => {
  console.error('Fatal error applying database scripts:', err);
  process.exit(1);
});
