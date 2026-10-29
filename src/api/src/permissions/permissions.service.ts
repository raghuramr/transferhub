import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { RolePermissionsCacheService } from '../auth/role-permissions-cache.service';
import { SchemaService } from '../policy/schema.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

interface ModuleRow {
  Id: number;
  Key: string;
  Label: string;
  SortOrder: number;
}

interface OperationRow {
  Id: number;
  Key: string;
  Label: string;
  SortOrder: number;
}

interface RoleRow {
  Id: number;
  Name: string;
  DisplayName: string;
}

interface GrantRow {
  RoleId: number;
  ModuleId: number;
  OperationId: number;
  IsAllowed: boolean;
}

function mapModule(row: ModuleRow) {
  return { id: row.Id, key: row.Key, label: row.Label, sortOrder: row.SortOrder };
}

function mapOperation(row: OperationRow) {
  return { id: row.Id, key: row.Key, label: row.Label, sortOrder: row.SortOrder };
}

export interface MatrixEntry {
  roleId: number;
  roleName: string;
  moduleId: number;
  moduleKey: string;
  operationId: number;
  operationKey: string;
  isAllowed: boolean;
}

export interface MatrixUpsert {
  roleId: number;
  moduleId: number;
  operationId: number;
  isAllowed: boolean;
}

@Injectable()
export class PermissionsService {
  constructor(
    private db: DatabaseService,
    private permissionsCache: RolePermissionsCacheService,
    private schema: SchemaService,
  ) {}

  async findModules() {
    const res = await this.db.query<ModuleRow>(
      `SELECT Id, [Key], Label, SortOrder FROM PermissionModules ORDER BY SortOrder, Label`,
    );
    return res.recordset.map(mapModule);
  }

  async findOperations() {
    const res = await this.db.query<OperationRow>(
      `SELECT Id, [Key], Label, SortOrder FROM PermissionOperations ORDER BY SortOrder, Label`,
    );
    return res.recordset.map(mapOperation);
  }

  /**
   * Returns the full Role x Module x Operation grid: every (role, module,
   * operation) combination, with isAllowed true where a RolePermissions
   * row exists and is allowed, false otherwise (absence = not allowed).
   */
  async findMatrix(): Promise<{
    roles: { id: number; name: string; displayName: string }[];
    modules: { id: number; key: string; label: string; sortOrder: number }[];
    operations: { id: number; key: string; label: string; sortOrder: number }[];
    entries: MatrixEntry[];
  }> {
    const [rolesRes, modules, operations, grantsRes] = await Promise.all([
      this.db.query<RoleRow>(`SELECT Id, Name, DisplayName FROM Roles ORDER BY Id`),
      this.findModules(),
      this.findOperations(),
      this.db.query<GrantRow>(
        `SELECT RoleId, ModuleId, OperationId, IsAllowed FROM RolePermissions WHERE IsAllowed = 1`,
      ),
    ]);

    const roles = rolesRes.recordset.map((r) => ({ id: r.Id, name: r.Name, displayName: r.DisplayName }));
    const granted = new Set(
      grantsRes.recordset.map((g) => `${g.RoleId}:${g.ModuleId}:${g.OperationId}`),
    );

    const entries: MatrixEntry[] = [];
    for (const role of roles) {
      for (const mod of modules) {
        for (const op of operations) {
          entries.push({
            roleId: role.id,
            roleName: role.name,
            moduleId: mod.id,
            moduleKey: mod.key,
            operationId: op.id,
            operationKey: op.key,
            isAllowed: granted.has(`${role.id}:${mod.id}:${op.id}`),
          });
        }
      }
    }

    return { roles, modules, operations, entries };
  }

