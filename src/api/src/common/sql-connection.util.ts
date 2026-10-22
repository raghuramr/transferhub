/**
 * Shared SQL Server connection builder used by both the running NestJS app
 * (database.service.ts) and the standalone seed script (scripts/seed-users.ts).
 *
 * Why this exists:
 * Node's default SQL driver ("tedious", used by the `mssql` package) is
 * TCP-only. It cannot resolve "(localdb)\..." — that's a named-pipe
 * connection, the same kind sqlcmd/SSMS use, not a network hostname.
 *
 * For LocalDB (or any Windows Integrated Auth scenario), use the
 * `msnodesqlv8` driver instead — it wraps the native Windows ODBC client,
 * the same mechanism SSMS uses. ODBC requires an explicit driver NAME
 * ("ODBC Driver 17 for SQL Server", "ODBC Driver 18 for SQL Server", or the
 * older "SQL Server Native Client 11.0"); if that name doesn't match a
 * driver actually registered on the machine you get:
 *   "[Microsoft][ODBC Driver Manager] Data source name not found and no
 *    default driver specified"
 *
 * Check which ODBC drivers are installed with:
 *   PowerShell:  Get-OdbcDriver | Select-Object Name
 * SSMS 19+ typically installs "ODBC Driver 17 for SQL Server" or
 * "ODBC Driver 18 for SQL Server" — set DB_ODBC_DRIVER in .env to match.
 */

export interface SqlConnectionOptions {
  driver: string;              // 'tedious' (default) | 'msnodesqlv8'
  server: string;
  database: string;
  port?: number;
  trustedConnection: boolean;
  user?: string;
  password?: string;
  encrypt: boolean;
  odbcDriver?: string;         // only used when driver === 'msnodesqlv8'
}

export const DEFAULT_ODBC_DRIVER = 'ODBC Driver 17 for SQL Server';

export function buildSqlConfig(opts: SqlConnectionOptions): any {
  if (opts.driver === 'msnodesqlv8') {
    const odbcDriver = opts.odbcDriver || DEFAULT_ODBC_DRIVER;
    const parts = [
      `Driver={${odbcDriver}}`,
      `Server=${opts.server}`,
      `Database=${opts.database}`,
    ];

    if (opts.trustedConnection) {
      parts.push('Trusted_Connection=Yes');
    } else {
      parts.push(`UID=${opts.user ?? ''}`);
      parts.push(`PWD=${opts.password ?? ''}`);
    }

    if (opts.encrypt) {
      parts.push('Encrypt=yes');
    } else {
      // ODBC Driver 18 defaults to encrypt=yes with strict cert checks;
      // explicitly turn it off + trust the (self-signed/local) cert for dev.
      parts.push('Encrypt=no');
      parts.push('TrustServerCertificate=yes');
    }

    return { connectionString: parts.join(';') + ';' };
  }

  // ── tedious (TCP-only) ──────────────────────────────────────
  const config: any = {
    server: opts.server,
    database: opts.database,
    options: {
      encrypt: opts.encrypt,
      trustServerCertificate: !opts.encrypt,
      trustedConnection: opts.trustedConnection,
    },
  };
  if (opts.port) config.port = opts.port;
  if (!opts.trustedConnection) {
    config.user = opts.user;
    config.password = opts.password;
  }
  return config;
}

/** Loads the correct `mssql` entrypoint for the chosen driver. */
export function loadSqlDriver(driver: string): any {
  if (driver === 'msnodesqlv8') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('mssql/msnodesqlv8');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('mssql');
}
