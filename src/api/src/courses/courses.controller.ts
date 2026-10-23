import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
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
  ) {
    return this.coursesService.findBuCourses({ programArea, search });
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
      : this.coursesService.findBuCourses({ search: q });
  }

  @Get('institutions')
  findInstitutions() {
    return this.coursesService.findInstitutions();
  }

  @Get('departments')
  getDepartments() {
    return this.coursesService.getDepartments();
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
}
