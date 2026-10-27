import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiControlsController } from './ai-controls.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiUsageService } from './ai-usage.service';
import { ReadinessService } from './readiness.service';
import { BacktestService } from './backtest.service';
import { EmailService } from '../common/email.service';
import { EmailController } from '../common/email.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [AiService, AiSettingsService, AiUsageService, ReadinessService, BacktestService, EmailService],
  controllers: [AiController, AiControlsController, EmailController],
  exports: [AiService, AiSettingsService, AiUsageService],
})
export class AiModule {}
