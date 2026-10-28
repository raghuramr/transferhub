import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PurgeController } from './purge.controller';
import { PurgeService } from './purge.service';

@Module({
  imports: [AuthModule],
  providers: [PurgeService],
  controllers: [PurgeController],
})
export class PurgeModule {}
