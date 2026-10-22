import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

export interface QueryInput {
  name: string;
  type: sql.ISqlType | (() => sql.ISqlType);
  value: any;
}

/**
 * Node's default SQL Server driver (tedious) is TCP-only — it cannot resolve
 * "(localdb)\MSSQLLocalDB" the way sqlcmd/SSMS can, because LocalDB speaks
 * named pipes / shared memory, not a network hostname.
 *
 * Setting DB_DRIVER=msnodesqlv8 switches to the native Windows SQL client
 * driver (same mechanism SSMS uses), which understands LocalDB instance
 * names and Windows Integrated Auth directly. Requires:
 *   npm install msnodesqlv8
 * (needs the usual Windows build tools the first time, since it compiles a
 * native addon). Leave DB_DRIVER unset/"tedious" when connecting to a real
 * SQL Server/Azure SQL over TCP.
 */
function loadSqlDriver(driver: string): typeof sql {
  if (driver === 'msnodesqlv8') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('mssql/msnodesqlv8');
  }
  return sql;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: sql.ConnectionPool;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const server = this.config.get<string>('DB_SERVER');
    const port = this.config.get<number>('DB_PORT');
    const database = this.config.get<string>('DB_NAME');
    const user = this.config.get<string>('DB_USER');
    const password = this.config.get<string>('DB_PASSWORD');
    const encrypt = this.config.get<string>('DB_ENCRYPT') === 'true';
    const trustedConnection = this.config.get<string>('DB_TRUSTED_CONNECTION') === 'true';
    const driver = this.config.get<string>('DB_DRIVER', 'tedious');

    const driverSql = loadSqlDriver(driver);

    const config: sql.config = {
      server,
      database,
      options: {
        encrypt,
        trustServerCertificate: !encrypt,
        trustedConnection,
      },
    };

    if (port) config.port = Number(port);
    if (user) config.user = user;
    if (password) config.password = password;

    try {
      this.pool = new driverSql.ConnectionPool(config);
      await this.pool.connect();
    } catch (err) {
      if (driver !== 'msnodesqlv8' && /^\(localdb\)/i.test(server ?? '')) {
        this.logger.error(
          `Could not reach "${server}" using the default tedious driver. ` +
          `Node's SQL driver cannot resolve "(localdb)\\..." directly (it is TCP-only; ` +
          `LocalDB uses named pipes). Fix: run "npm install msnodesqlv8" in src/api, then ` +
          `set DB_DRIVER=msnodesqlv8 in your .env and restart.`,
        );
      }
      throw err;
    }

    this.logger.log(`Connected to SQL Server: ${server}/${database} (driver: ${driver})`);
  }

  async onModuleDestroy() {
    if (this.pool) await this.pool.close();
  }

  async query<T = any>(queryText: string, inputs: QueryInput[] = []): Promise<sql.IResult<T>> {
    const request = this.pool.request();
    for (const input of inputs) {
      request.input(input.name, input.type, input.value);
    }
    return request.query<T>(queryText);
  }

  async execute<T = any>(procedure: string, inputs: QueryInput[] = []): Promise<sql.IResult<T>> {
    const request = this.pool.request();
    for (const input of inputs) {
      request.input(input.name, input.type, input.value);
    }
    return request.execute<T>(procedure);
  }

  get sqlTypes() {
    return sql;
  }
}
