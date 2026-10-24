import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FormsService } from './forms.service';
import { UpsertFormDto, SubmitFormDto, DecideSubmissionDto } from './dto/upsert-form.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

@Controller('forms')
@UseGuards(JwtAuthGuard)
export class FormsController {
  constructor(private formsService: FormsService) {}

  /** Admins see every form (any status); everyone else only sees open ones. */
  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    const isStaff = ['admin', 'super_admin'].includes(req.user.role);
    return this.formsService.findAll(isStaff);
  }

  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.formsService.findOpenBySlug(slug);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.formsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Permission('forms', 'create')
  create(@Body() dto: UpsertFormDto, @Req() req: AuthenticatedRequest) {
    return this.formsService.create(dto, req.user.id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Permission('forms', 'edit')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertFormDto) {
    return this.formsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Permission('forms', 'delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.formsService.remove(id);
  }

  @Post(':id/submit')
  submit(@Param('id', ParseIntPipe) id: number, @Body() dto: SubmitFormDto, @Req() req: AuthenticatedRequest) {
    return this.formsService.submit(id, dto, req.user.id);
  }

  @Get(':id/submissions')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  listSubmissions(@Param('id', ParseIntPipe) id: number) {
    return this.formsService.listSubmissions(id);
  }

  @Post('submissions/:submissionId/decide')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  decideSubmission(
    @Param('submissionId') submissionId: string,
    @Body() dto: DecideSubmissionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.formsService.decideSubmission(submissionId, dto, req.user.id);
  }
}
