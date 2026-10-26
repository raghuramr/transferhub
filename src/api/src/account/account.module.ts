import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [AuthModule, UploadsModule],
  providers: [AccountService, EmailService],
  controllers: [AccountController],
})
export class AccountModule {}
