import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { BentoService } from './bento.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private service: DashboardService,
    private bento: BentoService,
  ) {}

  /** Payload for the analytics bento (line, hourly waves, treemap, radar) - role-aware and scoped like the main dashboard. */
  @Get('bento')
  getBento(@Req() req: AuthenticatedRequest) {
    return this.bento.build(req.user);
  }

  /** KPIs + charts for the caller's role; ?days=30|90|180|365 sets the time window. */
  @Get()
  get(@Req() req: AuthenticatedRequest, @Query('days') days?: string) {
    return this.service.build(req.user, days ? parseInt(days, 10) : undefined);
  }
}
