import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

@Controller('uploads')
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: UploadedFileLike,
    @Body() body: { entityType?: string; entityId?: string; isPublic?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.uploadsService.save(file, {
      ownerUserId: req.user.id,
      role: req.user.role,
      entityType: body.entityType || 'generic',
      entityId: body.entityId,
      isPublic: body.isPublic === 'true' || body.isPublic === '1',
    });
  }

  /** Private document (e.g. a form-submission attachment) — owner or staff only. */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async download(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const { path: filePath, mimeType, fileName } = await this.uploadsService.getForAuthenticatedUser(id, req.user);
    if (!fs.existsSync(filePath)) throw new NotFoundException('File missing on disk');
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.sendFile(filePath);
  }

  /** Public asset (university logo/hero image) — no auth required. */
  @Get('public/:id')
  async downloadPublic(@Param('id') id: string, @Res() res: Response) {
    const { path: filePath, mimeType, fileName } = await this.uploadsService.getPublic(id);
    if (!fs.existsSync(filePath)) throw new NotFoundException('File missing on disk');
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.sendFile(filePath);
  }
}
