import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { PERMISSION_KEY, RequiredPermission } from './permission.decorator';
import { RolePermissionsCacheService } from './role-permissions-cache.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsCache: RolePermissionsCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<RequiredPermission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Neither decorator present -> no restriction.
    if (!requiredPermission && (!requiredRoles || requiredRoles.length === 0)) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Not authenticated');

    // @Permission() is the DB-driven check (Roles & Permissions matrix) and
    // REPLACES the static @Roles() array for this endpoint when present, so
    // a super_admin toggling a grant off actually restricts that role too.
    if (requiredPermission) {
      const allowed = await this.permissionsCache.isAllowed(
        user.role,
        requiredPermission.moduleKey,
        requiredPermission.operationKey,
      );
      if (!allowed) {
        throw new ForbiddenException(
          `Role '${user.role}' is not permitted to '${requiredPermission.operationKey}' on '${requiredPermission.moduleKey}'`,
        );
      }
      return true;
    }

    if (!requiredRoles!.includes(user.role)) {
      throw new ForbiddenException(`Role '${user.role}' is not permitted for this action`);
    }
    return true;
  }
}
