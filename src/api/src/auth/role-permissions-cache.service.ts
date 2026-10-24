import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface GrantRow {
  RoleName: string;
  ModuleKey: string;
  OperationKey: string;
}

const TTL_MS = 30_000;

/**
 * In-memory cache of the RolePermissions grants (roleName, moduleKey,
 * operationKey) -> allowed, backing RolesGuard's DB-driven @Permission()
 * checks. Refetched at most every TTL_MS, and force-invalidated whenever
 * PermissionsService.saveMatrix() writes a change, so a toggle in the
 * Roles & Permissions screen takes effect on the very next request.
 */
@Injectable()
export class RolePermissionsCacheService {
  private grants: Set<string> | null = null;
  private loadedAt = 0;
  private loading: Promise<Set<string>> | null = null;

  constructor(private db: DatabaseService) {}

  invalidate() {
    this.grants = null;
    this.loadedAt = 0;
  }

  private async load(): Promise<Set<string>> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const res = await this.db.query<GrantRow>(
        `SELECT r.Name AS RoleName, m.[Key] AS ModuleKey, o.[Key] AS OperationKey
         FROM RolePermissions rp
         JOIN Roles r ON r.Id = rp.RoleId
         JOIN PermissionModules m ON m.Id = rp.ModuleId
         JOIN PermissionOperations o ON o.Id = rp.OperationId
         WHERE rp.IsAllowed = 1`,
      );
      const set = new Set(res.recordset.map((g) => `${g.RoleName}:${g.ModuleKey}:${g.OperationKey}`));
      this.grants = set;
      this.loadedAt = Date.now();
      return set;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async isAllowed(roleName: string, moduleKey: string, operationKey: string): Promise<boolean> {
    const stale = !this.grants || Date.now() - this.loadedAt > TTL_MS;
    const grants = stale ? await this.load() : this.grants!;
    return grants.has(`${roleName}:${moduleKey}:${operationKey}`);
  }
}
