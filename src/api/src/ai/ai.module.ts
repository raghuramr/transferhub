import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiControlsController } from './ai-controls.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiProvidersService } from './ai-providers.service';
import { BenchmarkService } from './benchmark.service';
import { AiLearningService } from './ai-learning.service';
import { AiUsageService } from './ai-usage.service';
import { ReadinessService } from './readiness.service';
import { BacktestService } from './backtest.service';
import { EmailService } from '../common/email.service';
import { EmailController } from '../common/email.controller';
import { NetworkModule } from '../network/network.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, NetworkModule],
  providers: [AiService, AiSettingsService, AiProvidersService, BenchmarkService, AiLearningService, AiUsageService, ReadinessService, BacktestService, EmailService],
  controllers: [AiController, AiControlsController, EmailController],
  exports: [AiService, AiSettingsService, AiProvidersService, AiUsageService],
})
export class AiModule {}
