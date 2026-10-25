import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sql from 'mssql';

/**
 * Shares the exact same `dbo.__ScriptRunnerHistory` ledger table as
 * tools/db-script-runner/DbScriptRunner.ps1 (same columns, same SHA-256-
 * of-raw-file-bytes checksum, same bare-filename ScriptName) — scripts run
 * through this MCP server and scripts run through the PowerShell GUI stay
 * mutually visible in the same history, whichever one you use.
 */
const ENSURE_HISTORY_TABLE_SQL = `
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '__ScriptRunnerHistory' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.__ScriptRunnerHistory (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        ScriptName NVARCHAR(500) NOT NULL,
        AppliedAt DATETIME2 NOT NULL,
        Success BIT NOT NULL,
        Checksum NVARCHAR(64) NOT NULL
    );
END`;

export type ScriptStatus = 'not_applied' | 'applied' | 'changed' | 'failed';

export interface ScriptInfo {
  name: string;
  path: string;
  status: ScriptStatus;
  lastAppliedAt: string | null;
  lastChecksum: string | null;
  currentChecksum: string;
}

export interface RunResult {
  name: string;
  success: boolean;
  skipped: boolean;
  message: string;
}

function getFileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

/** Natural sort: "2_x" < "11_x" (plain string sort would put "11_x" first). */
function naturalSortKey(name: string): (string | number)[] {
  return name
    .match(/\d+|\D+/g)!
    .map((part) => (/^\d+$/.test(part) ? parseInt(part, 10) : part));
}

function naturalCompare(a: string, b: string): number {
  const ak = naturalSortKey(a);
  const bk = naturalSortKey(b);
  for (let i = 0; i < Math.max(ak.length, bk.length); i++) {
    const av = ak[i];
    const bv = bk[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av) < String(bv) ? -1 : 1;
  }
  return 0;
}

export function listSqlFiles(folder: string): string[] {
  return readdirSync(folder)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort(naturalCompare);
}

/** Splits a .sql file's text into sqlcmd/SSMS-style batches on lines that are just "GO". */
export function splitIntoBatches(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const batches: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\s*GO\s*(--.*)?$/i.test(line)) {
      batches.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim().length > 0)) batches.push(current.join('\n'));
  return batches.filter((b) => b.trim().length > 0);
}

interface HistoryRow {
  ScriptName: string;
  AppliedAt: Date;
  Success: boolean;
  Checksum: string;
}

async function loadHistory(pool: sql.ConnectionPool): Promise<Map<string, HistoryRow>> {
  const res = await pool.request().query<HistoryRow>(`
    SELECT t.ScriptName, t.AppliedAt, t.Success, t.Checksum
    FROM dbo.__ScriptRunnerHistory t
    WHERE t.Id IN (SELECT MAX(Id) FROM dbo.__ScriptRunnerHistory GROUP BY ScriptName)
  `);
  const map = new Map<string, HistoryRow>();
  for (const row of res.recordset) map.set(row.ScriptName.toLowerCase(), row);
  return map;
}

async function ensureHistoryTable(pool: sql.ConnectionPool) {
  await pool.request().query(ENSURE_HISTORY_TABLE_SQL);
}

async function recordHistory(pool: sql.ConnectionPool, name: string, checksum: string, success: boolean) {
  await pool
    .request()
    .input('name', sql.NVarChar(500), name)
    .input('checksum', sql.NVarChar(64), checksum)
    .input('success', sql.Bit, success)
    .query(
      `INSERT INTO dbo.__ScriptRunnerHistory (ScriptName, AppliedAt, Success, Checksum) VALUES (@name, SYSDATETIME(), @success, @checksum)`,
    );
}

export async function listScripts(pool: sql.ConnectionPool, folder: string): Promise<ScriptInfo[]> {
  await ensureHistoryTable(pool);
  const history = await loadHistory(pool);
  return listSqlFiles(folder).map((name) => {
    const path = join(folder, name);
    const currentChecksum = getFileSha256(path);
    const entry = history.get(name.toLowerCase());
    let status: ScriptStatus;
    if (!entry) status = 'not_applied';
    else if (!entry.Success) status = 'failed';
    else if (entry.Checksum.toUpperCase() !== currentChecksum) status = 'changed';
    else status = 'applied';
    return {
      name,
      path,
      status,
      lastAppliedAt: entry ? entry.AppliedAt.toISOString() : null,
      lastChecksum: entry ? entry.Checksum : null,
      currentChecksum,
    };
  });
}

/**
 * Runs the given scripts (by filename, in the order given — callers should
 * pass them already filename-sorted, e.g. the output of `listScripts`)
 * against `folder`, stopping at the first failure (matching the PowerShell
 * tool's behavior). Every attempt (success or failure) is recorded in the
 * history table.
 */
export async function runScripts(
  pool: sql.ConnectionPool,
  folder: string,
  scriptNames: string[],
): Promise<RunResult[]> {
  await ensureHistoryTable(pool);
  const results: RunResult[] = [];
  let stopped = false;

  for (const name of scriptNames) {
    if (stopped) {
      results.push({ name, success: false, skipped: true, message: 'Skipped — a prior script in this run failed.' });
      continue;
    }

    const path = join(folder, name);
    const text = readFileSync(path, 'utf-8');
    const checksum = getFileSha256(path);
    const batches = splitIntoBatches(text);

    // Every batch of one script must run on the SAME connection: scripts use
    // session-scoped temp tables (#Gen, #Topics) across GO boundaries, and
    // pool.request() may hand each batch to a different pooled connection.
    // A transaction pins one connection for the script's whole run and also
    // makes each script all-or-nothing, so a failed script leaves no
    // half-applied data behind.
    const tx = new sql.Transaction(pool);
    let began = false;
    try {
      await tx.begin();
      began = true;
      for (const batch of batches) {
        await new sql.Request(tx).query(batch);
      }
      await tx.commit();
      await recordHistory(pool, name, checksum, true);
      results.push({ name, success: true, skipped: false, message: 'Applied successfully.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (began) {
        try {
          await tx.rollback();
        } catch {
          // the server already rolled the transaction back (e.g. severe error); nothing to undo
        }
      }
      await recordHistory(pool, name, checksum, false);
      results.push({ name, success: false, skipped: false, message });
      stopped = true;
    }
  }

  return results;
}
