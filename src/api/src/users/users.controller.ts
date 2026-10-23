import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Req, Res, UseGuards, UseInterceptors,
  UploadedFile, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles('admin', 'super_admin')
  findAll(@Query('role') role?: string, @Query('isActive') isActive?: string) {
    return this.usersService.findAll({
      role,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('export')
  @Roles('admin', 'super_admin')
  async exportCsv(@Res() res: Response) {
    const csv = await this.usersService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(csv);
  }

  @Post('import')
  @Roles('super_admin')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: any, @Req() req: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.usersService.importCsv(file.buffer.toString('utf-8'), req.user.id);
  }

  @Get(':id')
  @Roles('admin', 'super_admin')
  async findOne(@Param('id') id: string, @Req() req: any) {
    // Allow users to view their own profile
    if (req.user.id !== id && !['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.usersService.findById(id);
  }

  @Post()
  @Roles('super_admin')
  create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersService.create(dto, req.user.id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) {
    // Self or admin/super_admin
    if (req.user.id !== id && !['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    // Non-admins cannot set isActive
    if (dto.isActive !== undefined && !['admin', 'super_admin'].includes(req.user.role)) {
      delete dto.isActive;
    }
    return this.usersService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('super_admin')
  deactivate(@Param('id') id: string, @Req() req: any) {
    return this.usersService.deactivate(id, req.user.id);
  }

  @Post(':id/unlock')
  @Roles('admin', 'super_admin')
  unlock(@Param('id') id: string, @Req() req: any) {
    return this.usersService.unlock(id, req.user.id);
  }

  @Get(':id/scope')
  getScope(@Param('id') id: string, @Req() req: any) {
    // Self, or admin/super_admin viewing anyone — scope is read by every
    // role's own forms now (cascading master-data pre-population), not
    // just the admin scope-editor screen, so it can't stay admin-only.
    if (req.user.id !== id && !['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.usersService.getScopeFor(id);
  }

  @Put(':id/scope')
  @Roles('admin', 'super_admin')
  setScope(
    @Param('id') id: string,
    @Body() body: { universityIds?: number[]; academicUnitIds?: number[]; agencyIds?: number[] },
  ) {
    return this.usersService.setScopeFor(id, {
      universityIds: body.universityIds ?? [],
      academicUnitIds: body.academicUnitIds ?? [],
      agencyIds: body.agencyIds ?? [],
    });
  }
}
