import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, Res, UseGuards,
  ParseIntPipe, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UniversitiesService } from './universities.service';
import { CreateUniversityDto } from './dto/create-university.dto';
import { UpdateUniversityDto } from './dto/update-university.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import type { UploadedFileLike } from '../common/uploaded-file.interface';

// Read endpoints (list/get) are open to any authenticated role — every
// role's forms need to read the University catalog (e.g. the student/
// agency transcript cascade), not just SuperAdmin. Only mutations are
// admin/super_admin-gated, same split as CoursesController.
@Controller('universities')
@UseGuards(JwtAuthGuard)
export class UniversitiesController {
  constructor(private universitiesService: UniversitiesService) {}

  @Get()
  findAll(@Query('search') search?: string, @Query('isActive') isActive?: string) {
    return this.universitiesService.findAll({
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  async exportCsv(@Res() res: Response) {
    const csv = await this.universitiesService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="universities.csv"');
    res.send(csv);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.universitiesService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  create(@Body() dto: CreateUniversityDto) {
    return this.universitiesService.create(dto);
  }

  @Post('import')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: UploadedFileLike) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.universitiesService.importCsv(file.buffer.toString('utf-8'));
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUniversityDto) {
    return this.universitiesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.universitiesService.deactivate(id);
  }

  /**
   * Builds/refreshes a public Custom Pages page listing this university's
   * course Topics grouped by Program (slug `university-{code}`).
   */
  @Post(':id/generate-page')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  generatePage(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    return this.universitiesService.generatePublicPage(id, req.user.id);
  }
}
