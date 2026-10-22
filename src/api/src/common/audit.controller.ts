import { Controller, Get, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class AuditController {
  constructor(private db: DatabaseService) {}

  @Get()
  async getLog() {
    const res = await this.db.query<any>(
      `SELECT TOP 500 a.Id, a.Action, a.EntityType, a.EntityId, a.OccurredAt,
              u.Email AS UserEmail
       FROM AuditLog a
       LEFT JOIN Users u ON u.Id = a.UserId
       ORDER BY a.OccurredAt DESC`,
    );
    return res.recordset;
  }
}
