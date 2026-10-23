import { Module } from '@nestjs/common';
import { UniversitiesService } from './universities.service';
import { UniversitiesController } from './universities.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [UniversitiesService],
  controllers: [UniversitiesController],
  exports: [UniversitiesService],
})
export class UniversitiesModule {}
