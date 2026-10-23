import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Res, UseGuards,
  ParseIntPipe, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AgenciesService } from './agencies.service';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { UpdateAgencyDto } from './dto/update-agency.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('agencies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class AgenciesController {
  constructor(private agenciesService: AgenciesService) {}

  @Get()
  findAll(@Query('search') search?: string, @Query('isActive') isActive?: string) {
    return this.agenciesService.findAll({
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('export')
  async exportCsv(@Res() res: Response) {
    const csv = await this.agenciesService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="agencies.csv"');
    res.send(csv);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.agenciesService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateAgencyDto) {
    return this.agenciesService.create(dto);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.agenciesService.importCsv(file.buffer.toString('utf-8'));
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAgencyDto) {
    return this.agenciesService.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.agenciesService.deactivate(id);
  }
}
