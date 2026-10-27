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
import { Permission } from '../auth/permission.decorator';
import { ScopeService } from '../policy/scope.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import type { UploadedFileLike } from '../common/uploaded-file.interface';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private scope: ScopeService,
  ) {}

  /** Only super admins can hand out the super_admin role. */
  private assertCanAssignRole(req: AuthenticatedRequest, role?: string) {
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      throw new ForbiddenException('Only a super admin can assign the super admin role.');
    }
  }

  /** Admins assigned to universities may only manage students of those universities. */
  private async assertInScope(req: AuthenticatedRequest, targetId: string) {
    if (req.user.id === targetId) return;
    if (!(await this.scope.canManageUser(req.user, targetId))) {
      throw new ForbiddenException('This user belongs to a university outside your assignment.');
    }
  }

  @Get()
  @Permission('users', 'view')
  findAll(@Req() req: AuthenticatedRequest, @Query('role') role?: string, @Query('isActive') isActive?: string) {
    return this.usersService.findAll(
      {
        role,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
      },
      req.user,
    );
  }

  @Get('export')
  @Permission('users', 'export')
  async exportCsv(@Res() res: Response) {
    const csv = await this.usersService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(csv);
  }

  @Post('import')
  @Permission('users', 'import')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: UploadedFileLike, @Req() req: AuthenticatedRequest) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.usersService.importCsv(file.buffer.toString('utf-8'), req.user.id, req.user.role);
  }

  // No @Roles here on purpose: any signed-in user may open their OWN profile (checked below).
  // A class-level/route @Roles('admin','super_admin') made RolesGuard 403 students, so the profile page got nothing.
  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    // Allow users to view their own profile
    if (req.user.id !== id && !['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    await this.assertInScope(req, id);
    return this.usersService.findById(id);
  }

  @Post()
  @Permission('users', 'create')
  create(@Body() dto: CreateUserDto, @Req() req: AuthenticatedRequest) {
    this.assertCanAssignRole(req, dto.role);
    return this.usersService.create(dto, req.user.id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
    // Self or admin/super_admin
    if (req.user.id !== id && !['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    if (req.user.id !== id) await this.assertInScope(req, id);
    if (dto.role !== undefined) this.assertCanAssignRole(req, dto.role);
    if (req.user.id === id && dto.email !== undefined) {
      // Changing your own sign-in email needs a click on the link we send to the new address.
      const current = await this.usersService.findById(id);
      if (dto.email.trim().toLowerCase() !== current.email.toLowerCase()) {
        throw new ForbiddenException('Use "Change email" on your profile - we send a confirmation link to the new address.');
      }
      delete dto.email;
    }
    // Non-admins cannot set isActive
    if (dto.isActive !== undefined && !['admin', 'super_admin'].includes(req.user.role)) {
      delete dto.isActive;
    }
    return this.usersService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @Permission('users', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.assertInScope(req, id);
    return this.usersService.deactivate(id, req.user.id);
  }

  @Post(':id/unlock')
  @Roles('admin', 'super_admin')
  async unlock(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.assertInScope(req, id);
    return this.usersService.unlock(id, req.user.id);
  }

  @Get(':id/scope')
  getScope(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
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
