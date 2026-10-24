import { Module } from '@nestjs/common';
import { UniversitiesService } from './universities.service';
import { UniversitiesController } from './universities.controller';
import { AuthModule } from '../auth/auth.module';
import { PagesModule } from '../pages/pages.module';

@Module({
  imports: [AuthModule, PagesModule],
  providers: [UniversitiesService],
  controllers: [UniversitiesController],
  exports: [UniversitiesService],
})
export class UniversitiesModule {}
