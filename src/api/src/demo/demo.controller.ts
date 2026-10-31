import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { BlobStorageService } from '../uploads/blob-storage.service';
import { DemoService } from './demo.service';
import { DemoDocumentsService, type ManualDocRequest } from './demo-documents.service';
import type { DemoDocKind } from './demo-documents';

/** Presenter tooling for the hackathon demo. Super admin only; every write is audit-logged. */
@Controller('demo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class DemoController {
  constructor(private demo: DemoService, private docs: DemoDocumentsService, private storage: BlobStorageService) {}

  @Get('storage-status')
  storageStatus() {
    return this.storage.status();
  }

  /** Document types the generator can make. */
  @Get('documents/kinds')
  docKinds() {
    return this.docs.kinds();
  }

  @Get('documents/students')
  docStudents(@Query('q') q?: string) {
    return this.docs.listStudents(q);
  }

  /** Generates sample PDFs for the selected students from their own records; one PDF, or a ZIP when there are several. */
  @Post('documents/generate')
  @HttpCode(200)
  async generateDocs(@Body() body: { studentIds?: string[]; kinds?: DemoDocKind[] }, @Res() res: Response) {
    const out = await this.docs.generate(Array.isArray(body?.studentIds) ? body.studentIds : [], Array.isArray(body?.kinds) ? body.kinds : []);
    res.setHeader('Content-Type', out.mime);
    const ascii = out.fileName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(out.bytes);
  }

  /** Same renderers, but from details typed into the form: no student record needed. */
  @Post('documents/generate-manual')
  @HttpCode(200)
  async generateManualDocs(@Body() body: ManualDocRequest, @Res() res: Response) {
    const out = await this.docs.generateManual(body ?? {});
    res.setHeader('Content-Type', out.mime);
    const ascii = out.fileName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(out.bytes);
  }

  /** Dry run of the same checks, so the form can say what is missing before the download. */
  @Post('documents/check-manual')
  @HttpCode(200)
  checkManualDocs(@Body() body: ManualDocRequest) {
    const { missing, kinds } = this.docs.validateManual(body ?? {});
    return { ok: !missing.some((m) => !m.includes('will be left out')), missing, kinds };
  }

  @Get('status')
  status() {
    return this.demo.status();
  }

  /** Removes the Maya demo requests (and the equivalencies the demo decisions created) and rebuilds the scenario. */
  @Post('maya/reset')
  @HttpCode(200)
  reset(@Req() req: AuthenticatedRequest) {
    return this.demo.resetMaya({ id: req.user.id, email: req.user.email, role: req.user.role });
  }

  /** Noah Chen, same college + CSC 220, through the real submit path: proves the learning loop. */
  @Post('maya/second-student')
  @HttpCode(200)
  secondStudent(@Req() req: AuthenticatedRequest) {
    return this.demo.addSecondStudent({ id: req.user.id, email: req.user.email, role: req.user.role });
  }

  /** Wipes every transcript/course/document Maya has - recreates nothing. For starting a live walkthrough from zero. */
  @Post('maya/hard-reset')
  @HttpCode(200)
  hardReset(@Req() req: AuthenticatedRequest) {
    return this.demo.hardReset({ id: req.user.id, email: req.user.email, role: req.user.role });
  }

  /** Submits a real transcript of catalogue courses with existing equivalencies, so it is secured at once. */
  @Post('maya/build-baseline')
  @HttpCode(200)
  buildBaseline(@Body() body: { targetCredits?: number; institutionCode?: string }, @Req() req: AuthenticatedRequest) {
    return this.demo.buildBaseline({ id: req.user.id, email: req.user.email, role: req.user.role }, body ?? {});
  }
}
