import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { BlobStorageService } from '../uploads/blob-storage.service';
import { DemoService } from './demo.service';
import { DemoDocumentsService } from './demo-documents.service';
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
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(out.bytes);
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
}
