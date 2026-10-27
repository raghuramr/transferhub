import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from './email.service';
import { EmailOverridesService } from './email-overrides.service';
import { EmailTemplatesController } from './email-templates.controller';

/** Editable e-mail template text + CC recipients (System Settings > Email). Loads the overrides at start-up. */
@Module({
  imports: [AuthModule],
  providers: [EmailService, EmailOverridesService],
  controllers: [EmailTemplatesController],
})
export class EmailTemplatesModule {}
