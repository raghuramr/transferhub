import { Controller, Get, Param, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { ProgressService } from './progress.service';

@Controller('progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private service: ProgressService) {}

  /** The signed-in student's own degree-progress view. */
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.service.build(req.user.id);
  }

  /** Staff (faculty/admin/super admin; admins limited by university scope) or the student themself. */
  @Get('student/:userId')
  student(@Param('userId', new ParseUUIDPipe()) userId: string, @Req() req: AuthenticatedRequest) {
    return this.service.forStudent(req.user, userId);
  }
}
