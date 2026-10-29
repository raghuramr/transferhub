import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { BentoService } from './bento.service';
import { DashboardController } from './dashboard.controller';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AuthModule, AiModule],
  providers: [DashboardService, BentoService],
  controllers: [DashboardController],
})
export class DashboardModule {}
