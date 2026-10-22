import { Module } from '@nestjs/common';
import { TranscriptsService } from './transcripts.service';
import { TranscriptsController } from './transcripts.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [TranscriptsService],
  controllers: [TranscriptsController],
  exports: [TranscriptsService],
})
export class TranscriptsModule {}