  /**
   * The calling user's own effective grants, as a nested
   * { [moduleKey]: { [operationKey]: boolean } } map — used by the UI to
   * show/hide import/export/bulk-action controls per the live matrix,
   * instead of a hardcoded role check. Mirrors what RolesGuard's
   * @Permission() checks enforce server-side (see role-permissions-cache.service.ts).
   */
  async findMyPermissions(roleName: string) {
    const res = await this.db.query<{ ModuleKey: string; OperationKey: string }>(
      `SELECT m.[Key] AS ModuleKey, o.[Key] AS OperationKey
       FROM RolePermissions rp
       JOIN Roles r ON r.Id = rp.RoleId
       JOIN PermissionModules m ON m.Id = rp.ModuleId
       JOIN PermissionOperations o ON o.Id = rp.OperationId
       WHERE rp.IsAllowed = 1 AND r.Name = @roleName`,
      [{ name: 'roleName', type: sql.VarChar(20), value: roleName }],
    );
    const grants: Record<string, Record<string, boolean>> = {};
    for (const row of res.recordset) {
      grants[row.ModuleKey] ??= {};
      grants[row.ModuleKey][row.OperationKey] = true;
    }
    return grants;
  }

  /** Bulk upsert — applies each {roleId, moduleId, operationId, isAllowed}. */
  async saveMatrix(updates: MatrixUpsert[]) {
    for (const u of updates) {
      await this.db.query(
        `MERGE RolePermissions AS target
         USING (SELECT @roleId AS RoleId, @moduleId AS ModuleId, @operationId AS OperationId) AS source
         ON target.RoleId = source.RoleId AND target.ModuleId = source.ModuleId AND target.OperationId = source.OperationId
         WHEN MATCHED THEN UPDATE SET IsAllowed = @isAllowed
         WHEN NOT MATCHED THEN INSERT (RoleId, ModuleId, OperationId, IsAllowed)
           VALUES (@roleId, @moduleId, @operationId, @isAllowed);`,
        [
          { name: 'roleId', type: sql.Int, value: u.roleId },
          { name: 'moduleId', type: sql.Int, value: u.moduleId },
          { name: 'operationId', type: sql.Int, value: u.operationId },
          { name: 'isAllowed', type: sql.Bit, value: u.isAllowed ? 1 : 0 },
        ],
      );
    }
    this.permissionsCache.invalidate();
    return { updated: updates.length };
  }

  // ── custom roles (migration 032) ───────────────────────────

  private async ready(): Promise<void> {
    if (!(await this.schema.has('Roles', 'BaseRole'))) throw new BadRequestException('Custom roles are not available yet (migration 032 has not been applied).');
  }

  /** Every role with its type, base role and how many users hold it. Works before migration 032 (all built-in). */
  async listRoles() {
    const ext = await this.schema.has('Roles', 'BaseRole');
    const r = await this.db.query<{ Id: number; Name: string; DisplayName: string; Description: string | null; BaseRole: string | null; IsSystem: boolean; IsActive: boolean; Users: number }>(
      `SELECT r.Id, r.Name, r.DisplayName, r.Description,
              ${ext ? 'r.BaseRole, r.IsSystem, r.IsActive' : "CAST(NULL AS VARCHAR(20)) AS BaseRole, CAST(1 AS BIT) AS IsSystem, CAST(1 AS BIT) AS IsActive"},
              (SELECT COUNT(*) FROM Users u WHERE u.RoleId = r.Id) AS Users
       FROM Roles r ORDER BY r.Id`,
    );
    return r.recordset.map((x) => ({
      id: x.Id, name: x.Name, displayName: x.DisplayName, description: x.Description, baseRole: x.BaseRole ?? (x.Name === 'super_admin' ? null : x.Name),
      isSystem: !!x.IsSystem, isActive: !!x.IsActive, users: Number(x.Users),
    }));
  }

  async assignableRoles(includeSuperAdmin: boolean) {
    const all = await this.listRoles();
    return all.filter((r) => r.isActive && (includeSuperAdmin || r.name !== 'super_admin')).map((r) => ({ name: r.name, displayName: r.displayName, baseRole: r.baseRole, isSystem: r.isSystem }));
  }

