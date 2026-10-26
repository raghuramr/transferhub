import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { UploadsModule } from '../uploads/uploads.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { EmailService } from '../common/email.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { SlaWatcherService } from './sla-watcher.service';
import { AppealsService } from './appeals.service';
import { AppealsController } from './appeals.controller';

@Module({
  imports: [AuthModule, AiModule, UploadsModule, WorkflowsModule],
  providers: [RequestsService, WorkflowEngineService, SlaWatcherService, AppealsService, EmailService],
  controllers: [RequestsController, AppealsController],
  exports: [WorkflowEngineService, RequestsService],
})
export class RequestsModule {}
