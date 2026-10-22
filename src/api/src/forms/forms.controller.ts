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

@Controller('forms')
@UseGuards(JwtAuthGuard)
export class FormsController {
  constructor(private formsService: FormsService) {}

  /** Admins see every form (any status); everyone else only sees open ones. */
  @Get()
  findAll(@Req() req: any) {
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
  @Roles('admin', 'super_admin')
  create(@Body() dto: UpsertFormDto, @Req() req: any) {
    return this.formsService.create(dto, req.user.id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertFormDto) {
    return this.formsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.formsService.remove(id);
  }

  @Post(':id/submit')
  submit(@Param('id', ParseIntPipe) id: number, @Body() dto: SubmitFormDto, @Req() req: any) {
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
    @Req() req: any,
  ) {
    return this.formsService.decideSubmission(submissionId, dto, req.user.id);
  }
}
