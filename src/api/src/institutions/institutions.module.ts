import { Module } from '@nestjs/common';
import { InstitutionsService } from './institutions.service';
import { InstitutionsController } from './institutions.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [InstitutionsService],
  controllers: [InstitutionsController],
  exports: [InstitutionsService],
})
export class InstitutionsModule {}
