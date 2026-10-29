import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { uploadInterceptorOptions } from './uploads.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

/** Super-admin media gallery: public files (team photos, logos...) with a public URL usable anywhere. */
@Controller('gallery')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class GalleryController {
  constructor(private uploads: UploadsService) {}

  @Get()
  list() {
    return this.uploads.listGallery();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions()))
  upload(@UploadedFile() file: UploadedFileLike, @Body() body: { category?: string }, @Req() req: AuthenticatedRequest) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.uploads.saveGallery(file, req.user.id, req.user.role, body.category);
  }

  /** Rename / change category. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; category?: string | null }) {
    return this.uploads.updateGallery(id, body);
  }

  /** Replace the file; its public URL stays the same. */
  @Put(':id/file')
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions()))
  replace(@Param('id') id: string, @UploadedFile() file: UploadedFileLike) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.uploads.replaceGallery(id, file);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.uploads.deleteGallery(id);
  }
}
