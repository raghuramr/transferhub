import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FORMAT_DOC, ImportService } from './import.service';
import { PartnersService } from './partners.service';
import { SubmissionsService } from './submissions.service';
import { ImportPayloadDto } from './dto/import-payload.dto';
import {
  CreatePartnerDto, EditRowDto, ImportRowsDto, IssueKeyDto, RejectBatchDto, RowIdsDto,
  SendReportDto, SubmissionBodyDto, UpdatePartnerDto,
} from './dto/partner.dto';

@Controller('import')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class ImportController {
  constructor(
    private importService: ImportService,
    private partners: PartnersService,
    private submissions: SubmissionsService,
  ) {}

  /** Expected JSON for each importable entity type (also served publicly at /public/v1/format). */
  @Get('format')
  getFormat() {
    return FORMAT_DOC;
  }

  @Get('endpoint-info')
  endpointInfo() {
    return { baseUrl: this.partners.endpointBase, submitUrl: `${this.partners.endpointBase}/submissions`, formatUrl: `${this.partners.endpointBase}/format` };
  }

  /** Direct import: preview without saving. */
  @Post('preview')
  preview(@Body() dto: ImportPayloadDto) {
    return this.importService.preview(dto);
  }

  /** Direct import: write straight to the catalogue. */
  @Post()
  execute(@Body() dto: ImportPayloadDto) {
    return this.importService.execute(dto);
  }

  // ── partners & API keys ───────────────────────────────────────

  @Get('partners')
  listPartners() {
    return this.partners.list();
  }

  @Post('partners')
  createPartner(@Body() dto: CreatePartnerDto, @Req() req: { user: { id: string } }) {
    return this.partners.create(dto, req.user.id);
  }

  @Patch('partners/:id')
  updatePartner(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(id, dto);
  }

  @Post('partners/:id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.partners.setActive(id, false);
  }

  @Post('partners/:id/activate')
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.partners.setActive(id, true);
  }

  @Post('partners/:id/keys')
  issueKey(@Param('id', ParseIntPipe) id: number, @Body() dto: IssueKeyDto, @Req() req: { user: { id: string } }) {
    return this.partners.issueKey(id, dto, req.user.id, !!dto.emailKey);
  }

  @Delete('partners/:id/keys/:keyId')
  revokeKey(@Param('id', ParseIntPipe) id: number, @Param('keyId', ParseIntPipe) keyId: number) {
    return this.partners.revokeKey(id, keyId);
  }

  // ── submissions (staging) ─────────────────────────────────────

  /** Stage rows from the UI (e.g. a pasted file) into the same review queue partners use. */
  @Post('batches')
  stage(@Body() dto: SubmissionBodyDto) {
    return this.submissions.stageByStaff(dto);
  }

  @Get('batches')
  listBatches(@Query('status') status?: string, @Query('partnerId') partnerId?: string) {
    return this.submissions.list({ status, partnerId: partnerId ? Number(partnerId) : undefined });
  }

  @Get('batches/:id')
  getBatch(@Param('id', ParseIntPipe) id: number) {
    return this.submissions.get(id);
  }

  @Patch('batches/:id/rows/:rowId')
  editRow(@Param('id', ParseIntPipe) id: number, @Param('rowId', ParseIntPipe) rowId: number, @Body() dto: EditRowDto) {
    return this.submissions.editRow(id, rowId, dto.payload);
  }

  @Post('batches/:id/rows/reject')
  rejectRows(@Param('id', ParseIntPipe) id: number, @Body() dto: RowIdsDto, @Req() req: { user: { id: string } }) {
    return this.submissions.rejectRows(id, dto.rowIds, dto.note, req.user.id);
  }

  @Post('batches/:id/rows/restore')
  restoreRows(@Param('id', ParseIntPipe) id: number, @Body() dto: RowIdsDto) {
    return this.submissions.restoreRows(id, dto.rowIds);
  }

  @Post('batches/:id/import')
  importRows(@Param('id', ParseIntPipe) id: number, @Body() dto: ImportRowsDto, @Req() req: { user: { id: string } }) {
    return this.submissions.importRows(id, dto.rowIds, { sendReport: dto.sendReport, note: dto.note }, req.user.id);
  }

  @Post('batches/:id/reject')
  rejectBatch(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectBatchDto, @Req() req: { user: { id: string } }) {
    return this.submissions.rejectBatch(id, dto.note, req.user.id, dto.sendReport !== false);
  }

  @Post('batches/:id/send-report')
  async sendReport(@Param('id', ParseIntPipe) id: number, @Body() dto: SendReportDto) {
    const delivered = await this.submissions.sendReport(id, dto.note);
    return { sent: delivered, message: delivered ? 'Report emailed to the contact' : 'Email is not configured on this server (RESEND_API_KEY) - nothing was sent' };
  }
}
