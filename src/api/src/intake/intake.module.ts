import { Module } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { IntakeAdminController, IntakeController } from './intake.controller';
import { DbSourceConnector, SOURCE_CONNECTORS } from './source-connector';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { TranscriptsModule } from '../transcripts/transcripts.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [AuthModule, UploadsModule, TranscriptsModule],
  providers: [
    IntakeService,
    EmailService,
    DbSourceConnector,
    // Add a real registrar / exchange connector here later; they are tried in order.
    { provide: SOURCE_CONNECTORS, useFactory: (db: DbSourceConnector) => [db], inject: [DbSourceConnector] },
  ],
  controllers: [IntakeController, IntakeAdminController],
  exports: [IntakeService],
})
export class IntakeModule {}
