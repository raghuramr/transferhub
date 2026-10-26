import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { AppealsService } from './appeals.service';
import { CreateAppealDto, DecideAppealDto } from './dto/appeals.dto';
import type { Viewer } from './requests.service';

const viewerOf = (req: AuthenticatedRequest): Viewer => ({
  id: req.user.id,
  role: req.user.role,
  email: req.user.email,
  firstName: req.user.firstName,
  lastName: req.user.lastName,
});

/** Transfer credit appeals (one course per appeal), mirroring BU's Transfer Credit Appeal Form. */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppealsController {
  constructor(private appeals: AppealsService) {}

  @Post('requests/:id/courses/:courseId/appeal')
  @Roles('student', 'agency')
  create(@Param('id') id: string, @Param('courseId') courseId: string, @Body() dto: CreateAppealDto, @Req() req: AuthenticatedRequest) {
    return this.appeals.create(id, courseId, viewerOf(req), dto);
  }

  @Get('requests/:id/appeals')
  forRequest(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.appeals.forTranscript(id, viewerOf(req));
  }

  @Get('appeals')
  @Roles('faculty', 'admin', 'super_admin')
  list(@Query('status') status: string | undefined, @Req() req: AuthenticatedRequest) {
    return this.appeals.listForStaff(viewerOf(req), status ?? 'open');
  }

  @Post('appeals/:id/decide')
  @Roles('faculty', 'admin', 'super_admin')
  decide(@Param('id', ParseIntPipe) id: number, @Body() dto: DecideAppealDto, @Req() req: AuthenticatedRequest) {
    return this.appeals.decide(id, viewerOf(req), dto);
  }
}
