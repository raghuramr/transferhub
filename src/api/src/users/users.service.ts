import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DatabaseService, QueryInput } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import * as argon2 from 'argon2';
import * as sql from 'mssql';
import * as crypto from 'crypto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { parseCsvRows, toCsv } from '../common/csv.util';
import { ScopeService } from '../policy/scope.service';
import { SchemaService } from '../policy/schema.service';

const EXPORT_COLUMNS = ['id', 'email', 'firstName', 'lastName', 'role', 'studentId', 'agencyName', 'departmentCode', 'mobile', 'addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'country', 'countryOfOrigin', 'isActive'];

export interface UserScope {
  universityIds: number[];
  academicUnitIds: number[];
  agencyIds: number[];
}

interface UserRow {
  Id: string;
  Email: string;
  FirstName: string;
  LastName: string;
  StudentId: string | null;
  AgencyName: string | null;
  Mobile: string | null;
  AddressLine1: string | null;
  AddressLine2: string | null;
  City: string | null;
  State: string | null;
  PostalCode: string | null;
  Country: string | null;
  CountryOfOrigin: string | null;
  IsActive: boolean;
  IsLocked: boolean;
  LastLoginAt: Date | null;
  // Only selected by findById, not findAll — absent (undefined) on list rows.
  MustChangePass?: boolean;
  DepartmentId: number | null;
  Role: string;
  RoleDisplay: string;
  DepartmentName: string | null;
  // Only selected by findById.
  DepartmentCode?: string | null;
  // Only selected by findAll, for admin/faculty rows — the universities they are scoped to
  // (UserScopeUniversities), comma-joined; null/empty means unrestricted (sees every university).
  ScopedUniversities?: string | null;
  // Only selected by findById — StudentProfiles join.
  PriorInstitutionName?: string | null;
  HighestEducationLevel?: string | null;
  FieldOfStudy?: string | null;
  GPA?: number | null;
  GraduationYear?: number | null;
  EmergencyContactName?: string | null;
  EmergencyContactPhone?: string | null;
  TargetInstitutionId?: number | null;
  TargetProgramId?: number | null;
  TargetInstitutionName?: string | null;
  TargetProgramName?: string | null;
  // findById only, and only once migration 015 is applied (the application details captured at registration).
  ApplicantType?: string | null;
  AdmissionStatus?: string | null;
  EntryTerm?: string | null;
  EntryYear?: number | null;
  IntendedAcademicUnitName?: string | null;
  IsNativeEnglish?: boolean | null;
  EnglishTestType?: string | null;
  EnglishTestScore?: string | null;
  HasIntlCoursework?: boolean | null;
  HighSchoolName?: string | null;
  HighSchoolGradYear?: number | null;
  CreditsCompleted?: number | null;
  EmailVerified?: boolean | null;
  AvatarUploadId?: string | null;
}

/** Raw auth-lookup row (PascalCase) consumed directly by AuthService — do not camelCase. */
interface UserAuthLookupRow {
  Id: string;
  Email: string;
  PasswordHash: string | null;
  FirstName: string;
  LastName: string;
  IsActive: boolean;
  IsLocked: boolean;
  LockedUntil: Date | null;
  FailedLogins: number | null;
  DepartmentId: number | null;
  Role: string;
}

interface RoleIdRow {
  Id: number;
}

function mapUser(row: UserRow) {
  return {
    id: row.Id,
    email: row.Email,
    firstName: row.FirstName,
    lastName: row.LastName,
    studentId: row.StudentId,
    agencyName: row.AgencyName,
    mobile: row.Mobile,
    addressLine1: row.AddressLine1,
    addressLine2: row.AddressLine2,
    city: row.City,
    state: row.State,
    zipCode: row.PostalCode,
    country: row.Country,
    countryOfOrigin: row.CountryOfOrigin,
    isActive: !!row.IsActive,
    isLocked: !!row.IsLocked,
    lastLoginAt: row.LastLoginAt,
    mustChangePass: row.MustChangePass === undefined ? undefined : !!row.MustChangePass,
    departmentId: row.DepartmentId,
    role: row.Role,
    roleDisplay: row.RoleDisplay,
    departmentName: row.DepartmentName,
    departmentCode: row.DepartmentCode,
    scopedUniversities: row.ScopedUniversities ?? undefined,
    emailVerified: row.EmailVerified == null ? undefined : !!row.EmailVerified,
    hasAvatar: !!row.AvatarUploadId,
    priorInstitutionName: row.PriorInstitutionName ?? undefined,
    highestEducationLevel: row.HighestEducationLevel ?? undefined,
    fieldOfStudy: row.FieldOfStudy ?? undefined,
    gpa: row.GPA ?? undefined,
    graduationYear: row.GraduationYear ?? undefined,
    emergencyContactName: row.EmergencyContactName ?? undefined,
    emergencyContactPhone: row.EmergencyContactPhone ?? undefined,
    targetInstitutionId: row.TargetInstitutionId ?? undefined,
    targetProgramId: row.TargetProgramId ?? undefined,
    targetInstitutionName: row.TargetInstitutionName ?? undefined,
    targetProgramName: row.TargetProgramName ?? undefined,
    applicantType: row.ApplicantType ?? undefined,
    admissionStatus: row.AdmissionStatus ?? undefined,
    entryTerm: row.EntryTerm ?? undefined,
    entryYear: row.EntryYear ?? undefined,
    intendedAcademicUnitName: row.IntendedAcademicUnitName ?? undefined,
    isNativeEnglish: row.IsNativeEnglish == null ? undefined : !!row.IsNativeEnglish,
    englishTestType: row.EnglishTestType ?? undefined,
    englishTestScore: row.EnglishTestScore ?? undefined,
    hasIntlCoursework: row.HasIntlCoursework == null ? undefined : !!row.HasIntlCoursework,
    highSchoolName: row.HighSchoolName ?? undefined,
    highSchoolGradYear: row.HighSchoolGradYear ?? undefined,
    creditsCompleted: row.CreditsCompleted == null ? undefined : Number(row.CreditsCompleted),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private db: DatabaseService,
    private emailService: EmailService,
    private scope: ScopeService,
    private schema: SchemaService,
  ) {}

  /**
   * Links an agency user to an Agencies row. An explicit agencyId wins; otherwise a free-text agencyName that
   * matches an agency exactly is linked too (so the header branding resolves). Unknown ids are rejected.
   */
  private async resolveAgency(agencyId?: number | null, agencyName?: string | null): Promise<{ id: number | null; name: string | null }> {
    if (agencyId) {
      const r = await this.db.query<{ Id: number; Name: string }>(`SELECT Id, Name FROM Agencies WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: agencyId }]);
      if (!r.recordset[0]) throw new NotFoundException('Agency not found');
      return { id: r.recordset[0].Id, name: r.recordset[0].Name };
    }
    if (agencyName) {
      const r = await this.db.query<{ Id: number; Name: string }>(`SELECT Id, Name FROM Agencies WHERE Name = @n`, [{ name: 'n', type: sql.NVarChar(200), value: agencyName }]);
      if (r.recordset[0]) return { id: r.recordset[0].Id, name: r.recordset[0].Name };
    }
    return { id: null, name: agencyName ?? null };
  }

  async findById(id: string) {
    const extra = (await this.schema.has('Users', 'EmailVerified')) ? ', u.EmailVerified, u.AvatarUploadId' : '';
    // The application details live behind migration 015; read them only when the columns are there,
    // so a deploy that runs ahead of the migration still returns a profile instead of a 500.
    const application = (await this.schema.has('StudentProfiles', 'ApplicantType'))
      ? `, sp.ApplicantType, sp.AdmissionStatus, sp.EntryTerm, sp.EntryYear,
              sp.IsNativeEnglish, sp.EnglishTestType, sp.EnglishTestScore, sp.HasIntlCoursework,
              sp.HighSchoolName, sp.HighSchoolGradYear, sp.CreditsCompleted,
              au.Name AS IntendedAcademicUnitName`
      : '';
    const applicationJoin = application ? 'LEFT JOIN AcademicUnits au ON au.Id = sp.IntendedAcademicUnitId' : '';
    const res = await this.db.query<UserRow>(
      `SELECT u.Id, u.Email, u.FirstName, u.LastName, u.StudentId, u.AgencyName,
              u.Mobile, u.AddressLine1, u.AddressLine2, u.City, u.State, u.PostalCode,
              u.Country, u.CountryOfOrigin${extra},
              u.IsActive, u.IsLocked, u.LastLoginAt, u.MustChangePass, u.DepartmentId,
              r.Name AS Role, r.DisplayName AS RoleDisplay,
              d.Name AS DepartmentName, d.Code AS DepartmentCode,
              sp.PriorInstitutionName, sp.HighestEducationLevel, sp.FieldOfStudy,
              sp.GPA, sp.GraduationYear, sp.EmergencyContactName, sp.EmergencyContactPhone,
              sp.TargetInstitutionId, sp.TargetProgramId,
              ti.Name AS TargetInstitutionName,
              tp.Name AS TargetProgramName${application}
       FROM Users u
       JOIN Roles r ON r.Id = u.RoleId
       LEFT JOIN Departments d ON d.Id = u.DepartmentId
       LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id
       LEFT JOIN Institutions ti ON ti.Id = sp.TargetInstitutionId
       LEFT JOIN Programs tp ON tp.Id = sp.TargetProgramId
       ${applicationJoin}
       WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('User not found');
    return mapUser(res.recordset[0]);
  }

  async findByEmail(email: string) {
    const res = await this.db.query<UserAuthLookupRow>(
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

  async findAll(filters: { role?: string; isActive?: boolean } = {}, viewer?: { id: string; role: string }) {
    let where = '1=1';
    const inputs: QueryInput[] = [];
    if (filters.role) {
      where += ' AND r.Name = @role';
      inputs.push({ name: 'role', type: sql.VarChar(20), value: filters.role });
    }
    if (filters.isActive !== undefined) {
      where += ' AND u.IsActive = @active';
      inputs.push({ name: 'active', type: sql.Bit, value: filters.isActive ? 1 : 0 });
    }

    // Admins assigned to universities only see students registered/requesting for those universities.
    if (viewer?.role === 'admin') where += ` AND r.Name <> 'super_admin'`;
    const scope = viewer ? await this.scope.universityScope(viewer) : null;
    if (scope) where += ` AND (r.Name <> 'student' OR ${this.scope.studentInScope(scope, 'u', inputs)})`;

    const extra = (await this.schema.has('Users', 'EmailVerified')) ? ', u.EmailVerified, u.AvatarUploadId' : '';
    const res = await this.db.query<UserRow>(
      `SELECT u.Id, u.Email, u.FirstName, u.LastName, u.StudentId, u.AgencyName,
              u.Mobile, u.AddressLine1, u.AddressLine2, u.City, u.State, u.PostalCode,
              u.Country, u.CountryOfOrigin,
              u.IsActive, u.IsLocked, u.LastLoginAt, u.DepartmentId${extra},
              r.Name AS Role, r.DisplayName AS RoleDisplay,
              d.Name AS DepartmentName,
              sp.PriorInstitutionName, sp.HighestEducationLevel, sp.FieldOfStudy, sp.GPA, sp.GraduationYear,
              ti.Name AS TargetInstitutionName, tp.Name AS TargetProgramName,
              su.Names AS ScopedUniversities
       FROM Users u
       JOIN Roles r ON r.Id = u.RoleId
       LEFT JOIN Departments d ON d.Id = u.DepartmentId
       LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id
       LEFT JOIN Institutions ti ON ti.Id = sp.TargetInstitutionId
       LEFT JOIN Programs tp ON tp.Id = sp.TargetProgramId
       OUTER APPLY (
         SELECT STRING_AGG(i.Name, ', ') WITHIN GROUP (ORDER BY i.Name) AS Names
         FROM UserScopeUniversities us JOIN Institutions i ON i.Id = us.InstitutionId
         WHERE us.UserId = u.Id
       ) su
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

    const roleRes = await this.db.query<RoleIdRow>(
      `SELECT Id FROM Roles WHERE Name = @name`,
      [{ name: 'name', type: sql.VarChar(20), value: dto.role }],
    );
    const roleId = roleRes.recordset[0]?.Id;
    if (!roleId) throw new NotFoundException('Role not found');

    const agency = dto.role === 'agency' ? await this.resolveAgency(dto.agencyId, dto.agencyName) : { id: null, name: dto.agencyName ?? null };
    const res = await this.db.query<{ Id: string }>(
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
        { name: 'agency', type: sql.NVarChar(200), value: agency.name || null },
        { name: 'createdBy', type: sql.UniqueIdentifier, value: createdBy },
      ],
    );

    const newId = res.recordset[0].Id;
    if (agency.id) {
      await this.db.query(`UPDATE Users SET AgencyId = @aid WHERE Id = @id`, [
        { name: 'aid', type: sql.Int, value: agency.id },
        { name: 'id', type: sql.UniqueIdentifier, value: newId },
      ]);
    }
    await this.audit(createdBy, 'USER_CREATED', 'User', newId, null, JSON.stringify({ email: dto.email, role: dto.role }));

    try {
      await this.emailService.sendEmail(
        dto.email,
        templates.accountCreated(this.emailService.context, { firstName: dto.firstName, email: dto.email, password: dto.password, role: dto.role }),
      );
    } catch {
      // Best-effort only — never fail user creation because email delivery failed.
    }

    return this.findById(newId);
  }

  async update(id: string, dto: UpdateUserDto, updatedBy: string) {
    const user = await this.findById(id);
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const inputs: QueryInput[] = [{ name: 'id', type: sql.UniqueIdentifier, value: id }];

    if (dto.email !== undefined && dto.email !== user.email) {
      const existing = await this.findByEmail(dto.email);
      if (existing) throw new ConflictException('Email already in use');
      sets.push('Email = @email');
      inputs.push({ name: 'email', type: sql.NVarChar(254), value: dto.email });
    }
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
    if (dto.role !== undefined) {
      const roleRes = await this.db.query<RoleIdRow>(
        `SELECT Id FROM Roles WHERE Name = @name`,
        [{ name: 'name', type: sql.VarChar(20), value: dto.role }],
      );
      const roleId = roleRes.recordset[0]?.Id;
      if (!roleId) throw new NotFoundException('Role not found');
      sets.push('RoleId = @roleId');
      inputs.push({ name: 'roleId', type: sql.Int, value: roleId });
    }
    if (dto.departmentId !== undefined) {
      sets.push('DepartmentId = @dept');
      inputs.push({ name: 'dept', type: sql.Int, value: dto.departmentId });
    }
    if (dto.studentId !== undefined) {
      sets.push('StudentId = @sid');
      inputs.push({ name: 'sid', type: sql.NVarChar(50), value: dto.studentId });
    }
    if (dto.agencyName !== undefined || dto.agencyId !== undefined) {
      const agency = await this.resolveAgency(dto.agencyId, dto.agencyName);
      sets.push('AgencyName = @agency', 'AgencyId = @agencyId');
      inputs.push({ name: 'agency', type: sql.NVarChar(200), value: agency.name });
      inputs.push({ name: 'agencyId', type: sql.Int, value: agency.id });
    }
    if (dto.mobile !== undefined) {
      sets.push('Mobile = @mobile');
      inputs.push({ name: 'mobile', type: sql.NVarChar(30), value: dto.mobile });
    }
    if (dto.addressLine1 !== undefined) {
      sets.push('AddressLine1 = @addr1');
      inputs.push({ name: 'addr1', type: sql.NVarChar(200), value: dto.addressLine1 });
    }
    if (dto.addressLine2 !== undefined) {
      sets.push('AddressLine2 = @addr2');
      inputs.push({ name: 'addr2', type: sql.NVarChar(200), value: dto.addressLine2 });
    }
    if (dto.city !== undefined) {
      sets.push('City = @city');
      inputs.push({ name: 'city', type: sql.NVarChar(100), value: dto.city });
    }
    if (dto.state !== undefined) {
      sets.push('State = @state');
      inputs.push({ name: 'state', type: sql.NVarChar(100), value: dto.state });
    }
    if (dto.zipCode !== undefined) {
      sets.push('PostalCode = @postal');
      inputs.push({ name: 'postal', type: sql.NVarChar(20), value: dto.zipCode });
    }
    if (dto.country !== undefined) {
      sets.push('Country = @country');
      inputs.push({ name: 'country', type: sql.NVarChar(100), value: dto.country });
    }
    if (dto.countryOfOrigin !== undefined) {
      sets.push('CountryOfOrigin = @countryOrigin');
      inputs.push({ name: 'countryOrigin', type: sql.NVarChar(100), value: dto.countryOfOrigin });
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

  async exportCsv(): Promise<string> {
    const rows = await this.findAll();
    return toCsv(rows, EXPORT_COLUMNS);
  }

  /** Upserts by Email. New rows get a random temp password + "account created" email; existing rows are updated in place. */
  async importCsv(text: string, importedBy: string, actorRole?: string) {
    const rows = parseCsvRows(text);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const email = row.email || row.Email;
      const firstName = row.firstName || row.FirstName;
      const lastName = row.lastName || row.LastName;
      const role = (row.role || row.Role || '').toLowerCase();
      if (!email || !firstName || !lastName || !role) {
        errors.push(`Skipped row (missing email/firstName/lastName/role): ${JSON.stringify(row)}`);
        continue;
      }
      if (actorRole === 'admin') {
        const target = await this.findByEmail(email);
        if (role === 'super_admin' || (target && target.Role === 'super_admin')) {
          errors.push(`Skipped ${email}: only a super admin can create or change super admin accounts`);
          continue;
        }
      }
      try {
        const existing = await this.findByEmail(email);
        const isActiveRaw = row.isActive ?? row.IsActive;
        const isActive = isActiveRaw === undefined || isActiveRaw === '' ? undefined : /^(true|1)$/i.test(isActiveRaw);

        if (existing) {
          await this.update(
            existing.Id,
            {
              firstName,
              lastName,
              role,
              studentId: row.studentId || row.StudentId || undefined,
              agencyName: row.agencyName || row.AgencyName || undefined,
              isActive,
            },
            importedBy,
          );
          updated++;
        } else {
          const tempPassword = crypto.randomBytes(9).toString('base64');
          await this.create(
            {
              email,
              password: tempPassword,
              firstName,
              lastName,
              role,
              studentId: row.studentId || row.StudentId || undefined,
              agencyName: row.agencyName || row.AgencyName || undefined,
            },
            importedBy,
          );
          created++;
        }
      } catch (err) {
        errors.push(`Row for ${email}: ${(err as Error).message ?? 'unknown error'}`);
      }
    }
    return { created, updated, errors };
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
      this.db.query<{ InstitutionId: number }>(
        `SELECT InstitutionId FROM UserScopeUniversities WHERE UserId = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
      ),
      this.db.query<{ AcademicUnitId: number }>(
        `SELECT AcademicUnitId FROM UserScopeAcademicUnits WHERE UserId = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
      ),
      this.db.query<{ AgencyId: number }>(
        `SELECT AgencyId FROM UserScopeAgencies WHERE UserId = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
      ),
    ]);

    return {
      universityIds: uniRes.recordset.map((r) => r.InstitutionId),
      academicUnitIds: auRes.recordset.map((r) => r.AcademicUnitId),
      agencyIds: agRes.recordset.map((r) => r.AgencyId),
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
