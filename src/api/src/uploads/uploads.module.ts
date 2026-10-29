import { Module } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { BlobStorageService } from './blob-storage.service';
import { UploadsController } from './uploads.controller';
import { GalleryController } from './gallery.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [UploadsService, BlobStorageService],
  controllers: [UploadsController, GalleryController],
  exports: [UploadsService, BlobStorageService],
})
export class UploadsModule {}
