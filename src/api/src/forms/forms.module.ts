import { Module } from '@nestjs/common';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [FormsService],
  controllers: [FormsController],
  exports: [FormsService],
})
export class FormsModule {}
