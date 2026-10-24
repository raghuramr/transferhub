import { Controller, Post, Get, Param, Req, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private aiService: AiService) {}

  @Post('match/:evaluationId')
  @Roles('faculty', 'admin', 'super_admin')
  matchCourse(@Param('evaluationId') evaluationId: string, @Req() req: AuthenticatedRequest) {
    return this.aiService.matchCourse(evaluationId, req.user.id);
  }

  @Get('summary/:transcriptId')
  @Roles('faculty', 'admin', 'super_admin', 'student', 'agency')
  generateSummary(@Param('transcriptId') transcriptId: string) {
    return this.aiService.generateSummary(transcriptId).then(text => ({ summary: text }));
  }
}
