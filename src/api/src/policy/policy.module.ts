import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchemaService } from './schema.service';
import { TransferPolicyService } from './transfer-policy.service';
import { PolicyController } from './policy.controller';

@Global()
@Module({
  imports: [AuthModule],
  providers: [SchemaService, TransferPolicyService],
  controllers: [PolicyController],
  exports: [SchemaService, TransferPolicyService],
})
export class PolicyModule {}
