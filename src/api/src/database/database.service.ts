import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { buildSqlConfig, loadSqlDriver } from '../common/sql-connection.util';

export interface QueryInput {
  name: string;
  type: sql.ISqlType | (() => sql.ISqlType);
  value: any;
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
    const odbcDriver = this.config.get<string>('DB_ODBC_DRIVER');

    const driverSql = loadSqlDriver(driver);
    const config = buildSqlConfig({
      driver,
      server,
      database,
      port: port ? Number(port) : undefined,
      trustedConnection,
      user,
      password,
      encrypt,
      odbcDriver,
    });

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
      } else if (driver === 'msnodesqlv8' && /driver manager|data source name/i.test((err as any).message ?? '')) {
        this.logger.error(
          `ODBC driver "${odbcDriver ?? '(default)'}" was not found on this machine. ` +
          `Run "Get-OdbcDriver | Select-Object Name" in PowerShell to see installed drivers, ` +
          `then set DB_ODBC_DRIVER in your .env to match exactly (e.g. "ODBC Driver 18 for SQL Server").`,
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
