import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import { DocumentsService } from './documents.service';
import { DOC_TYPE_KEYS } from './document-types';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);

class AttachIntakeDto {
  @IsString()
  transcriptId!: string;

  @IsOptional()
  @IsString()
  docTypeKey?: string;
}

class UpdateIntakeDto {
  @IsOptional()
  @IsString()
  @IsIn(DOC_TYPE_KEYS)
  docType?: string;

  @IsOptional()
  @IsObject()
  extracted?: Record<string, unknown>;
}

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private documents: DocumentsService) {}

  @Get('status')
  status() {
    return this.documents.status();
  }

  @Post('smart-upload')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 5 },
      fileFilter: (_req, file, cb) =>
        ALLOWED_EXTENSIONS.has(extname(file.originalname || '').toLowerCase())
          ? cb(null, true)
          : cb(new BadRequestException('Unsupported file type. Allowed: PDF, PNG, JPG, WebP.'), false),
    }),
  )
  smartUpload(@UploadedFiles() files: UploadedFileLike[], @Req() req: AuthenticatedRequest) {
    return this.documents.smartUpload(files, req.user);
  }

  @Get('intakes')
  list(@Req() req: AuthenticatedRequest, @Query('userId') userId?: string) {
    return this.documents.list(req.user, userId);
  }

  @Get('intakes/:id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documents.get(id, req.user);
  }

  @Patch('intakes/:id')
  patch(@Param('id') id: string, @Body() dto: UpdateIntakeDto, @Req() req: AuthenticatedRequest) {
    return this.documents.patch(id, req.user, dto);
  }

  @Post('intakes/:id/retry')
  retry(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documents.retry(id, req.user);
  }

  /** Re-runs extraction with the reader currently configured (also for confirmed documents). */
  @Post(':id/reprocess')
  reprocess(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documents.reprocess(id, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documents.remove(id, req.user);
  }

  @Post(':id/attach')
  attach(@Param('id') id: string, @Body() dto: AttachIntakeDto, @Req() req: AuthenticatedRequest) {
    return this.documents.attach(id, req.user, dto);
  }

  @Post('intakes/:id/confirm')
  confirm(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documents.confirm(id, req.user);
  }

  @Get('intakes/:id/prefill')
  prefill(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documents.prefill(id, req.user);
  }
}
