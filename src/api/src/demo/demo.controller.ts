import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { DemoService } from './demo.service';

/** Presenter tooling for the hackathon demo. Super admin only; every write is audit-logged. */
@Controller('demo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class DemoController {
  constructor(private demo: DemoService) {}

  @Get('status')
  status() {
    return this.demo.status();
  }

  /** Removes the Maya demo requests (and the equivalencies the demo decisions created) and rebuilds the scenario. */
  @Post('maya/reset')
  @HttpCode(200)
  reset(@Req() req: AuthenticatedRequest) {
    return this.demo.resetMaya({ id: req.user.id, email: req.user.email, role: req.user.role });
  }

  /** Noah Chen, same college + CSC 220, through the real submit path: proves the learning loop. */
  @Post('maya/second-student')
  @HttpCode(200)
  secondStudent(@Req() req: AuthenticatedRequest) {
    return this.demo.addSecondStudent({ id: req.user.id, email: req.user.email, role: req.user.role });
  }
}
