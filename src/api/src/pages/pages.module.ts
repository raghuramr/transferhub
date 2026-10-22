import { Module } from '@nestjs/common';
import { PagesService } from './pages.service';
import { PagesController } from './pages.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [PagesService],
  controllers: [PagesController],
  exports: [PagesService],
})
export class PagesModule {}
