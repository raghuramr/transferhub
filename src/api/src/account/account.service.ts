import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import { UploadsService } from '../uploads/uploads.service';
import { SchemaService } from '../policy/schema.service';
import { isSelectableUniversity, validateTarget, keepIntendedUnit } from './target.logic';
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

  /** Self-service photo upload (the signed-in user sets their own). */
  async setPhoto(user: { id: string; role: string }, file: UploadedFileLike, documentType = 'profile_photo') {
    return this.setPhotoForUser(user.id, user, file, documentType);
  }

  /**
   * Set a user's photo. The signed-in user may set their own; admins/super admins may set anyone's
   * (so staff can upload a real photo for a student, replacing a generated initials avatar).
   */
  async setPhotoForUser(
    targetUserId: string,
    actor: { id: string; role: string },
    file: UploadedFileLike,
    documentType = 'profile_photo',
  ) {
    await this.requireColumns();
    const isSelf = actor.id.toLowerCase() === targetUserId.toLowerCase();
    if (!isSelf && !['admin', 'super_admin'].includes(actor.role)) {
      throw new ForbiddenException('You can only change your own photo.');
    }
    // Store under the target user's own role folder.
    const roleRes = await this.db.query<{ Role: string }>(
      `SELECT r.Name AS Role FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: targetUserId }],
    );
    const targetRole = roleRes.recordset[0]?.Role ?? actor.role;
    const saved = await this.uploads.save(file, {
      ownerUserId: targetUserId,
      role: targetRole,
      entityType: 'avatar',
      entityId: targetUserId,
      isPublic: false,
      documentType,
    });
    await this.db.query(`UPDATE Users SET AvatarUploadId = @u, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'u', type: sql.UniqueIdentifier, value: saved.id },
      { name: 'id', type: sql.UniqueIdentifier, value: targetUserId },
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

  /** Remove another user's photo (self, or admin/super admin). */
  async removePhotoFor(targetUserId: string, actor: { id: string; role: string }) {
    const isSelf = actor.id.toLowerCase() === targetUserId.toLowerCase();
    if (!isSelf && !['admin', 'super_admin'].includes(actor.role)) {
      throw new ForbiddenException('You can only change your own photo.');
    }
    return this.removePhoto(targetUserId);
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

  // ── student university & program (profile page, Explore "make this my target") ──

  /** Receiving universities a student can pick as a target, each with its active programs. */
  async getTargets() {
    const unis = await this.db.query<{ Id: number; Code: string; Name: string; Type: string; IsActive: boolean }>(
      `SELECT Id, Code, Name, Type, IsActive FROM Institutions WHERE IsActive = 1 AND Type = 'university' ORDER BY Name`,
    );
    const progs = await this.db.query<{ InstitutionId: number; Id: number; Name: string; Degree: string | null }>(
      `SELECT pu.InstitutionId, p.Id, p.Name, p.Degree
       FROM ProgramUniversities pu JOIN Programs p ON p.Id = pu.ProgramId
       WHERE p.IsActive = 1 ORDER BY p.Name`,
    );
    return unis.recordset
      .filter((u) => isSelectableUniversity({ code: u.Code, type: u.Type, isActive: !!u.IsActive }))
      .map((u) => ({
        id: u.Id,
        code: u.Code,
        name: u.Name,
        programs: progs.recordset
          .filter((p) => p.InstitutionId === u.Id)
          .map((p) => ({ id: p.Id, name: p.Name, degree: p.Degree })),
      }));
  }

  async setTarget(user: { id: string; email?: string }, institutionId: number, programId?: number | null) {
    const inst = await this.db.query<{ Id: number; Code: string; Type: string; IsActive: boolean }>(
      `SELECT Id, Code, Type, IsActive FROM Institutions WHERE Id = @i`,
      [{ name: 'i', type: sql.Int, value: institutionId }],
    );
    const iRow = inst.recordset[0];
    let program: { id: number; isActive: boolean; offeredAt: number[] } | null = null;
    if (programId != null) {
      const pr = await this.db.query<{ Id: number; IsActive: boolean }>(
        `SELECT Id, IsActive FROM Programs WHERE Id = @p`,
        [{ name: 'p', type: sql.Int, value: programId }],
      );
      if (pr.recordset[0]) {
        const off = await this.db.query<{ InstitutionId: number }>(
          `SELECT InstitutionId FROM ProgramUniversities WHERE ProgramId = @p`,
          [{ name: 'p', type: sql.Int, value: programId }],
        );
        program = { id: programId, isActive: !!pr.recordset[0].IsActive, offeredAt: off.recordset.map((r) => r.InstitutionId) };
      }
    }
    const check = validateTarget(
      iRow ? { id: iRow.Id, code: iRow.Code, type: iRow.Type, isActive: !!iRow.IsActive } : null,
      program,
      programId != null,
    );
    if ('error' in check) throw new BadRequestException(check.error);

    const cur = await this.db.query<{ TargetInstitutionId: number | null; TargetProgramId: number | null; IntendedAcademicUnitId: number | null }>(
      `SELECT TargetInstitutionId, TargetProgramId, IntendedAcademicUnitId FROM StudentProfiles WHERE UserId = @u`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: user.id }],
    );
    const old = cur.recordset[0];
    if (!old) {
      await this.db.query(`INSERT INTO StudentProfiles (UserId) VALUES (@u)`, [{ name: 'u', type: sql.UniqueIdentifier, value: user.id }]);
    }
    let keepUnit = false;
    if (old?.IntendedAcademicUnitId != null) {
      const au = await this.db.query<{ InstitutionId: number | null }>(
        `SELECT InstitutionId FROM AcademicUnits WHERE Id = @a`,
        [{ name: 'a', type: sql.Int, value: old.IntendedAcademicUnitId }],
      );
      keepUnit = keepIntendedUnit(au.recordset[0]?.InstitutionId, institutionId);
    }
    await this.db.query(
      `UPDATE StudentProfiles
       SET TargetInstitutionId = @i, TargetProgramId = @p,
           IntendedAcademicUnitId = ${keepUnit ? 'IntendedAcademicUnitId' : 'NULL'},
           UpdatedAt = SYSUTCDATETIME()
       WHERE UserId = @u`,
      [
        { name: 'i', type: sql.Int, value: institutionId },
        { name: 'p', type: sql.Int, value: programId ?? null },
        { name: 'u', type: sql.UniqueIdentifier, value: user.id },
      ],
    );
    await this.db.query(
      `INSERT INTO AuditLog (UserId, UserEmail, Action, EntityType, EntityId, OldValue, NewValue)
       VALUES (@u, @e, 'STUDENT_TARGET_CHANGED', 'StudentProfile', @eid, @old, @new)`,
      [
        { name: 'u', type: sql.UniqueIdentifier, value: user.id },
        { name: 'e', type: sql.NVarChar(254), value: user.email ?? null },
        { name: 'eid', type: sql.NVarChar(100), value: user.id },
        { name: 'old', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ institutionId: old?.TargetInstitutionId ?? null, programId: old?.TargetProgramId ?? null }) },
        { name: 'new', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ institutionId, programId: programId ?? null }) },
      ],
    ).catch(() => {});

    // Existing requests are never altered: warn when an official one exists for a different university.
    let warning: string | null = null;
    try {
      if (await this.schema.has('Transcripts', 'EvaluationKind')) {
        const r = await this.db.query<{ N: number }>(
          `SELECT COUNT(*) AS N FROM Transcripts
           WHERE StudentUserId = @u AND EvaluationKind <> 'preview' AND ISNULL(TargetInstitutionId, -1) <> @i`,
          [{ name: 'u', type: sql.UniqueIdentifier, value: user.id }, { name: 'i', type: sql.Int, value: institutionId }],
        );
        if (r.recordset[0]?.N > 0) {
          warning = 'You already have an official request for another university. It keeps its original target; the new choice applies to new requests and previews.';
        }
      }
    } catch { /* optional */ }
    return { ok: true, targetInstitutionId: institutionId, targetProgramId: programId ?? null, warning };
  }

  /**
   * Student edits their own "current" school details — free text, so a college
   * that isn't in our catalogue is captured just as well. Maps to
   * StudentProfiles.PriorInstitutionName / FieldOfStudy (what the profile and
   * the transcript form call "current institution" / "current program").
   */
  async updateStudentProfile(
    user: { id: string; email?: string },
    patch: { currentInstitution?: string | null; currentProgram?: string | null },
  ) {
    const exists = await this.db.query<{ UserId: string }>(
      `SELECT UserId FROM StudentProfiles WHERE UserId = @u`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: user.id }],
    );
    if (!exists.recordset[0]) {
      await this.db.query(`INSERT INTO StudentProfiles (UserId) VALUES (@u)`, [{ name: 'u', type: sql.UniqueIdentifier, value: user.id }]);
    }
    const sets: string[] = [];
    const params: { name: string; type: unknown; value: unknown }[] = [
      { name: 'u', type: sql.UniqueIdentifier, value: user.id },
    ];
    if (patch.currentInstitution !== undefined) {
      sets.push('PriorInstitutionName = @inst');
      params.push({ name: 'inst', type: sql.NVarChar(300), value: patch.currentInstitution?.trim() || null });
    }
    if (patch.currentProgram !== undefined) {
      sets.push('FieldOfStudy = @prog');
      params.push({ name: 'prog', type: sql.NVarChar(300), value: patch.currentProgram?.trim() || null });
    }
    if (sets.length === 0) return { ok: true };
    await this.db.query(
      `UPDATE StudentProfiles SET ${sets.join(', ')}, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @u`,
      params as never,
    );
    return { ok: true };
  }

  /**
   * The university (or universities) a staff member belongs to, for the branded header: an admin's or faculty
   * member's visibility scope (UserScopeUniversities). Empty for everyone else and for unrestricted staff,
   * who simply see the TransferHub header. Never throws: branding must not break the app shell.
   */
  async universityBrand(user: { id: string; role: string }) {
    if (!['admin', 'faculty'].includes(user.role)) return { universities: [] };
    try {
      if (!(await this.schema.has('UserScopeUniversities', 'InstitutionId'))) return { universities: [] };
      const hasImages = await this.schema.has('Institutions', 'LogoUrl');
      const r = await this.db.query<{ Id: number; Code: string; Name: string; LogoUrl: string | null; HeroImageUrl: string | null }>(
        `SELECT i.Id, i.Code, i.Name, ${hasImages ? 'i.LogoUrl, i.HeroImageUrl' : 'CAST(NULL AS NVARCHAR(500)) AS LogoUrl, CAST(NULL AS NVARCHAR(500)) AS HeroImageUrl'}
         FROM UserScopeUniversities s JOIN Institutions i ON i.Id = s.InstitutionId
         WHERE s.UserId = @u AND i.IsActive = 1 ORDER BY i.Name`,
        [{ name: 'u', type: sql.UniqueIdentifier, value: user.id }],
      );
      return {
        universities: r.recordset.map((x) => ({ id: x.Id, code: x.Code, name: x.Name, logoUrl: x.LogoUrl ?? null, heroImageUrl: x.HeroImageUrl ?? null })),
      };
    } catch {
      return { universities: [] };
    }
  }

  /** What the profile page shows under "University & program" (read-only). */
  async studentOverview(userId: string) {
    const res = await this.db.query<{
      PriorInstitutionName: string | null; FieldOfStudy: string | null; ProgramArea: string | null; HighestEducationLevel: string | null;
      CreditsCompleted: number | null; TargetInstitutionId: number | null; TargetProgramId: number | null;
      TargetInstitutionName: string | null; TargetInstitutionCode: string | null; TargetProgramName: string | null; TargetProgramDegree: string | null;
    }>(
      `SELECT sp.PriorInstitutionName, sp.FieldOfStudy, sp.ProgramArea, sp.HighestEducationLevel,
              ${(await this.schema.has('StudentProfiles', 'CreditsCompleted')) ? 'sp.CreditsCompleted' : 'CAST(NULL AS DECIMAL(6,2)) AS CreditsCompleted'},
              sp.TargetInstitutionId, sp.TargetProgramId,
              ti.Name AS TargetInstitutionName, ti.Code AS TargetInstitutionCode,
              tp.Name AS TargetProgramName, tp.Degree AS TargetProgramDegree
       FROM Users u
       LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id
       LEFT JOIN Institutions ti ON ti.Id = sp.TargetInstitutionId
       LEFT JOIN Programs tp ON tp.Id = sp.TargetProgramId
       WHERE u.Id = @u`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: userId }],
    );
    const row = res.recordset[0];
    const last = await this.db.query<{ Name: string }>(
      `SELECT TOP 1 i.Name FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE t.StudentUserId = @u ORDER BY t.ReceivedAt DESC`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: userId }],
    );
    const tc = await this.db.query<{ Credits: number | null; Courses: number }>(
      `SELECT SUM(COALESCE(tc.NormalisedCredits, tc.OriginalCredits)) AS Credits, COUNT(*) AS Courses
       FROM Transcripts t JOIN TranscriptCourses tc ON tc.TranscriptId = t.Id WHERE t.StudentUserId = @u`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: userId }],
    );
    const fromTranscripts = tc.recordset[0]?.Credits ?? null;
    return {
      currentInstitution: row?.PriorInstitutionName ?? last.recordset[0]?.Name ?? null,
      currentProgram: row?.FieldOfStudy ?? row?.ProgramArea ?? null,
      highestEducationLevel: row?.HighestEducationLevel ?? null,
      targetInstitutionId: row?.TargetInstitutionId ?? null,
      targetInstitutionName: row?.TargetInstitutionName ?? null,
      targetInstitutionCode: row?.TargetInstitutionCode ?? null,
      targetProgramId: row?.TargetProgramId ?? null,
      targetProgramName: row?.TargetProgramName ?? null,
      targetProgramDegree: row?.TargetProgramDegree ?? null,
      creditsCompleted: row?.CreditsCompleted ?? fromTranscripts,
      submittedCourses: tc.recordset[0]?.Courses ?? 0,
      submittedCredits: fromTranscripts,
    };
  }
}
