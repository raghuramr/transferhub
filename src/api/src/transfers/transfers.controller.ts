import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import { uploadInterceptorOptions } from '../uploads/uploads.controller';
import type { Viewer } from '../requests/requests.service';
import { ExchangeService } from './exchange.service';
import { TransfersService } from './transfers.service';
import { CreateDocumentRequestDto, PartyReminderDto, ResolveDocumentRequestDto, UploadForTransferDto } from './dto/transfers.dto';

const viewerOf = (req: AuthenticatedRequest): Viewer => ({
  id: req.user.id, role: req.user.role, email: req.user.email, firstName: req.user.firstName, lastName: req.user.lastName,
});
const toInt = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

/**
 * Transfers between universities. The summary/list endpoints are staff-only (the Transfers page);
 * the per-request endpoints (exchange, document requests, uploads, reminders) are also open to the
 * student and the submitting agency, who may only ever act for their own side - enforced in
 * ExchangeService, not just by role here. Staff operations follow the `transfers` permission module.
 */
@Controller('transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransfersController {
  constructor(private transfers: TransfersService, private exchange: ExchangeService) {}

  @Get('summary')
  @Roles('faculty', 'admin', 'super_admin')
  summary(@Req() req: AuthenticatedRequest, @Query('institutionId') institutionId?: string, @Query('days') days?: string) {
    return this.transfers.summary(viewerOf(req), { institutionId: toInt(institutionId), days: toInt(days) });
  }

  @Get()
  @Roles('faculty', 'admin', 'super_admin')
  list(
    @Req() req: AuthenticatedRequest,
    @Query('direction') direction?: string,
    @Query('institutionId') institutionId?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.transfers.list(viewerOf(req), {
      direction: direction === 'outgoing' ? 'outgoing' : 'incoming',
      institutionId: toInt(institutionId), bucket: status, q, page: toInt(page), pageSize: toInt(pageSize),
    });
  }

  /** One transfer with everything the three parties exchange on it. */
  @Get(':id')
  detail(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.exchange.exchange(id, viewerOf(req));
  }

  @Get(':id/exchange')
  exchangeOf(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.exchange.exchange(id, viewerOf(req));
  }

  @Post(':id/document-requests')
  createRequest(@Param('id') id: string, @Body() dto: CreateDocumentRequestDto, @Req() req: AuthenticatedRequest) {
    return this.exchange.createRequest(id, viewerOf(req), dto);
  }

  @Post(':id/document-requests/:rid/cancel')
  cancel(@Param('id') id: string, @Param('rid', ParseIntPipe) rid: number, @Body() dto: ResolveDocumentRequestDto, @Req() req: AuthenticatedRequest) {
    return this.exchange.close(id, rid, viewerOf(req), 'cancelled', dto.note);
  }

  @Post(':id/document-requests/:rid/decline')
  decline(@Param('id') id: string, @Param('rid', ParseIntPipe) rid: number, @Body() dto: ResolveDocumentRequestDto, @Req() req: AuthenticatedRequest) {
    return this.exchange.close(id, rid, viewerOf(req), 'declined', dto.note);
  }

  /** Answer a document request by uploading the file (stored in the student's folder). */
  @Post(':id/document-requests/:rid/fulfil')
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions()))
  fulfil(
    @Param('id') id: string,
    @Param('rid', ParseIntPipe) rid: number,
    @UploadedFile() file: UploadedFileLike,
    @Body() dto: UploadForTransferDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.exchange.upload(id, viewerOf(req), file, { documentType: dto.documentType, note: dto.note, documentRequestId: rid });
  }

  /** Upload a file against a transfer without a request (student, or staff of either university). */
  @Post(':id/uploads')
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions()))
  upload(@Param('id') id: string, @UploadedFile() file: UploadedFileLike, @Body() dto: UploadForTransferDto, @Req() req: AuthenticatedRequest) {
    if (dto.documentRequestId && !toInt(dto.documentRequestId)) throw new BadRequestException('Invalid document request');
    return this.exchange.upload(id, viewerOf(req), file, {
      party: dto.party, documentType: dto.documentType, note: dto.note, documentRequestId: toInt(dto.documentRequestId) ?? null,
    });
  }

  @Post(':id/reminders')
  remind(@Param('id') id: string, @Body() dto: PartyReminderDto, @Req() req: AuthenticatedRequest) {
    return this.exchange.remind(id, viewerOf(req), {
      toParty: dto.toParty, party: dto.party, message: dto.message, documentRequestId: toInt(dto.documentRequestId) ?? null,
    });
  }
}
