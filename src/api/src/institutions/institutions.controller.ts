import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Res, UseGuards,
  ParseIntPipe, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InstitutionsService } from './institutions.service';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// Read endpoints (list/get) are open to any authenticated role — see the
// matching note in universities.controller.ts. Only mutations are gated.
@Controller('institutions')
@UseGuards(JwtAuthGuard)
export class InstitutionsController {
  constructor(private institutionsService: InstitutionsService) {}

  @Get()
  findAll(
    @Query('universityId') universityId?: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.institutionsService.findAll({
      universityId: universityId !== undefined ? parseInt(universityId, 10) : undefined,
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  async exportCsv(@Res() res: Response, @Query('universityId') universityId?: string) {
    const csv = await this.institutionsService.exportCsv({
      universityId: universityId !== undefined ? parseInt(universityId, 10) : undefined,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="institutions.csv"');
    res.send(csv);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.institutionsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  create(@Body() dto: CreateInstitutionDto) {
    return this.institutionsService.create(dto);
  }

  @Post('import')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.institutionsService.importCsv(file.buffer.toString('utf-8'));
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInstitutionDto) {
    return this.institutionsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.institutionsService.deactivate(id);
  }
}
