import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { RequestsModule } from '../requests/requests.module';
import { EmailService } from '../common/email.service';
import { ExchangeService } from './exchange.service';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';

@Module({
  imports: [AuthModule, UploadsModule, WorkflowsModule, RequestsModule],
  providers: [ExchangeService, TransfersService, EmailService],
  controllers: [TransfersController],
  exports: [ExchangeService],
})
export class TransfersModule {}
