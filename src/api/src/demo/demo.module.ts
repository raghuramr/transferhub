import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TranscriptsModule } from '../transcripts/transcripts.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  imports: [AuthModule, TranscriptsModule],
  providers: [DemoService],
  controllers: [DemoController],
})
export class DemoModule {}
