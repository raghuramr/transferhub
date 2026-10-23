import { Module } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { CourseTopicsService } from './course-topics.service';
import { CourseTopicsController } from './course-topics.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [CoursesService, CourseTopicsService],
  controllers: [CoursesController, CourseTopicsController],
  exports: [CoursesService, CourseTopicsService],
})
export class CoursesModule {}
