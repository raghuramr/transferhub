import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PagesService } from './pages.service';
import { UpsertPageDto } from './dto/upsert-page.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permission } from '../auth/permission.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

@Controller('pages')
export class PagesController {
  constructor(private pagesService: PagesService) {}

  /** Full list — any signed-in role may read (admin screens filter client-side by edit rights). */
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.pagesService.findAll();
  }

  /** Pages to surface in the sidebar nav (signed-in users only). */
  @Get('nav')
  @UseGuards(JwtAuthGuard)
  findNavPages() {
    return this.pagesService.findNavPages();
  }

  /**
   * Public (published-only) lookup by slug — no auth required. Used by the
   * block renderer, the dashboard announcements banner, AND the public
   * landing page (slug "home") that anonymous visitors see before login.
   */
  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.pagesService.findPublishedBySlug(slug);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.pagesService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permission('pages', 'create')
  create(@Body() dto: UpsertPageDto, @Req() req: AuthenticatedRequest) {
    return this.pagesService.create(dto, req.user.id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permission('pages', 'edit')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertPageDto, @Req() req: AuthenticatedRequest) {
    return this.pagesService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permission('pages', 'delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.pagesService.remove(id);
  }
}
