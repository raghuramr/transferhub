import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { config as SqlConfig } from 'mssql';

/**
 * Env resolution order (first one found wins):
 *   1. DB_MCP_ENV_FILE (explicit path to a .env-style file)
 *   2. ./.env next to this server
 *   3. ../../src/api/.env — the main API's own local-dev env file, so this
 *      server targets the exact same database by default without a second
 *      copy of the credentials to keep in sync.
 * Falls back to process.env alone (e.g. variables exported by the MCP
 * client's own config) if none of those files exist.
 */
function loadEnv() {
  const candidates = [
    process.env.DB_MCP_ENV_FILE,
    resolve(import.meta.dirname, '.env'),
    resolve(import.meta.dirname, '../../../src/api/.env'),
  ].filter((p): p is string => !!p);

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path });
      return path;
    }
  }
  return null;
}

export const loadedEnvPath = loadEnv();

export interface DbSettings {
  server: string;
  database: string;
  port?: number;
  trustedConnection: boolean;
  user?: string;
  password?: string;
  encrypt: boolean;
}

export function getDbSettings(): DbSettings {
  const server = process.env.DB_SERVER;
  const database = process.env.DB_NAME;
  if (!server || !database) {
    throw new Error(
      'DB_SERVER and DB_NAME are not set. Point DB_MCP_ENV_FILE at a .env file, or set ' +
        'DB_SERVER/DB_NAME/DB_USER/DB_PASSWORD/DB_ENCRYPT/DB_PORT in the MCP client config\'s ' +
        '"env" block. See tools/db-mcp-server/README.md.',
    );
  }
  const trustedConnection = (process.env.DB_TRUSTED_CONNECTION ?? 'false') === 'true';
  return {
    server,
    database,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
    trustedConnection,
    user: process.env.DB_USER || undefined,
    password: process.env.DB_PASSWORD || undefined,
    encrypt: (process.env.DB_ENCRYPT ?? 'false') === 'true',
  };
}

/**
 * This server only supports the "tedious" (plain TCP) driver — Azure SQL
 * and any real SQL Server reachable over the network. It does NOT support
 * LocalDB ("(localdb)\...", a named-pipe connection requiring the native
 * msnodesqlv8/ODBC driver) — use tools/db-script-runner/ (the PowerShell
 * GUI) for that. See README.md.
 */
export function buildMssqlConfig(settings: DbSettings): SqlConfig {
  if (/^\(localdb\)/i.test(settings.server)) {
    throw new Error(
      `DB_SERVER="${settings.server}" looks like a LocalDB instance. This MCP server only ` +
        'supports TCP connections (Azure SQL / a real SQL Server) — use tools/db-script-runner/ ' +
        '(the PowerShell GUI) for LocalDB instead.',
    );
  }
  const cfg: SqlConfig = {
    server: settings.server,
    database: settings.database,
    options: {
      encrypt: settings.encrypt,
      trustServerCertificate: !settings.encrypt,
      trustedConnection: settings.trustedConnection,
    },
  };
  if (settings.port) cfg.port = settings.port;
  if (!settings.trustedConnection) {
    cfg.user = settings.user;
    cfg.password = settings.password;
  }
  return cfg;
}
