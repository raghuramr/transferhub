import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards, ParseIntPipe, Query } from '@nestjs/common';
import { EvaluationsService } from './evaluations.service';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('evaluations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EvaluationsController {
  constructor(private evaluationsService: EvaluationsService) {}

  @Get('queue')
  @Roles('faculty', 'admin', 'super_admin')
  getQueue(@Req() req: any, @Query('all') all?: string) {
    const facultyId = req.user.role === 'faculty' && all !== 'true' ? req.user.id : undefined;
    return this.evaluationsService.getQueue(facultyId);
  }

  @Get('ai-candidates/:courseId')
  @Roles('faculty', 'admin', 'super_admin')
  getAiCandidates(@Param('courseId', ParseIntPipe) courseId: number) {
    return this.evaluationsService.getAiCandidates(courseId);
  }

  @Post()
  @Roles('faculty', 'admin', 'super_admin')
  createEvaluation(@Body() dto: CreateEvaluationDto, @Req() req: any) {
    return this.evaluationsService.createEvaluation(dto, req.user.id);
  }

  @Patch(':id/finalize')
  @Roles('admin', 'super_admin')
  finalizeEvaluation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { approved: boolean; notes?: string },
    @Req() req: any,
  ) {
    return this.evaluationsService.finalizeEvaluation(id, body.approved, req.user.id, body.notes);
  }
}
