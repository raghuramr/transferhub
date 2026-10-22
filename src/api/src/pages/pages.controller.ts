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

@Controller('pages')
@UseGuards(JwtAuthGuard)
export class PagesController {
  constructor(private pagesService: PagesService) {}

  /** Full list — any signed-in role may read (admin screens filter client-side by edit rights). */
  @Get()
  findAll() {
    return this.pagesService.findAll();
  }

  /** Pages to surface in the sidebar nav. */
  @Get('nav')
  findNavPages() {
    return this.pagesService.findNavPages();
  }

  /** Public (published-only) lookup by slug — used by the block renderer and dashboard banner. */
  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.pagesService.findPublishedBySlug(slug);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.pagesService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  create(@Body() dto: UpsertPageDto, @Req() req: any) {
    return this.pagesService.create(dto, req.user.id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertPageDto, @Req() req: any) {
    return this.pagesService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.pagesService.remove(id);
  }
}
