import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchemaService } from './schema.service';
import { ScopeService } from './scope.service';
import { CreditDeadlineService } from './credit-deadline.service';
import { TransferPolicyService } from './transfer-policy.service';
import { PolicyController } from './policy.controller';

@Global()
@Module({
  imports: [AuthModule],
  providers: [SchemaService, ScopeService, CreditDeadlineService, TransferPolicyService],
  controllers: [PolicyController],
  exports: [SchemaService, ScopeService, CreditDeadlineService, TransferPolicyService],
})
export class PolicyModule {}
