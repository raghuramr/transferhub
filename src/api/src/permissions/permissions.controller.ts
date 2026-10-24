import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { SaveMatrixDto } from './dto/save-matrix.dto';
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
    return this.permissionsService.findMyPermissions(req.user.role);
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
