import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import { UploadsService } from '../uploads/uploads.service';
import { SchemaService } from '../policy/schema.service';
import type { UploadedFileLike } from '../common/uploaded-file.interface';

const COLORS = ['#770816', '#1e4a80', '#14612f', '#7a5a06', '#5b2a86', '#0f6b6b', '#9a3b34', '#33415c'];

function initials(first: string, last: string) {
  return `${(first || '?').charAt(0)}${(last || '').charAt(0)}`.toUpperCase();
}

/** A small deterministic avatar (initials on a colour) used when nobody uploaded a photo. */
export function defaultAvatarSvg(userId: string, first: string, last: string): Buffer {
  const hash = crypto.createHash('sha1').update(userId).digest();
  const bg = COLORS[hash[0] % COLORS.length];
  const text = initials(first, last).replace(/[<>&"']/g, '');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
      `<rect width="256" height="256" fill="${bg}"/>` +
      `<text x="128" y="128" font-family="Arial, Helvetica, sans-serif" font-size="104" font-weight="700" fill="#ffffff" ` +
      `text-anchor="middle" dominant-baseline="central">${text}</text></svg>`,
    'utf-8',
  );
}

@Injectable()
export class AccountService {
  constructor(
    private db: DatabaseService,
    private email: EmailService,
    private uploads: UploadsService,
    private schema: SchemaService,
  ) {}

  // ── email change (needs a click on the emailed link) ─────────────

  async requestEmailChange(user: { id: string; firstName?: string }, newEmail: string, password: string) {
    const res = await this.db.query<{ PasswordHash: string | null; FirstName: string; Email: string }>(
      `SELECT PasswordHash, FirstName, Email FROM Users WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: user.id }],
    );
    const row = res.recordset[0];
    if (!row) throw new NotFoundException('User not found');
    if (!row.PasswordHash || !(await argon2.verify(row.PasswordHash, password))) {
      throw new UnauthorizedException('Your current password is not correct');
    }
    const target = newEmail.trim().toLowerCase();
    if (target === row.Email.toLowerCase()) throw new BadRequestException('That is already your email address');
    const taken = await this.db.query(`SELECT 1 AS X FROM Users WHERE Email = @e`, [{ name: 'e', type: sql.NVarChar(254), value: target }]);
    if (taken.recordset[0]) throw new ConflictException('That email address is already in use');

    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await this.db.query(`DELETE FROM EmailChangeRequests WHERE UserId = @id AND UsedAt IS NULL`, [
      { name: 'id', type: sql.UniqueIdentifier, value: user.id },
    ]);
    await this.db.query(
      `INSERT INTO EmailChangeRequests (UserId, NewEmail, TokenHash, ExpiresAt)
       VALUES (@id, @e, @h, DATEADD(HOUR, 24, SYSUTCDATETIME()))`,
      [
        { name: 'id', type: sql.UniqueIdentifier, value: user.id },
        { name: 'e', type: sql.NVarChar(254), value: target },
        { name: 'h', type: sql.NVarChar(128), value: hash },
      ],
    );
    const sent = await this.email.sendEmail(target, templates.emailChange(this.email.context, { firstName: row.FirstName, newEmail: target, token }));
    return { message: `We sent a confirmation link to ${target}. Your email changes once you click it.`, emailSent: sent?.ok !== false };
  }

  async confirmEmailChange(token: string) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const res = await this.db.query<{ Id: number; UserId: string; NewEmail: string }>(
      `SELECT Id, UserId, NewEmail FROM EmailChangeRequests WHERE TokenHash = @h AND UsedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()`,
      [{ name: 'h', type: sql.NVarChar(128), value: hash }],
    );
    const req = res.recordset[0];
    if (!req) throw new BadRequestException('This link is invalid or has expired. Please request the change again.');
    const taken = await this.db.query(`SELECT 1 AS X FROM Users WHERE Email = @e AND Id <> @id`, [
      { name: 'e', type: sql.NVarChar(254), value: req.NewEmail },
      { name: 'id', type: sql.UniqueIdentifier, value: req.UserId },
    ]);
    if (taken.recordset[0]) throw new ConflictException('That email address is already in use');
    await this.db.query(`UPDATE Users SET Email = @e, EmailVerified = 1, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'e', type: sql.NVarChar(254), value: req.NewEmail },
      { name: 'id', type: sql.UniqueIdentifier, value: req.UserId },
    ]);
    await this.db.query(`UPDATE EmailChangeRequests SET UsedAt = SYSUTCDATETIME() WHERE Id = @i`, [{ name: 'i', type: sql.Int, value: req.Id }]);
    await this.db.query(
      `INSERT INTO AuditLog (UserId, UserEmail, Action, EntityType, EntityId) VALUES (@id, @e, 'EMAIL_CHANGED', 'User', @eid)`,
      [
        { name: 'id', type: sql.UniqueIdentifier, value: req.UserId },
        { name: 'e', type: sql.NVarChar(254), value: req.NewEmail },
        { name: 'eid', type: sql.NVarChar(100), value: req.UserId },
      ],
    );
    return { email: req.NewEmail };
  }

  // ── profile photo (stored in blob storage, one folder per user) ──

  private async requireColumns() {
    if (!(await this.schema.has('Users', 'AvatarUploadId'))) {
      throw new BadRequestException('Profile photos need migration 018 to be applied');
    }
  }

  async setPhoto(user: { id: string; role: string }, file: UploadedFileLike, documentType = 'profile_photo') {
    await this.requireColumns();
    const saved = await this.uploads.save(file, {
      ownerUserId: user.id,
      role: user.role,
      entityType: 'avatar',
      entityId: user.id,
      isPublic: false,
      documentType,
    });
    await this.db.query(`UPDATE Users SET AvatarUploadId = @u, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'u', type: sql.UniqueIdentifier, value: saved.id },
      { name: 'id', type: sql.UniqueIdentifier, value: user.id },
    ]);
    return { uploadId: saved.id };
  }

  async removePhoto(userId: string) {
    await this.requireColumns();
    await this.db.query(`UPDATE Users SET AvatarUploadId = NULL, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: userId },
    ]);
    return { removed: true };
  }

  /** Stream + metadata for a user's photo, or null when they have none. */
  async openPhoto(userId: string) {
    if (!(await this.schema.has('Users', 'AvatarUploadId'))) return null;
    const res = await this.db.query<{ AvatarUploadId: string | null }>(`SELECT AvatarUploadId FROM Users WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: userId },
    ]);
    const uploadId = res.recordset[0]?.AvatarUploadId;
    if (!uploadId) return null;
    const file = await this.uploads.getForAuthenticatedUser(uploadId, { id: userId, role: 'admin' });
    const stream = await this.uploads.openStream(file);
    return stream ? { stream, mimeType: file.mimeType || 'image/jpeg' } : null;
  }

  /**
   * The default profile picture is the TransferHub logo (the UI shows it for anyone without a photo), so this clears the
   * initials avatars an earlier version generated. Real uploaded photos are never touched.
   */
  async resetDefaultPhotos() {
    await this.requireColumns();
    const res = await this.db.query<{ Cleared: number }>(
      `UPDATE Users SET AvatarUploadId = NULL, UpdatedAt = SYSUTCDATETIME()
       WHERE AvatarUploadId IN (SELECT Id FROM Uploads WHERE DocumentType = 'default_avatar');
       SELECT @@ROWCOUNT AS Cleared;`,
    );
    return { cleared: res.recordset[0]?.Cleared ?? 0 };
  }
}
