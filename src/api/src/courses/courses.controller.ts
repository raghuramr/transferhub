import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Res, UseGuards, UseInterceptors,
  UploadedFile, BadRequestException, ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('courses')
@UseGuards(JwtAuthGuard)
export class CoursesController {
  constructor(private coursesService: CoursesService) {}

  @Get('bu')
  findBuCourses(
    @Query('program') programArea?: string,
    @Query('search') search?: string,
    @Req() req?: any,
  ) {
    return this.coursesService.findBuCourses({ programArea, search }, req?.user?.id);
  }

  @Get('external')
  findExternalCourses(
    @Query('institution') institutionCode?: string,
    @Query('search') search?: string,
    @Req() req?: any,
  ) {
    return this.coursesService.findExternalCourses(institutionCode, search, req?.user?.id);
  }

  @Get('search')
  search(@Query('q') q: string, @Query('institution') institutionCode?: string, @Req() req?: any) {
    return institutionCode
      ? this.coursesService.findExternalCourses(institutionCode, q, req?.user?.id)
      : this.coursesService.findBuCourses({ search: q }, req?.user?.id);
  }

  @Get('institutions')
  findInstitutions() {
    return this.coursesService.findInstitutions();
  }

  @Get('departments')
  getDepartments() {
    return this.coursesService.getDepartments();
  }

  @Get('programs')
  findPrograms(@Query('institutionId') institutionId?: string) {
    return this.coursesService.findPrograms(institutionId ? parseInt(institutionId, 10) : undefined);
  }

  @Get('equivalencies')
  findEquivalencies(
    @Query('buCourseId') buCourseId?: string,
    @Query('externalCourseId') externalCourseId?: string,
  ) {
    return this.coursesService.findEquivalencies(
      buCourseId ? parseInt(buCourseId) : undefined,
      externalCourseId ? parseInt(externalCourseId) : undefined,
    );
  }

  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  async exportCsv(@Res() res: Response) {
    const csv = await this.coursesService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="courses.csv"');
    res.send(csv);
  }

  @Post('import')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.coursesService.importCsv(file.buffer.toString('utf-8'));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  create(@Body() dto: CreateCourseDto) {
    return this.coursesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<CreateCourseDto>) {
    return this.coursesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.deactivate(id);
  }
}
