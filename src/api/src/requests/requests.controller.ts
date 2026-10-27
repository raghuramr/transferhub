import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { RequestsService, Viewer } from './requests.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { TransferPolicyService } from '../policy/transfer-policy.service';
import { PassFailExceptionDto, AcceptSuggestionsDto, AddDocumentDto, BulkApproveDto, DecisionDto, NoteDto, ReasonDto, RemindDto } from './dto/requests.dto';

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
    private policy: TransferPolicyService,
  ) {}

  @Get('queue')
  @Roles('faculty', 'admin', 'super_admin')
  queue(@Req() req: AuthenticatedRequest, @Query('scope') scope?: string) {
    return this.requests.queue(viewerOf(req), scope === 'all' ? 'all' : 'mine');
  }

  /** Approve several requests at once (each is checked on its own: you must be an approver of its current stage). */
  @Post('bulk-approve')
  @Roles('faculty', 'admin', 'super_admin')
  async bulkApprove(@Body() dto: BulkApproveDto, @Req() req: AuthenticatedRequest) {
    const results: { id: string; ok: boolean; message: string }[] = [];
    for (const id of dto.ids) {
      try {
        await this.requests.assertCanWork(id, viewerOf(req));
        const r = await this.engine.decide(id, viewerOf(req), { decision: 'approve', comment: dto.comment });
        results.push({ id, ok: true, message: r.message });
      } catch (e) {
        results.push({ id, ok: false, message: (e as Error).message });
      }
    }
    return { approved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  @Get(':id')
  timeline(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.requests.getTimeline(id, viewerOf(req));
  }

  @Post(':id/decision')
  @Roles('faculty', 'admin', 'super_admin')
  async decide(@Param('id') id: string, @Body() dto: DecisionDto, @Req() req: AuthenticatedRequest) {
    await this.requests.assertCanWork(id, viewerOf(req));
    const result = await this.engine.decide(id, viewerOf(req), dto);
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/accept-suggestions')
  @Roles('faculty', 'admin', 'super_admin')
  async acceptSuggestions(@Param('id') id: string, @Body() dto: AcceptSuggestionsDto, @Req() req: AuthenticatedRequest) {
    await this.requests.assertCanWork(id, viewerOf(req));
    const result = await this.engine.acceptSuggestions(id, viewerOf(req), dto.minConfidence);
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  /** Admin: the student is admitted, so preview request(s) become official and enter the workflow. */
  @Post(':id/make-official')
  @Roles('admin', 'super_admin')
  async makeOfficial(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requests.assertCanWork(id, viewerOf(req));
    const result = await this.engine.makeOfficial(id, viewerOf(req));
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  /** Reviewer: accept that a Pass/Fail course is an allowed exception (home college required P/F). */
  @Post(':id/courses/:courseId/pass-fail-exception')
  @Roles('faculty', 'admin', 'super_admin')
  async passFail(@Param('id') id: string, @Param('courseId') courseId: string, @Body() dto: PassFailExceptionDto, @Req() req: AuthenticatedRequest) {
    await this.requests.assertCanWork(id, viewerOf(req));
    await this.policy.setPassFailException(id, courseId, dto.exception);
    return { message: dto.exception ? 'Exception recorded' : 'Exception withdrawn', timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/skip-stage')
  @Permission('requests', 'bulk_action')
  async skip(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: AuthenticatedRequest) {
    await this.requests.assertCanWork(id, viewerOf(req));
    const result = await this.engine.skipStage(id, viewerOf(req), dto.reason);
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/accept')
  @Permission('requests', 'bulk_action')
  async accept(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: AuthenticatedRequest) {
    await this.requests.assertCanWork(id, viewerOf(req));
    const result = await this.engine.acceptRequest(id, viewerOf(req), dto.reason);
    return { ...result, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/start-workflow')
  @Permission('requests', 'bulk_action')
  async start(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requests.assertCanWork(id, viewerOf(req));
    const started = await this.engine.startWorkflow(id, req.user.id);
    return { started, timeline: await this.requests.getTimeline(id, viewerOf(req)) };
  }

  @Post(':id/resume')
  @Permission('requests', 'bulk_action')
  async resume(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requests.assertCanWork(id, viewerOf(req));
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
