import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService, QueryInput } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { EmailService } from '../common/email.service';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as sql from 'mssql';
import type { AuthenticatedUser } from './authenticated-request.interface';
import type { RegisterStudentDto } from './dto/register-student.dto';

interface UserAuthRow {
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
  RoleKey?: string;
}

interface RefreshTokenRow {
  UserId: string;
  ExpiresAt: Date;
  IsRevoked: boolean;
  Email: string;
  FirstName: string;
  LastName: string;
  IsActive: boolean;
  DepartmentId: number | null;
  Role: string;
  RoleKey?: string;
}

export interface MeRow {
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
  MustChangePass: boolean;
  LastLoginAt: Date | null;
  DepartmentId: number | null;
  Role: string;
  RoleDisplay: string;
  DepartmentName: string | null;
}

interface PasswordHashRow {
  PasswordHash: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private db: DatabaseService,
    private jwtService: JwtService,
    private config: ConfigService,
    private emailService: EmailService,
    private schema: SchemaService,
  ) {}

  /** The built-in role a user behaves like: a custom role's BaseRole, else the role itself (BaseRole exists after migration 032). */
  private async roleExpr(): Promise<string> {
    return (await this.schema.has('Roles', 'BaseRole')) ? 'ISNULL(r.BaseRole, r.Name)' : 'r.Name';
  }

  async validateUser(email: string, password: string, ip: string, userAgent: string): Promise<AuthenticatedUser> {
    const result = await this.db.query<UserAuthRow>(
      `SELECT u.Id, u.Email, u.PasswordHash, u.FirstName, u.LastName,
              u.IsActive, u.IsLocked, u.LockedUntil, u.FailedLogins,
              u.DepartmentId, ${await this.roleExpr()} AS Role, r.Name AS RoleKey
       FROM Users u JOIN Roles r ON r.Id = u.RoleId
       WHERE u.Email = @email`,
      [{ name: 'email', type: sql.NVarChar(254), value: email }],
    );

    const user = result.recordset[0];
    const maxAttempts = this.config.get<number>('MAX_LOGIN_ATTEMPTS', 5);
    const lockMinutes = this.config.get<number>('LOCK_DURATION_MINUTES', 15);

    if (!user || !user.IsActive) {
      await this.audit(null, email, null, 'LOGIN_FAILED', 'User', null, ip, userAgent);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.IsLocked && user.LockedUntil && new Date(user.LockedUntil) > new Date()) {
      throw new UnauthorizedException('Account is locked. Try again later.');
    }

    // Verify password - handle placeholder hash for demo users
    let valid = false;
    if (user.PasswordHash && !user.PasswordHash.includes('PLACEHOLDER')) {
      try {
        valid = await argon2.verify(user.PasswordHash, password);
      } catch {
        valid = false;
      }
    }

    if (!valid) {
      const newFailCount = (user.FailedLogins || 0) + 1;
      const shouldLock = newFailCount >= maxAttempts;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + lockMinutes * 60 * 1000)
        : null;

      await this.db.query(
        `UPDATE Users SET FailedLogins = @fails, IsLocked = @locked, LockedUntil = @until,
                          UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @id`,
        [
          { name: 'fails', type: sql.Int, value: newFailCount },
          { name: 'locked', type: sql.Bit, value: shouldLock ? 1 : 0 },
          { name: 'until', type: sql.DateTime2, value: lockedUntil },
          { name: 'id', type: sql.UniqueIdentifier, value: user.Id },
        ],
      );

      await this.audit(user.Id, email, user.Role, 'LOGIN_FAILED', 'User', user.Id, ip, userAgent);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Success — reset failed attempts
    await this.db.query(
      `UPDATE Users SET FailedLogins = 0, IsLocked = 0, LockedUntil = NULL,
                        LastLoginAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
       WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: user.Id }],
    );

    await this.audit(user.Id, email, user.Role, 'LOGIN_SUCCESS', 'User', user.Id, ip, userAgent);

    return {
      id: user.Id,
      email: user.Email,
      firstName: user.FirstName,
      lastName: user.LastName,
      role: user.Role,
      roleKey: user.RoleKey,
      departmentId: user.DepartmentId,
    };
  }

  /**
   * Public student self-registration (see RegisterStudentDto / migration
   * 012). Creates the Users row + a StudentProfiles row (education,
   * emergency contact, and an informational target University/Program —
   * deliberately NOT a UserScopeUniversities row, so registering never
   * narrows the student's own visibility; see CLAUDE.md scope-visibility
   * notes). Logs the caller straight in afterward, same response shape as
   * `login()`.
   */
  async register(dto: RegisterStudentDto, ip: string, userAgent: string) {
    const existing = await this.db.query<{ Id: string }>(
      `SELECT Id FROM Users WHERE Email = @email`,
      [{ name: 'email', type: sql.NVarChar(254), value: dto.email }],
    );
    if (existing.recordset[0]) throw new ConflictException('Email already in use');

    const roleRes = await this.db.query<{ Id: number }>(
      `SELECT Id FROM Roles WHERE Name = 'student'`,
    );
    const roleId = roleRes.recordset[0]?.Id;
    if (!roleId) throw new NotFoundException('student role not found — has the DB been seeded?');

    if (dto.targetInstitutionId !== undefined) {
      const inst = await this.db.query<{ Id: number }>(
        `SELECT Id FROM Institutions WHERE Id = @id`,
        [{ name: 'id', type: sql.Int, value: dto.targetInstitutionId }],
      );
      if (!inst.recordset[0]) throw new BadRequestException('targetInstitutionId not found');
    }
    if (dto.targetProgramId !== undefined) {
      const prog = await this.db.query<{ Id: number }>(
        `SELECT Id FROM Programs WHERE Id = @id`,
        [{ name: 'id', type: sql.Int, value: dto.targetProgramId }],
      );
      if (!prog.recordset[0]) throw new BadRequestException('targetProgramId not found');
    }

    const regForm = await this.registrationFormRow();
    if (regForm) this.assertRegistrationAnswers(regForm, dto.extraAnswers ?? {});

    const hash = await argon2.hash(dto.password);

    const userRes = await this.db.query<{ Id: string }>(
      `INSERT INTO Users (
         Email, PasswordHash, FirstName, LastName, RoleId, MustChangePass,
         Mobile, AddressLine1, AddressLine2, City, State, PostalCode, Country, CountryOfOrigin
       )
       OUTPUT inserted.Id
       VALUES (
         @email, @hash, @first, @last, @roleId, 0,
         @mobile, @addr1, @addr2, @city, @state, @postal, @country, @countryOfOrigin
       )`,
      [
        { name: 'email', type: sql.NVarChar(254), value: dto.email },
        { name: 'hash', type: sql.NVarChar(255), value: hash },
        { name: 'first', type: sql.NVarChar(100), value: dto.firstName },
        { name: 'last', type: sql.NVarChar(100), value: dto.lastName },
        { name: 'roleId', type: sql.Int, value: roleId },
        { name: 'mobile', type: sql.NVarChar(30), value: dto.mobile || null },
        { name: 'addr1', type: sql.NVarChar(200), value: dto.addressLine1 || null },
        { name: 'addr2', type: sql.NVarChar(200), value: dto.addressLine2 || null },
        { name: 'city', type: sql.NVarChar(100), value: dto.city || null },
        { name: 'state', type: sql.NVarChar(100), value: dto.state || null },
        { name: 'postal', type: sql.NVarChar(20), value: dto.zipCode || null },
        { name: 'country', type: sql.NVarChar(100), value: dto.country || null },
        { name: 'countryOfOrigin', type: sql.NVarChar(100), value: dto.countryOfOrigin || null },
      ],
    );
    const userId = userRes.recordset[0].Id;

    try {
      await this.db.query(
        `INSERT INTO StudentProfiles (
           UserId, TargetInstitutionId, TargetProgramId,
           PriorInstitutionName, HighestEducationLevel, FieldOfStudy, GPA, GraduationYear,
           EmergencyContactName, EmergencyContactPhone
         )
         VALUES (
           @userId, @targetInstitutionId, @targetProgramId,
           @priorInstitutionName, @highestEducationLevel, @fieldOfStudy, @gpa, @graduationYear,
           @emergencyContactName, @emergencyContactPhone
         )`,
        [
          { name: 'userId', type: sql.UniqueIdentifier, value: userId },
          { name: 'targetInstitutionId', type: sql.Int, value: dto.targetInstitutionId ?? null },
          { name: 'targetProgramId', type: sql.Int, value: dto.targetProgramId ?? null },
          { name: 'priorInstitutionName', type: sql.NVarChar(200), value: dto.priorInstitutionName || null },
          { name: 'highestEducationLevel', type: sql.NVarChar(100), value: dto.highestEducationLevel || null },
          { name: 'fieldOfStudy', type: sql.NVarChar(200), value: dto.fieldOfStudy || null },
          { name: 'gpa', type: sql.Decimal(3, 2), value: dto.gpa ?? null },
          { name: 'graduationYear', type: sql.Int, value: dto.graduationYear ?? null },
          { name: 'emergencyContactName', type: sql.NVarChar(200), value: dto.emergencyContactName || null },
          { name: 'emergencyContactPhone', type: sql.NVarChar(30), value: dto.emergencyContactPhone || null },
        ] as QueryInput[],
      );

      await this.saveApplication(userId, dto);
      if (regForm) await this.saveRegistrationAnswers(regForm.Id, userId, dto.extraAnswers ?? {});
    } catch (err) {
      // A half-created student would block a retry with "Email already in use" - undo everything.
      await this.rollbackRegistration(userId);
      throw err;
    }
    await this.audit(userId, dto.email, 'student', 'STUDENT_REGISTERED', 'User', userId, ip, userAgent);

    try {
      await this.emailService.sendWelcome(dto.email, dto.firstName);
    } catch {
      // Best-effort only — never fail registration because email delivery failed.
    }

    const user: AuthenticatedUser = {
      id: userId,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: 'student',
      departmentId: null,
    };
    return this.login(user, ip, userAgent);
  }

  /** Removes a partially created student so the same email can register again. */
  private async rollbackRegistration(userId: string) {
    const p = [{ name: 'u', type: sql.UniqueIdentifier, value: userId }];
    for (const stmt of [
      `DELETE FROM FormSubmissions WHERE SubmittedByUserId = @u`,
      `DELETE FROM StudentExamCredits WHERE UserId = @u`,
      `DELETE FROM StudentEducation WHERE UserId = @u`,
      `DELETE FROM StudentProfiles WHERE UserId = @u`,
      `DELETE FROM Users WHERE Id = @u`,
    ]) {
      try {
        await this.db.query(stmt, p);
      } catch (e) {
        this.logger.warn(`Registration rollback step failed (${stmt}): ${(e as Error).message}`);
      }
    }
  }

  /** The open "student-registration" custom form (super admins edit it under Custom Forms), or null. */
  private async registrationFormRow() {
    try {
      const res = await this.db.query<{ Id: number; Title: string; Description: string | null; SchemaJson: string }>(
        `SELECT Id, Title, Description, SchemaJson FROM Forms WHERE Slug = 'student-registration' AND Status = 'open'`,
      );
      return res.recordset[0] ?? null;
    } catch {
      return null;
    }
  }

  private registrationFields(form: { SchemaJson: string }) {
    const fields = (JSON.parse(form.SchemaJson).fields ?? []) as { key: string; label?: string; type: string; required?: boolean; section?: string }[];
    return fields.filter((f) => f.type !== 'file'); // files need a login, which a new registrant does not have yet
  }

  private assertRegistrationAnswers(form: { SchemaJson: string }, answers: Record<string, unknown>) {
    for (const f of this.registrationFields(form)) {
      const v = answers[f.key];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      if (f.required && empty) throw new BadRequestException(`"${f.label ?? f.key}" is required`);
    }
  }

  private async saveRegistrationAnswers(formId: number, userId: string, answers: Record<string, unknown>) {
    const allowed = new Set((await this.registrationFormRowById(formId)).map((f) => f.key));
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) if (allowed.has(k)) clean[k] = v;
    if (Object.keys(clean).length === 0) return;
    await this.db.query(`INSERT INTO FormSubmissions (FormId, SubmittedByUserId, Data) VALUES (@f, @u, @d)`, [
      { name: 'f', type: sql.Int, value: formId },
      { name: 'u', type: sql.UniqueIdentifier, value: userId },
      { name: 'd', type: sql.NVarChar(sql.MAX), value: JSON.stringify(clean) },
    ]);
  }

  private async registrationFormRowById(formId: number) {
    const res = await this.db.query<{ SchemaJson: string }>(`SELECT SchemaJson FROM Forms WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: formId },
    ]);
    return res.recordset[0] ? this.registrationFields(res.recordset[0]) : [];
  }

  /** Public (no auth) - the admin-managed extra registration questions, if any. */
  async publicRegistrationForm() {
    const row = await this.registrationFormRow();
    if (!row) return null;
    return { id: row.Id, title: row.Title, description: row.Description, fields: this.registrationFields(row) };
  }

  /**
   * Application details BU's process needs (doc 13): applicant type, school/college, entry term, BUID,
   * English, every institution attended and AP/IB/A-level exams. Written after the core account so a
   * database without migration 015 still registers the student (the extra details are then skipped).
   */
  private async saveApplication(userId: string, dto: RegisterStudentDto) {
    if (!(await this.schema.policyReady())) {
      if (dto.applicantType) this.logger.warn('Migration 015 not applied: application details were not saved.');
      return;
    }
    if (dto.intendedAcademicUnitId !== undefined) {
      const au = await this.db.query<{ Id: number }>(`SELECT Id FROM AcademicUnits WHERE Id = @id AND IsActive = 1`, [
        { name: 'id', type: sql.Int, value: dto.intendedAcademicUnitId },
      ]);
      if (!au.recordset[0]) throw new BadRequestException('intendedAcademicUnitId not found');
    }
    const admitted = dto.applicantType === 'admitted_transfer' || dto.applicantType === 'current_student';
    await this.db.query(
      `UPDATE StudentProfiles SET ApplicantType = @type, AdmissionStatus = @adm, IntendedAcademicUnitId = @unit,
              EntryTerm = @term, EntryYear = @year, BUStudentId = COALESCE(@buid, BUStudentId),
              IsNativeEnglish = @native, EnglishTestType = @test, EnglishTestScore = @score, HasIntlCoursework = @intl,
              HighSchoolName = @hs, HighSchoolGradYear = @hsy, CreditsCompleted = @cred, UpdatedAt = SYSUTCDATETIME()
       WHERE UserId = @u`,
      [
        { name: 'type', type: sql.VarChar(20), value: dto.applicantType ?? null },
        { name: 'adm', type: sql.VarChar(10), value: admitted ? 'admitted' : 'applicant' },
        { name: 'unit', type: sql.Int, value: dto.intendedAcademicUnitId ?? null },
        { name: 'term', type: sql.VarChar(10), value: dto.entryTerm ?? null },
        { name: 'year', type: sql.Int, value: dto.entryYear ?? null },
        { name: 'buid', type: sql.NVarChar(50), value: dto.buid ?? null },
        { name: 'native', type: sql.Bit, value: dto.isNativeEnglish == null ? null : dto.isNativeEnglish ? 1 : 0 },
        { name: 'test', type: sql.VarChar(10), value: dto.isNativeEnglish === false ? dto.englishTestType ?? null : null },
        { name: 'score', type: sql.NVarChar(20), value: dto.isNativeEnglish === false ? dto.englishTestScore ?? null : null },
        { name: 'intl', type: sql.Bit, value: dto.hasIntlCoursework == null ? null : dto.hasIntlCoursework ? 1 : 0 },
        { name: 'hs', type: sql.NVarChar(200), value: dto.highSchoolName || null },
        { name: 'hsy', type: sql.Int, value: dto.highSchoolGradYear ?? null },
        { name: 'cred', type: sql.Decimal(6, 2), value: dto.creditsCompleted ?? null },
        { name: 'u', type: sql.UniqueIdentifier, value: userId },
      ] as QueryInput[],
    );
    for (const [i, e] of (dto.education ?? []).entries()) {
      await this.db.query(
        `INSERT INTO StudentEducation (UserId, InstitutionName, City, StateRegion, Country, IsOutsideUS, FromYear, ToYear, CreditsEarned, FullTime, SortOrder)
         VALUES (@u, @n, @c, @s, @co, @os, @f, @t, @cr, @ft, @o)`,
        [
          { name: 'u', type: sql.UniqueIdentifier, value: userId },
          { name: 'n', type: sql.NVarChar(200), value: e.institutionName.trim() },
          { name: 'c', type: sql.NVarChar(100), value: e.city || null },
          { name: 's', type: sql.NVarChar(100), value: e.stateRegion || null },
          { name: 'co', type: sql.NVarChar(100), value: e.country || null },
          { name: 'os', type: sql.Bit, value: e.isOutsideUS ? 1 : 0 },
          { name: 'f', type: sql.Int, value: e.fromYear ?? null },
          { name: 't', type: sql.Int, value: e.toYear ?? null },
          { name: 'cr', type: sql.Decimal(6, 2), value: e.creditsEarned ?? null },
          { name: 'ft', type: sql.Bit, value: e.fullTime == null ? null : e.fullTime ? 1 : 0 },
          { name: 'o', type: sql.Int, value: i },
        ] as QueryInput[],
      );
    }
    for (const x of dto.exams ?? []) {
      await this.db.query(
        `INSERT INTO StudentExamCredits (UserId, ExamType, Subject, Score, ExamYear) VALUES (@u, @t, @s, @sc, @y)`,
        [
          { name: 'u', type: sql.UniqueIdentifier, value: userId },
          { name: 't', type: sql.VarChar(10), value: x.examType },
          { name: 's', type: sql.NVarChar(150), value: x.subject.trim() },
          { name: 'sc', type: sql.NVarChar(10), value: x.score || null },
          { name: 'y', type: sql.Int, value: x.examYear ?? null },
        ] as QueryInput[],
      );
    }
  }

  /** Public (no auth) — BU schools/colleges (AcademicUnits) of a university, for the registration page. */
  async publicAcademicUnits(institutionId: number) {
    const res = await this.db.query<{ Id: number; Name: string; Code: string | null }>(
      `SELECT Id, Name, Code FROM AcademicUnits WHERE InstitutionId = @i AND IsActive = 1 ORDER BY Name`,
      [{ name: 'i', type: sql.Int, value: institutionId }],
    );
    return res.recordset.map((r) => ({ id: r.Id, name: r.Name, code: r.Code }));
  }

  /** Public (no auth) — dropdown data for the registration page. */
  async publicUniversities() {
    const res = await this.db.query<{ Id: number; Code: string; Name: string }>(
      `SELECT Id, Code, Name FROM Institutions WHERE IsActive = 1 ORDER BY Name`,
    );
    return res.recordset.map((r) => ({ id: r.Id, code: r.Code, name: r.Name }));
  }

  /**
   * Public (no auth) — Programs offered at a University, via
   * ProgramUniversities (includes the owner, backfilled there — migration
   * 011) rather than just Programs.InstitutionId, so a shared Program shows
   * up for every University that offers it.
   */
  async publicPrograms(institutionId: number) {
    const res = await this.db.query<{ Id: number; Name: string; Degree: string | null; Area: string | null; Courses: number; Credits: number | null }>(
      `SELECT p.Id, p.Name, p.Degree, p.Area, ISNULL(cc.Courses, 0) AS Courses, cc.Credits
       FROM ProgramUniversities pu
       JOIN Programs p ON p.Id = pu.ProgramId
       OUTER APPLY (
         SELECT COUNT(*) AS Courses, SUM(CAST(x.Credits AS DECIMAL(10,2))) AS Credits
         FROM Courses x
         WHERE x.IsActive = 1
           AND (x.ProgramId = p.Id OR EXISTS (SELECT 1 FROM ProgramCourses pc WHERE pc.ProgramId = p.Id AND pc.CourseId = x.Id))
       ) cc
       WHERE pu.InstitutionId = @institutionId AND p.IsActive = 1
       ORDER BY p.Name`,
      [{ name: 'institutionId', type: sql.Int, value: institutionId }],
    );
    return res.recordset.map((r) => ({
      id: r.Id, name: r.Name, degree: r.Degree, area: r.Area,
      courses: Number(r.Courses ?? 0),
      credits: r.Credits == null ? null : Number(r.Credits),
    }));
  }

  async login(user: AuthenticatedUser, ip: string, userAgent: string) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id, ip, userAgent);
    return { accessToken, refreshToken, user };
  }

  /**
   * Issue a session for a user without a password — used ONLY by the gated public demo-login endpoint,
   * which first verifies the id is one of the super-admin-configured demo accounts and that demo mode
   * is on. Loads the user fresh so an inactive/deleted account can never be signed into.
   */
  async demoLoginAs(userId: string, ip: string, userAgent: string) {
    const r = await this.db.query<{
      Id: string; Email: string; FirstName: string; LastName: string; IsActive: boolean; DepartmentId: number | null; Role: string; RoleKey: string;
    }>(
      `SELECT u.Id, u.Email, u.FirstName, u.LastName, u.IsActive, u.DepartmentId, ${await this.roleExpr()} AS Role, r.Name AS RoleKey
       FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
    );
    const row = r.recordset[0];
    if (!row || !row.IsActive) throw new UnauthorizedException('Demo account is not available.');
    const user: AuthenticatedUser = {
      id: row.Id, email: row.Email, firstName: row.FirstName, lastName: row.LastName, role: row.Role, roleKey: row.RoleKey, departmentId: row.DepartmentId,
    };
    return this.login(user, ip, userAgent);
  }

  async refresh(token: string) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await this.db.query<RefreshTokenRow>(
      `SELECT rt.UserId, rt.ExpiresAt, rt.IsRevoked,
              u.Email, u.FirstName, u.LastName, u.IsActive, u.DepartmentId, ${await this.roleExpr()} AS Role, r.Name AS RoleKey
       FROM RefreshTokens rt
       JOIN Users u ON u.Id = rt.UserId
       JOIN Roles r ON r.Id = u.RoleId
       WHERE rt.Token = @hash`,
      [{ name: 'hash', type: sql.NVarChar(512), value: hash }],
    );

    const row = result.recordset[0];
    if (!row || row.IsRevoked || new Date(row.ExpiresAt) < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (!row.IsActive) throw new UnauthorizedException('User inactive');

    const user: AuthenticatedUser = {
      id: row.UserId,
      email: row.Email,
      firstName: row.FirstName,
      lastName: row.LastName,
      role: row.Role,
      roleKey: row.RoleKey,
      departmentId: row.DepartmentId,
    };

    return { accessToken: this.generateAccessToken(user), user };
  }

  async logout(userId: string, token?: string) {
    if (!token) return; // nothing to revoke (the client may sign out without a refresh token)
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await this.db.query(
      `UPDATE RefreshTokens SET IsRevoked = 1 WHERE UserId = @uid AND Token = @hash`,
      [
        { name: 'uid', type: sql.UniqueIdentifier, value: userId },
        { name: 'hash', type: sql.NVarChar(512), value: hash },
      ],
    );
  }

  async me(userId: string) {
    const result = await this.db.query<MeRow>(
      `SELECT u.Id, u.Email, u.FirstName, u.LastName, u.StudentId, u.AgencyName,
              u.Mobile, u.AddressLine1, u.AddressLine2, u.City, u.State, u.PostalCode,
              u.Country, u.CountryOfOrigin,
              u.IsActive, u.MustChangePass, u.LastLoginAt, u.DepartmentId,
              ${await this.roleExpr()} AS Role, r.DisplayName AS RoleDisplay,
              d.Name AS DepartmentName
       FROM Users u
       JOIN Roles r ON r.Id = u.RoleId
       LEFT JOIN Departments d ON d.Id = u.DepartmentId
       WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
    );
    const row = result.recordset[0];
    if (!row) return row;
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
      mustChangePass: !!row.MustChangePass,
      lastLoginAt: row.LastLoginAt,
      departmentId: row.DepartmentId,
      role: row.Role,
      roleDisplay: row.RoleDisplay,
      departmentName: row.DepartmentName,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const result = await this.db.query<PasswordHashRow>(
      `SELECT PasswordHash FROM Users WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
    );
    const row = result.recordset[0];
    if (!row) throw new UnauthorizedException();

    let valid = false;
    if (row.PasswordHash && !row.PasswordHash.includes('PLACEHOLDER')) {
      try {
        valid = await argon2.verify(row.PasswordHash, currentPassword);
      } catch {
        valid = false;
      }
    }
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hash = await argon2.hash(newPassword);
    await this.db.query(
      `UPDATE Users SET PasswordHash = @hash, MustChangePass = 0, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`,
      [
        { name: 'hash', type: sql.NVarChar(255), value: hash },
        { name: 'id', type: sql.UniqueIdentifier, value: userId },
      ],
    );
  }

  private generateAccessToken(user: AuthenticatedUser) {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
    });
  }

  private async generateRefreshToken(userId: string, ip: string, userAgent: string) {
    const token = uuidv4() + '-' + uuidv4();
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.db.query(
      `INSERT INTO RefreshTokens (UserId, Token, DeviceInfo, IpAddress, ExpiresAt)
       VALUES (@uid, @hash, @device, @ip, @expires)`,
      [
        { name: 'uid', type: sql.UniqueIdentifier, value: userId },
        { name: 'hash', type: sql.NVarChar(512), value: hash },
        { name: 'device', type: sql.NVarChar(500), value: userAgent || null },
        { name: 'ip', type: sql.NVarChar(45), value: ip || null },
        { name: 'expires', type: sql.DateTime2, value: expiresAt },
      ],
    );

    return token;
  }

  private async audit(
    userId: string | null,
    email: string | null,
    role: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    ip: string,
    userAgent: string,
  ) {
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, IpAddress, UserAgent)
         VALUES (@uid, @email, @role, @action, @etype, @eid, @ip, @ua)`,
        [
          { name: 'uid', type: sql.UniqueIdentifier, value: userId },
          { name: 'email', type: sql.NVarChar(254), value: email },
          { name: 'role', type: sql.VarChar(20), value: role },
          { name: 'action', type: sql.NVarChar(200), value: action },
          { name: 'etype', type: sql.NVarChar(100), value: entityType },
          { name: 'eid', type: sql.NVarChar(100), value: entityId },
          { name: 'ip', type: sql.NVarChar(45), value: ip },
          { name: 'ua', type: sql.NVarChar(500), value: userAgent },
        ],
      );
    } catch (e) {
      this.logger.warn('Audit log failed: ' + (e as Error).message);
    }
  }
}
