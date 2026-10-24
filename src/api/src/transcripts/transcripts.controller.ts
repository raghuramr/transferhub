import {
  Controller, Get, Post, Patch, Param, Body, Query, Req, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { TranscriptsService } from './transcripts.service';
import { SubmitTranscriptDto } from './dto/create-transcript.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

@Controller('transcripts')
@UseGuards(JwtAuthGuard)
export class TranscriptsController {
  constructor(private transcriptsService: TranscriptsService) {}

  @Get()
  findAll(@Req() req: AuthenticatedRequest, @Query('status') status?: string) {
    const { id: userId, role } = req.user;
    const filters: { status?: string; requestingUserId: string; studentUserId?: string; submittedByUserId?: string } = { status, requestingUserId: userId };
    // Students & agencies only ever see their own submissions; staff see everything.
    if (role === 'student') {
      filters.studentUserId = userId;
    } else if (role === 'agency') {
      filters.submittedByUserId = userId;
    }
    return this.transcriptsService.findAll(filters);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const transcript = await this.transcriptsService.findById(id);
    const { email, role } = req.user;
    if (role === 'student' && transcript.studentEmail !== email) {
      throw new ForbiddenException();
    }
    return transcript;
  }

  @Post()
  create(@Body() dto: SubmitTranscriptDto, @Req() req: AuthenticatedRequest) {
    return this.transcriptsService.submit(dto, req.user.id);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('faculty', 'admin', 'super_admin')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transcriptsService.updateStatus(id, body.status, req.user.id);
  }
}
