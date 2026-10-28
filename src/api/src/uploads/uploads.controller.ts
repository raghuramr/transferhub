import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Query,
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
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { extname } from 'path';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.svg',
]);

/** Shared by every endpoint that accepts one multipart `file`: size cap + extension allowlist. */
export function uploadInterceptorOptions() {
  return {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (_req: unknown, file: { originalname?: string }, cb: (e: Error | null, ok: boolean) => void) =>
      ALLOWED_EXTENSIONS.has(extname(file.originalname || '').toLowerCase())
        ? cb(null, true)
        : cb(new BadRequestException('Unsupported file type. Allowed: PDF, images, Word, Excel, CSV, text.'), false),
  };
}

@Controller('uploads')
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions()))
  async upload(
    @UploadedFile() file: UploadedFileLike,
    @Body() body: { entityType?: string; entityId?: string; isPublic?: string; documentType?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.uploadsService.save(file, {
      ownerUserId: req.user.id,
      role: req.user.role,
      entityType: body.entityType || 'generic',
      entityId: body.entityId,
      documentType: body.documentType,
      isPublic: body.isPublic === 'true' || body.isPublic === '1',
    });
  }

  /** The caller's own documents (staff may pass ?userId= to see a student's). */
  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: AuthenticatedRequest, @Query('userId') userId?: string, @Query('entityType') entityType?: string) {
    return this.uploadsService.listForUser(userId || req.user.id, req.user, entityType);
  }

  /** Private document (e.g. a form-submission attachment) - owner or staff only. */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async download(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const file = await this.uploadsService.getForAuthenticatedUser(id, req.user);
    await this.send(file, res, 'attachment');
  }

  /** Public asset (university logo/hero image) - no auth required. */
  @Get('public/:id')
  async downloadPublic(@Param('id') id: string, @Res() res: Response) {
    const file = await this.uploadsService.getPublic(id);
    // Public logos/banners are embedded by the UI, which may be served from another host than the API.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    await this.send(file, res, 'inline');
  }

  private async send(
    file: { provider: 'blob' | 'local'; container: string; blobName: string; mimeType: string | null; fileName: string },
    res: Response,
    disposition: 'inline' | 'attachment',
  ) {
    const stream = await this.uploadsService.openStream(file);
    if (!stream) throw new NotFoundException('File not found in storage');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.fileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
