import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Unauthenticated health check — used by hosting platforms (Render, etc.)
 * to verify the service is up. Also confirms the DB connection pool is
 * actually alive, not just that the Node process is running.
 */
@Controller('health')
export class HealthController {
  constructor(private db: DatabaseService) {}

  @Get()
  async check() {
    await this.db.query('SELECT 1 AS ok');
    return { status: 'ok', time: new Date().toISOString() };
  }
}
