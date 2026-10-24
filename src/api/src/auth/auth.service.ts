import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as sql from 'mssql';
import type { AuthenticatedUser } from './authenticated-request.interface';

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
  ) {}

  async validateUser(email: string, password: string, ip: string, userAgent: string): Promise<AuthenticatedUser> {
    const result = await this.db.query<UserAuthRow>(
      `SELECT u.Id, u.Email, u.PasswordHash, u.FirstName, u.LastName,
              u.IsActive, u.IsLocked, u.LockedUntil, u.FailedLogins,
              u.DepartmentId, r.Name AS Role
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
      departmentId: user.DepartmentId,
    };
  }

  async login(user: AuthenticatedUser, ip: string, userAgent: string) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id, ip, userAgent);
    return { accessToken, refreshToken, user };
  }

  async refresh(token: string) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await this.db.query<RefreshTokenRow>(
      `SELECT rt.UserId, rt.ExpiresAt, rt.IsRevoked,
              u.Email, u.FirstName, u.LastName, u.IsActive, u.DepartmentId, r.Name AS Role
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
      departmentId: row.DepartmentId,
    };

    return { accessToken: this.generateAccessToken(user), user };
  }

  async logout(userId: string, token: string) {
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
              r.Name AS Role, r.DisplayName AS RoleDisplay,
              d.Name AS DepartmentName
       FROM Users u
       JOIN Roles r ON r.Id = u.RoleId
       LEFT JOIN Departments d ON d.Id = u.DepartmentId
       WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: userId }],
    );
    return result.recordset[0];
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
