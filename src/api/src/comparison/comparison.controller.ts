import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { ComparisonService } from './comparison.service';

@Controller('comparison')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('faculty', 'admin', 'super_admin') // students and agencies may not call this
export class ComparisonController {
  constructor(private service: ComparisonService) {}

  @Get('evaluation/:evaluationId')
  forEvaluation(@Param('evaluationId', new ParseUUIDPipe()) evaluationId: string, @Req() req: AuthenticatedRequest) {
    return this.service.forEvaluation(evaluationId, req.user);
  }
}
