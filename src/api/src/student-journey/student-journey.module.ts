import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { TranscriptsModule } from '../transcripts/transcripts.module';
import { ProgressService } from '../progress/progress.service';
import { StudentJourneyController } from './student-journey.controller';
import { StudentJourneyService } from './student-journey.service';

// ProgressService is provided here as well (ProgressModule does not export it); its dependencies
// come from the global PolicyModule / DatabaseModule and AiModule. TranscriptsModule provides
// TranscriptsService for the multi-apply endpoint.
@Module({
  imports: [AuthModule, AiModule, TranscriptsModule],
  providers: [StudentJourneyService, ProgressService],
  controllers: [StudentJourneyController],
})
export class StudentJourneyModule {}
