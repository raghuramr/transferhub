#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import sql from 'mssql';
import { resolve } from 'node:path';
import { buildMssqlConfig, getDbSettings, loadedEnvPath } from './config.js';
import { listScripts, runScripts, type ScriptInfo } from './scriptRunner.js';

// Repo layout is fixed: tools/db-mcp-server/ -> ../../database/{migrations,seed}
const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const FOLDERS = {
  migrations: resolve(REPO_ROOT, 'database/migrations'),
  seed: resolve(REPO_ROOT, 'database/seed'),
} as const;
type FolderKey = keyof typeof FOLDERS;

let pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  const settings = getDbSettings();
  const cfg = buildMssqlConfig(settings);
  pool = await sql.connect(cfg);
  return pool;
}

function formatScriptTable(scripts: ScriptInfo[]): string {
  if (scripts.length === 0) return '(no .sql files found)';
  const statusLabel: Record<ScriptInfo['status'], string> = {
    not_applied: 'Not Applied',
    applied: 'Applied',
    changed: 'Changed since applied',
    failed: 'Failed (last run)',
  };
  return scripts
    .map((s) => `  ${s.name.padEnd(55)} ${statusLabel[s.status]}${s.lastAppliedAt ? ` (last run ${s.lastAppliedAt})` : ''}`)
    .join('\n');
}

const server = new McpServer({
  name: 'transferhub-db-mcp-server',
  version: '1.0.0',
});

server.registerTool(
  'test_connection',
  {
    title: 'Test database connection',
    description:
      'Connects to the configured SQL Server / Azure SQL database and reports success/failure. ' +
      'Use this before run_migrations/run_seeds to confirm DB_SERVER/DB_NAME/credentials are correct.',
    inputSchema: {},
  },
  async () => {
    try {
      const settings = getDbSettings();
      const p = await getPool();
      const res = await p.request().query('SELECT @@VERSION AS Version, DB_NAME() AS CurrentDb');
      const row = res.recordset[0];
      return {
        content: [
          {
            type: 'text',
            text:
              `Connected to ${settings.server}${settings.port ? `,${settings.port}` : ''} ` +
              `(database: ${row.CurrentDb}).\nEnv file used: ${loadedEnvPath ?? '(none — using process.env directly)'}\n\n${row.Version}`,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Connection FAILED: ${message}` }], isError: true };
    }
  },
);

server.registerTool(
  'list_scripts',
  {
    title: 'List migration/seed scripts and their status',
    description:
      'Lists the .sql files in database/migrations or database/seed, naturally sorted (002_ before 011_), ' +
      'each with its status against the configured database: Not Applied, Applied, Changed since applied ' +
      '(the file was edited after it last ran), or Failed (last run). Reads the same dbo.__ScriptRunnerHistory ' +
      'ledger table as the PowerShell DbScriptRunner GUI tool.',
    inputSchema: {
      folder: z.enum(['migrations', 'seed']).describe('Which folder to list: "migrations" or "seed".'),
    },
  },
  async ({ folder }: { folder: FolderKey }) => {
    const p = await getPool();
    const scripts = await listScripts(p, FOLDERS[folder]);
    return { content: [{ type: 'text', text: `${folder}/ (${FOLDERS[folder]}):\n${formatScriptTable(scripts)}` }] };
  },
);

const applyInputSchema = {
  folder: z.enum(['migrations', 'seed']).describe('Which folder to run scripts from: "migrations" or "seed".'),
  scripts: z
    .array(z.string())
    .optional()
    .describe(
      'Specific filenames to run, e.g. ["003_institutions_courses_programs.sql"]. Omit to run every .sql ' +
        'file in the folder, in filename order.',
    ),
  onlyIfNeeded: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Default true: skip files already Applied with a matching checksum (a clean no-op anyway, since every ' +
        'script is idempotent, but this avoids the round-trip). Set false to force re-running them too.',
    ),
};

async function applyFolder(
  folder: FolderKey,
  requested: string[] | undefined,
  onlyIfNeeded: boolean,
) {
  const p = await getPool();
  const dir = FOLDERS[folder];
  const scripts = await listScripts(p, dir);

  const known = new Set(scripts.map((s) => s.name));
  const unknown = (requested ?? []).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    return {
      content: [{ type: 'text' as const, text: `Unknown script name(s) in ${folder}/: ${unknown.join(', ')}` }],
      isError: true,
    };
  }

  let toRun = requested && requested.length > 0 ? scripts.filter((s) => requested.includes(s.name)) : scripts;
  if (onlyIfNeeded) {
    toRun = toRun.filter((s) => s.status !== 'applied');
  }

  if (toRun.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `Nothing to run in ${folder}/ — every selected script is already Applied.` }],
    };
  }

  const results = await runScripts(p, dir, toRun.map((s) => s.name));
  const lines = results.map((r) => {
    if (r.skipped) return `  SKIPPED  ${r.name} — ${r.message}`;
    if (r.success) return `  OK       ${r.name}`;
    return `  FAILED   ${r.name} — ${r.message}`;
  });
  const anyFailed = results.some((r) => !r.success && !r.skipped);
  return {
    content: [
      {
        type: 'text' as const,
        text: `Ran ${results.length} script(s) from ${folder}/ against ${getDbSettings().database}:\n${lines.join('\n')}`,
      },
    ],
    isError: anyFailed,
  };
}

server.registerTool(
  'run_migrations',
  {
    title: 'Apply database migrations',
    description:
      'Runs database/migrations/*.sql against the configured database, in filename order, stopping at the ' +
      'first failure (matching the PowerShell GUI tool). Every migration is idempotent (IF NOT EXISTS guards) ' +
      'so re-running an already-applied one is a safe no-op — by default (onlyIfNeeded) those are skipped ' +
      'anyway to save a round-trip. Records every attempt in dbo.__ScriptRunnerHistory.',
    inputSchema: applyInputSchema,
  },
  async ({ scripts, onlyIfNeeded }) => applyFolder('migrations', scripts, onlyIfNeeded ?? true),
);

server.registerTool(
  'run_seeds',
  {
    title: 'Apply database seed data',
    description:
      'Runs database/seed/*.sql against the configured database, in filename order, stopping at the first ' +
      'failure. Every seed file is idempotent (MERGE / WHERE NOT EXISTS) so re-running an already-applied one ' +
      'is a safe no-op. Run database/migrations/*.sql first (run_migrations) — seeds assume the schema exists.',
    inputSchema: applyInputSchema,
  },
  async ({ scripts, onlyIfNeeded }) => applyFolder('seed', scripts, onlyIfNeeded ?? true),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error starting transferhub-db-mcp-server:', err);
  process.exit(1);
});
