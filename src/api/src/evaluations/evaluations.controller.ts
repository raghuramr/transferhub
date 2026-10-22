import { Controller, Get, Post, Param, Body, Req, UseGuards, Query } from '@nestjs/common';
import { EvaluationsService } from './evaluations.service';
import { DecideEvaluationDto, AssignEvaluationDto } from './dto/create-evaluation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('evaluations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('faculty', 'admin', 'super_admin')
export class EvaluationsController {
  constructor(private evaluationsService: EvaluationsService) {}

  @Get()
  list(
    @Req() req: any,
    @Query('assigned') assigned?: string,
    @Query('status') status?: string,
  ) {
    return this.evaluationsService.list({
      statusList: status ? status.split(',') : undefined,
      assignedToMe: assigned === 'me',
      userId: req.user.id,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.evaluationsService.findById(id);
  }

  @Post(':id/decide')
  decide(@Param('id') id: string, @Body() dto: DecideEvaluationDto, @Req() req: any) {
    return this.evaluationsService.decide(id, dto, req.user.id);
  }

  @Post(':id/assign')
  @Roles('admin', 'super_admin')
  assign(@Param('id') id: string, @Body() dto: AssignEvaluationDto) {
    return this.evaluationsService.assign(id, dto);
  }

  @Post(':id/post')
  @Roles('admin', 'super_admin')
  post(@Param('id') id: string, @Req() req: any) {
    return this.evaluationsService.post(id, req.user.id);
  }
}
