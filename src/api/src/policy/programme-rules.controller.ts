import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { ProgrammeRulesService } from './programme-rules.service';
import { CreateProgramRuleDto, UpdateProgramRuleDto } from './programme-rules.dto';

/**
 * Programme rules (PRG-03..08). Same permission as the Transfer rules endpoints: the `workflows` module of the
 * Roles & Permissions matrix (super_admin and admin by default).
 */
@Controller('programme-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProgrammeRulesController {
  constructor(private rules: ProgrammeRulesService) {}

  @Get()
  @Permission('workflows', 'view')
  list(@Query('institutionId') institutionId?: string, @Query('programId') programId?: string, @Query('includeInactive') includeInactive?: string) {
    return this.rules.list({
      institutionId: institutionId ? Number(institutionId) : undefined,
      programId: programId ? Number(programId) : undefined,
      includeInactive: includeInactive === 'true',
    });
  }

  @Post()
  @Permission('workflows', 'edit')
  create(@Body() dto: CreateProgramRuleDto, @Req() req: AuthenticatedRequest) {
    return this.rules.create(dto, req.user.id);
  }

  @Patch(':id')
  @Permission('workflows', 'edit')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProgramRuleDto, @Req() req: AuthenticatedRequest) {
    return this.rules.update(id, dto, req.user.id);
  }

  /** Rules are deactivated, never deleted (a deactivated rule can be switched back on). */
  @Delete(':id')
  @Permission('workflows', 'edit')
  deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    return this.rules.setActive(id, false, req.user.id);
  }

  @Post(':id/activate')
  @Permission('workflows', 'edit')
  activate(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    return this.rules.setActive(id, true, req.user.id);
  }
}
