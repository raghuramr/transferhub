import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ComparisonController } from './comparison.controller';
import { ComparisonService } from './comparison.service';

@Module({
  imports: [AuthModule],
  providers: [ComparisonService],
  controllers: [ComparisonController],
})
export class ComparisonModule {}
