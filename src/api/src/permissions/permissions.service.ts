import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';

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
  constructor(private db: DatabaseService) {}

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
    return { updated: updates.length };
  }
}
