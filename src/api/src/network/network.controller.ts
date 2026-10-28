import { BadRequestException, Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { NetworkService } from './network.service';

const int = (v?: string): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException('Ids must be positive whole numbers.');
  return n;
};

@Controller('equivalency-network')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NetworkController {
  constructor(private service: NetworkService) {}

  /** How other universities treated this external course (anonymised; the viewer's own university is shown by name). */
  @Get('course')
  @Roles('faculty', 'admin', 'super_admin')
  course(
    @Query('institutionId') institutionId: string | undefined,
    @Query('code') code: string | undefined,
    @Query('title') title: string | undefined,
    @Query('targetInstitutionId') targetInstitutionId: string | undefined,
    @Query('candidateIds') candidateIds: string | undefined,
    @Query('evaluationId') evaluationId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!evaluationId && !title?.trim() && !(institutionId && code?.trim())) throw new BadRequestException('Give a course title, or an institutionId and code.');
    const ids = (candidateIds ?? '').split(',').map((x) => int(x.trim())).filter((x): x is number => !!x);
    return this.service.forCourse(
      { institutionId: int(institutionId), code: code?.slice(0, 50), title: title?.slice(0, 200), targetInstitutionId: int(targetInstitutionId), candidateIds: ids, evaluationId: evaluationId && /^[0-9a-f-]{36}$/i.test(evaluationId) ? evaluationId : undefined },
      req.user,
    );
  }

  @Get('summary')
  @Roles('admin', 'super_admin')
  summary() {
    return this.service.summary();
  }

  @Get('settings')
  @Roles('admin', 'super_admin')
  settings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @Roles('super_admin')
  saveSettings(@Body() body: { boostEnabled?: unknown }, @Req() req: AuthenticatedRequest) {
    if (typeof body?.boostEnabled !== 'boolean') throw new BadRequestException('boostEnabled must be true or false.');
    return this.service.setBoost(body.boostEnabled, req.user, req.ip);
  }
}
