import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

export interface RequiredPermission {
  moduleKey: string;
  operationKey: string;
}

/**
 * Marks an endpoint as governed by the Roles & Permissions matrix
 * (`RolePermissions` table, super_admin-editable at
 * /superadmin/settings/roles-permissions) instead of only the static
 * @Roles() array. When present, RolesGuard checks the DB-driven grant for
 * the caller's role and REPLACES the @Roles() check for that endpoint —
 * so toggling a grant off in the matrix actually blocks the action.
 *
 * moduleKey/operationKey must match a (PermissionModules.Key,
 * PermissionOperations.Key) pair seeded in database/seed/008_roles_permissions.sql.
 */
export const Permission = (moduleKey: string, operationKey: string) =>
  SetMetadata(PERMISSION_KEY, { moduleKey, operationKey } satisfies RequiredPermission);
