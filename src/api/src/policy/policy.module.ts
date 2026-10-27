import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchemaService } from './schema.service';
import { ScopeService } from './scope.service';
import { CreditDeadlineService } from './credit-deadline.service';
import { TransferPolicyService } from './transfer-policy.service';
import { ExamCreditService } from './exam-credit.service';
import { CourseMappingsService } from './course-mappings.service';
import { ProgrammeRulesService } from './programme-rules.service';
import { PolicyExtensionsService } from './policy-extensions.service';
import { PolicyController } from './policy.controller';
import { ProgrammeRulesController } from './programme-rules.controller';

@Global()
@Module({
  imports: [AuthModule],
  providers: [SchemaService, ScopeService, CreditDeadlineService, ExamCreditService, CourseMappingsService, ProgrammeRulesService, PolicyExtensionsService, TransferPolicyService],
  controllers: [PolicyController, ProgrammeRulesController],
  exports: [SchemaService, ScopeService, CreditDeadlineService, ExamCreditService, CourseMappingsService, ProgrammeRulesService, TransferPolicyService],
})
export class PolicyModule {}
