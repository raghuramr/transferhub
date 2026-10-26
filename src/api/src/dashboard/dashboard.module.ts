import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { BentoService } from './bento.service';
import { DashboardController } from './dashboard.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [DashboardService, BentoService],
  controllers: [DashboardController],
})
export class DashboardModule {}
