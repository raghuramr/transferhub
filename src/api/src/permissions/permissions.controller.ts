import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { SaveMatrixDto } from './dto/save-matrix.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// Roles & Permissions master data (which Role may perform which Operation
// on which Module). This is a configuration/master-data layer only — it is
// not yet consulted by the existing @Roles()/RolesGuard checks elsewhere
// in the app (see CLAUDE.md). Only super_admin may view or change it.
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class PermissionsController {
  constructor(private permissionsService: PermissionsService) {}

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