  async createRole(dto: CreateRoleDto, by: { id: string; email: string; role: string }) {
    await this.ready();
    if (['student', 'faculty', 'admin', 'agency', 'super_admin'].includes(dto.name)) throw new ConflictException('That key is reserved for a built-in role.');
    const dup = await this.db.query(`SELECT 1 AS x FROM Roles WHERE Name = @n`, [{ name: 'n', type: sql.VarChar(20), value: dto.name }]);
    if (dup.recordset.length) throw new ConflictException('A role with that key already exists.');
    const created = await this.db.query<{ Id: number }>(
      `INSERT INTO Roles (Name, DisplayName, Description, BaseRole, IsSystem, IsActive) OUTPUT inserted.Id VALUES (@n, @d, @desc, @b, 0, 1)`,
      [
        { name: 'n', type: sql.VarChar(20), value: dto.name },
        { name: 'd', type: sql.NVarChar(100), value: dto.displayName },
        { name: 'desc', type: sql.NVarChar(500), value: dto.description ?? null },
        { name: 'b', type: sql.VarChar(20), value: dto.baseRole },
      ],
    );
    const id = created.recordset[0].Id;
    // Start from the grants of the chosen role (default: the base role) so the new role works straight away; the matrix then adjusts it.
    const src = dto.copyFromRoleId
      ? dto.copyFromRoleId
      : (await this.db.query<{ Id: number }>(`SELECT Id FROM Roles WHERE Name = @b`, [{ name: 'b', type: sql.VarChar(20), value: dto.baseRole }])).recordset[0]?.Id;
    if (src) {
      await this.db.query(
        `INSERT INTO RolePermissions (RoleId, ModuleId, OperationId, IsAllowed)
         SELECT @new, ModuleId, OperationId, IsAllowed FROM RolePermissions WHERE RoleId = @src`,
        [{ name: 'new', type: sql.Int, value: id }, { name: 'src', type: sql.Int, value: src }],
      );
    }
    this.permissionsCache.invalidate();
    await this.auditRole(by, 'ROLE_CREATED', id, { name: dto.name, baseRole: dto.baseRole });
    return (await this.listRoles()).find((r) => r.id === id);
  }

  async updateRole(id: number, dto: UpdateRoleDto) {
    await this.ready();
    const cur = await this.db.query<{ IsSystem: boolean }>(`SELECT IsSystem FROM Roles WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    if (!cur.recordset[0]) throw new NotFoundException('Role not found');
    if (cur.recordset[0].IsSystem && dto.isActive === false) throw new BadRequestException('Built-in roles cannot be deactivated.');
    const sets: string[] = [];
    const inputs: { name: string; type: sql.ISqlTypeFactoryWithNoParams | sql.ISqlType; value: unknown }[] = [{ name: 'id', type: sql.Int, value: id }];
    if (dto.displayName !== undefined) { sets.push('DisplayName = @d'); inputs.push({ name: 'd', type: sql.NVarChar(100), value: dto.displayName }); }
    if (dto.description !== undefined) { sets.push('Description = @desc'); inputs.push({ name: 'desc', type: sql.NVarChar(500), value: dto.description }); }
    if (dto.isActive !== undefined) { sets.push('IsActive = @a'); inputs.push({ name: 'a', type: sql.Bit, value: dto.isActive ? 1 : 0 }); }
    if (sets.length) await this.db.query(`UPDATE Roles SET ${sets.join(', ')} WHERE Id = @id`, inputs as never);
    return (await this.listRoles()).find((r) => r.id === id);
  }

  async deleteRole(id: number, by: { id: string; email: string; role: string }) {
    await this.ready();
    const r = (await this.listRoles()).find((x) => x.id === id);
    if (!r) throw new NotFoundException('Role not found');
    if (r.isSystem) throw new BadRequestException('Built-in roles cannot be deleted.');
    if (r.users) throw new ConflictException(`${r.users} user(s) still have this role. Move them to another role first.`);
    await this.db.query(`DELETE FROM Roles WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]); // RolePermissions cascade
    this.permissionsCache.invalidate();
    await this.auditRole(by, 'ROLE_DELETED', id, { name: r.name });
    return { ok: true };
  }

  private async auditRole(by: { id: string; email: string; role: string }, action: string, id: number, detail: unknown) {
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, NewValue) VALUES (@u, @e, @r, @a, 'Role', @id, @n)`,
        [
          { name: 'u', type: sql.UniqueIdentifier, value: by.id }, { name: 'e', type: sql.NVarChar(254), value: by.email },
          { name: 'r', type: sql.VarChar(20), value: by.role }, { name: 'a', type: sql.VarChar(50), value: action },
          { name: 'id', type: sql.NVarChar(100), value: String(id) }, { name: 'n', type: sql.NVarChar(sql.MAX), value: JSON.stringify(detail) },
        ],
      );
    } catch { /* auditing never blocks */ }
  }
}
