import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { SaveMatrixDto } from './dto/save-matrix.dto';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';

// Roles & Permissions master data (which Role may perform which Operation
// on which Module). The matrix screens (modules/operations/matrix) are
// super_admin-only configuration; RolesGuard's @Permission() checks consult
// the resulting RolePermissions grants at runtime everywhere else in the
// app (see CLAUDE.md).
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class PermissionsController {
  constructor(private permissionsService: PermissionsService) {}

  /**
   * The calling user's own effective grants — intentionally open to every
   * authenticated role (not just super_admin) so any page can gate its
   * import/export/bulk-action controls by the live matrix.
   */
  @Get('my')
  @Roles('student', 'faculty', 'admin', 'agency', 'super_admin')
  findMyPermissions(@Req() req: AuthenticatedRequest) {
    return this.permissionsService.findMyPermissions(req.user.roleKey ?? req.user.role);
  }

  /** Roles that can be assigned to a user (custom roles included). Plain admins do not get super_admin. */
  @Get('assignable-roles')
  @Roles('admin', 'super_admin')
  assignableRoles(@Req() req: AuthenticatedRequest) {
    return this.permissionsService.assignableRoles(req.user.role === 'super_admin');
  }

  @Get('roles')
  listRoles() {
    return this.permissionsService.listRoles();
  }

  @Post('roles')
  createRole(@Body() dto: CreateRoleDto, @Req() req: AuthenticatedRequest) {
    return this.permissionsService.createRole(dto, req.user);
  }

  @Patch('roles/:id')
  updateRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return this.permissionsService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  deleteRole(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    return this.permissionsService.deleteRole(id, req.user);
  }

  @Get('modules')
  findModules() {
    return this.permissionsService.findModules();
  }

  @Get('operations')
  findOperations() {
    return this.permissionsService.findOperations();
  }

  @Get('matrix')
  findMatrix() {
    return this.permissionsService.findMatrix();
  }

  @Put('matrix')
  saveMatrix(@Body() dto: SaveMatrixDto) {
    return this.permissionsService.saveMatrix(dto.entries);
  }
}
