import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

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

    this.pool = new sql.ConnectionPool(config);
    await this.pool.connect();
    this.logger.log(`Connected to SQL Server: ${server}/${database}`);
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
