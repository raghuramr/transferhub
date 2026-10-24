import { Module } from '@nestjs/common';
import { TranscriptsService } from './transcripts.service';
import { TranscriptsController } from './transcripts.controller';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [AuthModule],
  providers: [TranscriptsService, EmailService],
  controllers: [TranscriptsController],
  exports: [TranscriptsService],
})
export class TranscriptsModule {}
