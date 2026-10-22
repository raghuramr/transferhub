import {
  Controller, Get, Post, Patch, Param, Body, Query, Req, UseGuards, ForbiddenException, ParseIntPipe,
} from '@nestjs/common';
import { TranscriptsService } from './transcripts.service';
import { CreateTranscriptDto, AddTranscriptCourseDto } from './dto/create-transcript.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('transcripts')
@UseGuards(JwtAuthGuard)
export class TranscriptsController {
  constructor(private transcriptsService: TranscriptsService) {}

  @Get()
  findAll(@Req() req: any, @Query('status') status?: string) {
    const { id: userId, role } = req.user;
    const filters: any = { status };
    if (role === 'student') {
      filters.studentUserId = userId;
    } else if (role === 'agency') {
      filters.submittedByUserId = userId;
    }
    return this.transcriptsService.findAll(filters);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const transcript = await this.transcriptsService.findById(id);
    const { id: userId, role } = req.user;
    if (role === 'student' && transcript.StudentEmail !== req.user.email) {
      throw new ForbiddenException();
    }
    return transcript;
  }

  @Post()
  create(@Body() dto: CreateTranscriptDto, @Req() req: any) {
    const { role } = req.user;
    if (role === 'student') {
      dto.studentUserId = req.user.id;
    } else if (role === 'agency' && !dto.studentUserId) {
      throw new ForbiddenException('Agency must specify studentUserId');
    }
    return this.transcriptsService.create(dto, req.user.id);
  }

  @Post(':id/courses')
  addCourse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddTranscriptCourseDto,
  ) {
    return this.transcriptsService.addCourse(id, dto);
  }

  @Patch(':id/courses/:courseId')
  @UseGuards(RolesGuard)
  @Roles('faculty', 'admin', 'super_admin')
  updateCourseStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() body: { lane: string; notes?: string },
    @Req() req: any,
  ) {
    return this.transcriptsService.updateCourseStatus(id, courseId, body.lane, req.user.id, body.notes);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('faculty', 'admin', 'super_admin')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string },
    @Req() req: any,
  ) {
    return this.transcriptsService.updateStatus(id, body.status, req.user.id);
  }
}
