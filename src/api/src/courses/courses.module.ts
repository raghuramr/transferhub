import { Module } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [CoursesService],
  controllers: [CoursesController],
  exports: [CoursesService],
})
export class CoursesModule {}
