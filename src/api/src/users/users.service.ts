import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import * as argon2 from 'argon2';
import * as sql from 'mssql';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export interface UserScope {
  universityIds: number[];
  academicUnitIds: number[];
  agencyIds: number[];
}

function mapUser(row: any) {
  return {
    id: row.Id,
    email: row.Email,
    firstName: row.FirstName,
    lastName: row.LastName,
    studentId: row.StudentId,
    agencyName: row.AgencyName,
    isActive: !!row.IsActive,
    isLocked: !!row.IsLocked,
    lastLoginAt: row.LastLoginAt,
    mustChangePass: row.MustChangePass === undefined ? undefined : !!row.MustChangePass,
    departmentId: row.DepartmentId,
    role: row.Role,
    roleDisplay: row.RoleDisplay,
    departmentName: row.DepartmentName,
    departmentCode: row.DepartmentCode,
  };
}

@Injectable()
export class UsersService {
  constructor(private db: DatabaseService, private emailService: EmailService) {}

  async findById(id: string) {
    const res = await this.db.query<any>(
      `SELECT u.Id, u.Email, u.FirstName, u.LastName, u.StudentId, u.AgencyName,
              u.IsActive, u.IsLocked, u.LastLoginAt, u.MustChangePass, u.DepartmentId,
              r.Name AS Role, r.DisplayName AS RoleDisplay,
              d.Name AS DepartmentName, d.Code AS DepartmentCode
       FROM Users u
       JOIN Roles r ON r.Id = u.RoleId
       LEFT JOIN Departments d ON d.Id = u.DepartmentId
       WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('User not found');
    return mapUser(res.recordset[0]);
  }

  async findByEmail(email: string) {
    const res = await this.db.query<any>(
      `SELECT u.Id, u.Email, u.PasswordHash, u.FirstName, u.LastName,
              u.IsActive, u.IsLocked, u.LockedUntil, u.FailedLogins, u.DepartmentId,
              r.Name AS Role
       FROM Users u JOIN Roles r ON r.Id = u.RoleId
       WHERE u.Email = @email`,
      [{ name: 'email', type: sql.NVarChar(254), value: email }],
    );
    // Raw row (PascalCase) — used internally by AuthService, which already
    // expects these exact column names. Do NOT camelCase this one.
    return res.recordset[0] || null;
  }

  async findAll(filters: { role?: string; isActive?: boolean } = {}) {
    let where = '1=1';
    const inputs: any[] = [];
    if (filters.role) {
      where += ' AND r.Name = @role';
      inputs.push({ name: 'role', type: sql.VarChar(20), value: filters.role });
    }
    if (filters.isActive !== undefined) {
      where += ' AND u.IsActive = @active';
      inputs.push({ name: 'active', type: sql.Bit, value: filters.isActive ? 1 : 0 });
    }

    const res = await this.db.query<any>(
      `SELECT u.Id, u.Email, u.FirstName, u.LastName, u.StudentId, u.AgencyName,
              u.IsActive, u.IsLocked, u.LastLoginAt, u.DepartmentId,
              r.Name AS Role, r.DisplayName AS RoleDisplay,
              d.Name AS DepartmentName
       FROM Users u
       JOIN Roles r ON r.Id = u.RoleId
       LEFT JOIN Departments d ON d.Id = u.DepartmentId
       WHERE ${where}
       ORDER BY u.LastLoginAt DESC`,
      inputs,
    );
    return res.recordset.map(mapUser);
  }

  async create(dto: CreateUserDto, createdBy: string) {
    // Check email uniqueness
    const existing = await this.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const hash = await argon2.hash(dto.password);

    const roleRes = await this.db.query<any>(
      `SELECT Id FROM Roles WHERE Name = @name`,
      [{ name: 'name', type: sql.VarChar(20), value: dto.role }],
    );
    const roleId = roleRes.recordset[0]?.Id;
    if (!roleId) throw new NotFoundException('Role not found');

    const res = await this.db.query<any>(
      `INSERT INTO Users (Email, PasswordHash, FirstName, LastName, RoleId, DepartmentId, StudentId, AgencyName, CreatedBy, MustChangePass)
       OUTPUT inserted.Id
       VALUES (@email, @hash, @first, @last, @roleId, @dept, @sid, @agency, @createdBy, 1)`,
      [
        { name: 'email', type: sql.NVarChar(254), value: dto.email },
        { name: 'hash', type: sql.NVarChar(255), value: hash },
        { name: 'first', type: sql.NVarChar(100), value: dto.firstName },
        { name: 'last', type: sql.NVarChar(100), value: dto.lastName },
        { name: 'roleId', type: sql.Int, value: roleId },
        { name: 'dept', type: sql.Int, value: dto.departmentId || null },
        { name: 'sid', type: sql.NVarChar(50), value: dto.studentId || null },
        { name: 'agency', type: sql.NVarChar(200), value: dto.agencyName || null },
        { name: 'createdBy', type: sql.UniqueIdentifier, value: createdBy },
      ],
    );

    const newId = res.recordset[0].Id;
    await this.audit(createdBy, 'USER_CREATED', 'User', newId, null, JSON.stringify({ email: dto.email, role: dto.role }));

    try {
      await this.emailService.send(
        dto.email,
        'Your account was created',
        `<p>Hi ${dto.firstName},</p>
         <p>An account was created for you on the BU Transfer Credit Evaluation portal.</p>
         <p><strong>Email:</strong> ${dto.email}<br/>
         <strong>Temporary password:</strong> ${dto.password}</p>
         <p>Please sign in and change your password as soon as possible.</p>`,
      );
    } catch {
      // Best-effort only — never fail user creation because email delivery failed.
    }

    return this.findById(newId);
  }

  async update(id: string, dto: UpdateUserDto, updatedBy: string) {
    const user = await this.findById(id);
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const inputs: any[] = [{ name: 'id', type: sql.UniqueIdentifier, value: id }];

    if (dto.firstName !== undefined) {
      sets.push('FirstName = @first');
      inputs.push({ name: 'first', type: sql.NVarChar(100), value: dto.firstName });
    }
    if (dto.lastName !== undefined) {
      sets.push('LastName = @last');
      inputs.push({ name: 'last', type: sql.NVarChar(100), value: dto.lastName });
    }
    if (dto.password !== undefined) {
      const hash = await argon2.hash(dto.password);
      sets.push('PasswordHash = @hash, MustChangePass = 0');
      inputs.push({ name: 'hash', type: sql.NVarChar(255), value: hash });
    }
    if (dto.isActive !== undefined) {
      sets.push('IsActive = @active');
      inputs.push({ name: 'active', type: sql.Bit, value: dto.isActive ? 1 : 0 });
    }

    await this.db.query(
      `UPDATE Users SET ${sets.join(', ')} WHERE Id = @id`,
      inputs,
    );

    await this.audit(updatedBy, 'USER_UPDATED', 'User', id, JSON.stringify(user), JSON.stringify(dto));
    return this.findById(id);
  }

  async deactivate(id: string, by: string) {
    await this.findById(id);
    await this.db.query(
      `UPDATE Users SET IsActive = 0, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    await this.audit(by, 'USER_DEACTIVATED', 'User', id, null, null);
    return { message: 'User deactivated' };
  }

  async unlock(id: string, by: string) {
    await this.findById(id);
    await this.db.query(
      `UPDATE Users SET IsLocked = 0, FailedLogins = 0, LockedUntil = NULL, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    await this.audit(by, 'USER_UNLOCKED', 'User', id, null, null);
    return { message: 'User unlocked' };
  }

  /**
   * No rows in any of the three scope tables for a user = unrestricted
   * (sees everything). This must remain the default behaviour.
   */
  async getScopeFor(userId: string): Promise<UserScope> {
    await this.findById(userId);

    const [uniRes, auRes, agRes] = await Promise.all([
      this.db.query<any>(
        `SELECT InstitutionId FROM UserScopeUniversities WHERE UserId = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
      ),
      this.db.query<any>(
        `SELECT AcademicUnitId FROM UserScopeAcademicUnits WHERE UserId = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
      ),
      this.db.query<any>(
        `SELECT AgencyId FROM UserScopeAgencies WHERE UserId = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
      ),
    ]);

