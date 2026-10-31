import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TranscriptsModule } from '../transcripts/transcripts.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ProgressModule } from '../progress/progress.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoDocumentsService } from './demo-documents.service';

@Module({
  imports: [AuthModule, TranscriptsModule, UploadsModule, ProgressModule],
  providers: [DemoService, DemoDocumentsService],
  controllers: [DemoController],
})
export class DemoModule {}
