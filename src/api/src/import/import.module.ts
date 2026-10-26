import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { PublicImportController } from './public-import.controller';
import { ImportService } from './import.service';
import { PartnersService } from './partners.service';
import { SubmissionsService } from './submissions.service';
import { ApiKeyGuard } from './api-key.guard';
import { AuthModule } from '../auth/auth.module';
import { IntakeModule } from '../intake/intake.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [AuthModule, IntakeModule],
  controllers: [ImportController, PublicImportController],
  providers: [ImportService, PartnersService, SubmissionsService, ApiKeyGuard, EmailService],
})
export class ImportModule {}
