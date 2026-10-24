import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Res, UseGuards,
  ParseIntPipe, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import { AgenciesService } from './agencies.service';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { UpdateAgencyDto } from './dto/update-agency.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';

// Every endpoint is gated by the Roles & Permissions matrix (`agencies`
// module) instead of a static @Roles() array, so toggling a grant off for
// a role actually restricts it. See database/seed/008_roles_permissions.sql
// for the starting grant set and CLAUDE.md for the design.
@Controller('agencies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgenciesController {
  constructor(private agenciesService: AgenciesService) {}

  @Get()
  @Permission('agencies', 'view')
  findAll(@Query('search') search?: string, @Query('isActive') isActive?: string) {
    return this.agenciesService.findAll({
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('export')
  @Permission('agencies', 'export')
  async exportCsv(@Res() res: Response) {
    const csv = await this.agenciesService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="agencies.csv"');
    res.send(csv);
  }

  @Get(':id')
  @Permission('agencies', 'view')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.agenciesService.findById(id);
  }

  @Post()
  @Permission('agencies', 'create')
  create(@Body() dto: CreateAgencyDto) {
    return this.agenciesService.create(dto);
  }

  @Post('import')
  @Permission('agencies', 'import')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: UploadedFileLike) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.agenciesService.importCsv(file.buffer.toString('utf-8'));
  }

  @Patch(':id')
  @Permission('agencies', 'edit')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAgencyDto) {
    return this.agenciesService.update(id, dto);
  }

  @Delete(':id')
  @Permission('agencies', 'delete')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.agenciesService.deactivate(id);
  }
}
