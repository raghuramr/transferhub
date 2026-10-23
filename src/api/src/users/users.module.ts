import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [AuthModule],
  providers: [UsersService, EmailService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
