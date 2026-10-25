import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyGuard, clientIp, type PartnerRequest } from './api-key.guard';
import { FORMAT_DOC } from './import.service';
import { SubmissionsService } from './submissions.service';
import { SubmissionBodyDto } from './dto/partner.dto';

/**
 * The partner-facing API. Authenticated with an API key issued from
 * Super Admin > Data Import > Partners (no user login). Submissions are only
 * staged for review - they never write to the live catalogue.
 */
@Controller('public/v1')
@SkipThrottle()
export class PublicImportController {
  constructor(private submissions: SubmissionsService) {}

  /** Field reference. Needs no key, so it can be shared as documentation. */
  @Get('format')
  format() {
    return FORMAT_DOC;
  }

  @Post('submissions')
  @UseGuards(ApiKeyGuard)
  async submit(@Req() req: PartnerRequest, @Body() body: SubmissionBodyDto) {
    return this.submissions.receive(body, req.partner, clientIp(req));
  }

  @Get('submissions')
  @UseGuards(ApiKeyGuard)
  async mine(@Req() req: PartnerRequest) {
    return { partner: req.partner.universityName, submissions: await this.submissions.listForPartner(req.partner.partnerId) };
  }

  @Get('submissions/:reference')
  @UseGuards(ApiKeyGuard)
  async one(@Req() req: PartnerRequest, @Param('reference') reference: string) {
    return this.submissions.getForPartner(req.partner.partnerId, reference);
  }
}
