import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { EquivalenciesService } from './equivalencies.service';
import { CreateEquivalencyDto, UpdateEquivalencyDto } from './dto/equivalency.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

/** Course equivalency mappings (with optional effective-date windows). Gated by the `courses` permission module. */
@Controller('equivalencies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EquivalenciesController {
  constructor(private service: EquivalenciesService) {}

  @Get()
  @Permission('courses', 'view')
  list(
    @Query('externalCourseId') externalCourseId?: string,
    @Query('buCourseId') buCourseId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list({
      externalCourseId: externalCourseId ? parseInt(externalCourseId, 10) : undefined,
      buCourseId: buCourseId ? parseInt(buCourseId, 10) : undefined,
      status: status || undefined,
      search: search || undefined,
    });
  }

  @Post()
  @Permission('courses', 'create')
  create(@Body() dto: CreateEquivalencyDto, @Req() req: AuthenticatedRequest) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  @Permission('courses', 'edit')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEquivalencyDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Permission('courses', 'delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.deactivate(id);
  }
}
