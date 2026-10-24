import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { CourseTopicsService } from './course-topics.service';
import { CreateCourseTopicDto, UpdateCourseTopicDto } from './dto/course-topic.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

// Editing course topics/reference links is gated by the Roles & Permissions
// matrix (`course_topics` module), which starts seeded to SuperAdmin/Admin/
// Faculty only (database/seed/008_roles_permissions.sql). Reading them is
// open to any authenticated role (students/agencies see them read-only when
// reviewing a match).

@Controller()
@UseGuards(JwtAuthGuard)
export class CourseTopicsController {
  constructor(private topicsService: CourseTopicsService) {}

  @Get('courses/:courseId/topics')
  findByCourse(@Param('courseId', ParseIntPipe) courseId: number) {
    return this.topicsService.findByCourse(courseId);
  }

  @Post('courses/:courseId/topics')
  @UseGuards(RolesGuard)
  @Permission('course_topics', 'create')
  create(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateCourseTopicDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.topicsService.create(courseId, dto, req.user?.id);
  }

  @Patch('course-topics/:id')
  @UseGuards(RolesGuard)
  @Permission('course_topics', 'edit')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCourseTopicDto, @Req() req: AuthenticatedRequest) {
    return this.topicsService.update(id, dto, req.user?.id);
  }

  @Delete('course-topics/:id')
  @UseGuards(RolesGuard)
  @Permission('course_topics', 'delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.topicsService.remove(id);
  }
}
