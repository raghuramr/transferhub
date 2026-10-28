import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from './email.service';
import { EmailOverridesService } from './email-overrides.service';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailCustomService } from './email-custom.service';
import { EmailCustomController } from './email-custom.controller';

/** Editable e-mail template text + CC recipients (System Settings > Email). Loads the overrides at start-up. */
@Module({
  imports: [AuthModule],
  providers: [EmailService, EmailOverridesService, EmailCustomService],
  controllers: [EmailTemplatesController, EmailCustomController],
})
export class EmailTemplatesModule {}
