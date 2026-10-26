import { Module } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { CourseTopicsService } from './course-topics.service';
import { CourseTopicsController } from './course-topics.controller';
import { EquivalenciesService } from './equivalencies.service';
import { EquivalenciesController } from './equivalencies.controller';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [CoursesService, CourseTopicsService, EquivalenciesService, VerificationService],
  controllers: [CoursesController, CourseTopicsController, EquivalenciesController, VerificationController],
  exports: [CoursesService, CourseTopicsService],
})
export class CoursesModule {}
