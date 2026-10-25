import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { RequestsService, Viewer } from './requests.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { AddDocumentDto, DecisionDto, NoteDto, ReasonDto, RemindDto } from './dto/requests.dto';

const viewerOf = (req: AuthenticatedRequest): Viewer => ({
  id: req.user.id,
  role: req.user.role,
  email: req.user.email,
  firstName: req.user.firstName,
  lastName: req.user.lastName,
});

/**
 * Transfer-request workflow: the stage timeline, approver decisions,
 * audience-filtered notes, documents and status reminders. Visibility is
 * enforced in RequestsService (per-viewer), not just by role here.
 */
@Controller('requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RequestsController {
  constructor(
    private requests: RequestsService,
    private engine: WorkflowEngineService,
  ) {}

  @Get('queue')
  @Roles('faculty', 'admin', 'super_admin')
  queue(@Req() req: AuthenticatedRequest, @Query('scope') scope?: string) {
    return this.requests.queue(viewerOf(req), scope === 'all' ? 'all' : 'mine');
  }

  @Get(':id')
  timeline(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.requests.getTimeline(id, viewerOf(req));
  }

  @Post(':id/decision')
  @Roles('faculty', 'admin', 'super_admin')
  async decide(@Param('id') id: string, @Body() dto: DecisionDto, @Req() req: AuthenticatedRequest) {
    const result = await this.engine.decide(id, viewerOf(req), dto);
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/skip-stage')
  @Permission('requests', 'bulk_action')
  async skip(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: AuthenticatedRequest) {
    const result = await this.engine.skipStage(id, viewerOf(req), dto.reason);
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/accept')
  @Permission('requests', 'bulk_action')
  async accept(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: AuthenticatedRequest) {
    const result = await this.engine.acceptRequest(id, viewerOf(req), dto.reason);
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/start-workflow')
  @Permission('requests', 'bulk_action')
  async start(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const started = await this.engine.startWorkflow(id, req.user.id);
    return { started, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/resume')
  @Permission('requests', 'bulk_action')
  async resume(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const result = await this.engine.resume(id, viewerOf(req));
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/notes')
  note(@Param('id') id: string, @Body() dto: NoteDto, @Req() req: AuthenticatedRequest) {
    return this.requests.postNote(id, viewerOf(req), dto);
  }

  @Post(':id/documents')
  addDocument(@Param('id') id: string, @Body() dto: AddDocumentDto, @Req() req: AuthenticatedRequest) {
    return this.requests.addDocument(id, viewerOf(req), dto);
  }

  @Delete(':id/documents/:docId')
  removeDocument(@Param('id') id: string, @Param('docId', ParseIntPipe) docId: number, @Req() req: AuthenticatedRequest) {
    return this.requests.removeDocument(id, docId, viewerOf(req));
  }

  @Post(':id/remind')
  remind(@Param('id') id: string, @Body() dto: RemindDto, @Req() req: AuthenticatedRequest) {
    return this.requests.remind(id, viewerOf(req), dto.message);
  }

  @Get(':id/ai-usage')
  @Roles('faculty', 'admin', 'super_admin')
  aiUsage(@Param('id') id: string) {
    return this.requests.usageForRequest(id);
  }
}
