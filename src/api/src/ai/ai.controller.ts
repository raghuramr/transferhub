import { Controller, Post, Get, Param, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private aiService: AiService) {}

  @Post('match/:courseId')
  @Roles('faculty', 'admin', 'super_admin')
  matchCourse(@Param('courseId', ParseIntPipe) courseId: number, @Req() req: any): Promise<any> {
    return this.aiService.matchCourse(courseId, req.user.id);
  }

  @Get('summary/:transcriptId')
  @Roles('faculty', 'admin', 'super_admin', 'student', 'agency')
  generateSummary(@Param('transcriptId', ParseIntPipe) transcriptId: number) {
    return this.aiService.generateSummary(transcriptId).then(text => ({ summary: text }));
  }
}