    return {
      universityIds: uniRes.recordset.map((r: any) => r.InstitutionId),
      academicUnitIds: auRes.recordset.map((r: any) => r.AcademicUnitId),
      agencyIds: agRes.recordset.map((r: any) => r.AgencyId),
    };
  }

  /** Replaces the rows in the three scope join tables for a user. */
  async setScopeFor(userId: string, scope: UserScope): Promise<UserScope> {
    await this.findById(userId);

    const idInput = { name: 'id', type: sql.UniqueIdentifier, value: userId };

    // No transaction helper is exposed on DatabaseService — run the
    // delete-then-insert sequence sequentially against the single pool.
    await this.db.query(`DELETE FROM UserScopeUniversities WHERE UserId = @id`, [idInput]);
    await this.db.query(`DELETE FROM UserScopeAcademicUnits WHERE UserId = @id`, [idInput]);
    await this.db.query(`DELETE FROM UserScopeAgencies WHERE UserId = @id`, [idInput]);

    for (const instId of scope.universityIds ?? []) {
      await this.db.query(
        `INSERT INTO UserScopeUniversities (UserId, InstitutionId) VALUES (@id, @val)`,
        [idInput, { name: 'val', type: sql.Int, value: instId }],
      );
    }
    for (const auId of scope.academicUnitIds ?? []) {
      await this.db.query(
        `INSERT INTO UserScopeAcademicUnits (UserId, AcademicUnitId) VALUES (@id, @val)`,
        [idInput, { name: 'val', type: sql.Int, value: auId }],
      );
    }
    for (const agId of scope.agencyIds ?? []) {
      await this.db.query(
        `INSERT INTO UserScopeAgencies (UserId, AgencyId) VALUES (@id, @val)`,
        [idInput, { name: 'val', type: sql.Int, value: agId }],
      );
    }

    await this.audit(userId, 'USER_SCOPE_UPDATED', 'User', userId, null, JSON.stringify(scope));
    return this.getScopeFor(userId);
  }

  private async audit(userId: string, action: string, entityType: string, entityId: string, oldVal: string | null, newVal: string | null) {
    await this.db.query(
      `INSERT INTO AuditLog (UserId, Action, EntityType, EntityId, OldValue, NewValue) VALUES (@uid, @action, @etype, @eid, @old, @new)`,
      [
        { name: 'uid', type: sql.UniqueIdentifier, value: userId },
        { name: 'action', type: sql.NVarChar(200), value: action },
        { name: 'etype', type: sql.NVarChar(100), value: entityType },
        { name: 'eid', type: sql.NVarChar(100), value: entityId },
        { name: 'old', type: sql.NVarChar(sql.MAX), value: oldVal },
        { name: 'new', type: sql.NVarChar(sql.MAX), value: newVal },
      ],
    ).catch(() => {});
  }
}
