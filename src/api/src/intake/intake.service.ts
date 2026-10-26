import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import { SchemaService } from '../policy/schema.service';
import { AuthService } from '../auth/auth.service';
import { UploadsService } from '../uploads/uploads.service';
import { TranscriptsService } from '../transcripts/transcripts.service';
import type { SubmitTranscriptDto } from '../transcripts/dto/create-transcript.dto';
import { ClaimDto, LookupDto } from './intake.dto';
import { normaliseId, SOURCE_CONNECTORS, type SourceConnector, type SourceProfile, type SourceRecord } from './source-connector';

export type InviteChannel = 'link' | 'qr' | 'email' | 'partner_invite';

const GENERIC_REPLY = 'If we found a matching record we have emailed a secure link to that address.';
const SESSION_HOURS = 48;
const IP_LIMIT = { max: 5, windowMs: 15 * 60_000 };
const ID_LIMIT = { max: 3, windowMs: 60 * 60_000 };

interface SessionRow {
  Id: string;
  SourceProfileId: number;
  Email: string;
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);
  private readonly hits = new Map<string, number[]>();

  constructor(
    private db: DatabaseService,
    private schema: SchemaService,
    private email: EmailService,
    private auth: AuthService,
    private uploads: UploadsService,
    private transcripts: TranscriptsService,
    @Inject(SOURCE_CONNECTORS) private connectors: SourceConnector[],
  ) {}

  private async requireSchema() {
    if (!(await this.schema.has('IntakeSessions'))) {
      throw new ServiceUnavailableException('Student intake needs migration 019');
    }
  }

  private limit(key: string, rule: { max: number; windowMs: number }) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
    if (recent.length >= rule.max) {
      this.hits.set(key, recent);
      throw new HttpException('Too many attempts. Please wait a little while and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (!v.some((t) => now - t < 3_600_000)) this.hits.delete(k);
    }
  }

  private hash(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async findProfile(idNumber: string, email: string, universityCode?: string): Promise<SourceProfile | null> {
    for (const c of this.connectors) {
      const p = await c.find(idNumber, email, universityCode);
      if (p) return p;
    }
    return null;
  }

  private async loadRecord(profileId: number, withBytes: boolean): Promise<SourceRecord | null> {
    for (const c of this.connectors) {
      const r = await c.load(profileId, { withBytes });
      if (r) return r;
    }
    return null;
  }

  // ── lookup ────────────────────────────────────────────────────────

  /** Always answers the same way, so nobody can use it to find out whether an ID exists. */
  async lookup(dto: LookupDto, ip: string) {
    await this.requireSchema();
    this.limit(`ip:${ip}`, IP_LIMIT);
    this.limit(`id:${normaliseId(dto.idNumber)}|${dto.email.trim().toLowerCase()}`, ID_LIMIT);

    const body: { message: string; demo?: { claimUrl: string } } = { message: GENERIC_REPLY };
    const profile = await this.findProfile(dto.idNumber, dto.email, dto.universityCode);
    if (!profile) return body;

    const channel: InviteChannel = dto.channel ?? 'link';
    const { claimUrl } = await this.createSession(profile.id, channel, ip);
    try {
      await this.email.sendEmail(
        profile.email,
        templates.intakeInvite(this.email.context, { firstName: profile.firstName, institution: profile.institutionName, claimUrl }),
      );
    } catch (e) {
      this.logger.warn(`Intake invite email failed: ${(e as Error).message}`);
    }
    // A mock record's mailbox is fake, so the demo hands the link straight back.
    if (profile.isMock) body.demo = { claimUrl };
    return body;
  }

  async createSession(profileId: number, channel: InviteChannel, ip?: string) {
    await this.requireSchema();
    const profile = await this.db.query<{ Email: string }>(`SELECT Email FROM StudentSourceProfiles WHERE Id = @id AND IsActive = 1`, [
      { name: 'id', type: sql.Int, value: profileId },
    ]);
    if (!profile.recordset[0]) throw new NotFoundException('Source profile not found');

    const token = crypto.randomBytes(32).toString('hex');
    await this.db.query(`UPDATE IntakeSessions SET Status = 'expired' WHERE SourceProfileId = @p AND Status = 'open'`, [
      { name: 'p', type: sql.Int, value: profileId },
    ]);
    const res = await this.db.query<{ Id: string }>(
      `INSERT INTO IntakeSessions (SourceProfileId, Email, TokenHash, Channel, Status, ExpiresAt, RequestIp)
       OUTPUT inserted.Id
       VALUES (@p, @e, @h, @c, 'open', DATEADD(HOUR, ${SESSION_HOURS}, SYSUTCDATETIME()), @ip)`,
      [
        { name: 'p', type: sql.Int, value: profileId },
        { name: 'e', type: sql.NVarChar(254), value: profile.recordset[0].Email },
        { name: 'h', type: sql.NVarChar(128), value: this.hash(token) },
        { name: 'c', type: sql.VarChar(20), value: channel },
        { name: 'ip', type: sql.VarChar(64), value: ip ? ip.slice(0, 64) : null },
      ],
    );
    return { sessionId: res.recordset[0].Id, token, claimUrl: `${this.email.baseUrl}/intake/claim?token=${token}` };
  }

  /** Used by the partner import (and the admin invite button): email a claim link for a stored profile. */
  async sendInvite(sourceProfileId: number, channel: 'partner_invite' | 'email' = 'partner_invite'): Promise<{ sent: boolean }> {
    const record = await this.loadRecord(sourceProfileId, false);
    if (!record) throw new NotFoundException('Source profile not found');
    const { claimUrl } = await this.createSession(sourceProfileId, channel);
    const result = await this.email.sendEmail(
      record.profile.email,
      templates.intakeInvite(this.email.context, { firstName: record.profile.firstName, institution: record.profile.institutionName, claimUrl }),
    );
    return { sent: result?.ok !== false };
  }

  // ── session preview ───────────────────────────────────────────────

  private async openSession(token: string): Promise<SessionRow> {
    const res = await this.db.query<SessionRow>(
      `SELECT Id, SourceProfileId, Email FROM IntakeSessions WHERE TokenHash = @h AND Status = 'open' AND ExpiresAt > SYSUTCDATETIME()`,
      [{ name: 'h', type: sql.NVarChar(128), value: this.hash(token || '') }],
    );
    if (!res.recordset[0]) throw new BadRequestException('This link is invalid or has expired.');
    return res.recordset[0];
  }

  async getSession(token: string) {
    await this.requireSchema();
    const session = await this.openSession(token);
    const record = await this.loadRecord(session.SourceProfileId, false);
    if (!record) throw new BadRequestException('This link is invalid or has expired.');
    const p = record.profile;
    const unis = await this.db.query<{ Id: number; Code: string; Name: string }>(`SELECT Id, Code, Name FROM Institutions WHERE IsActive = 1 ORDER BY Name`);
    const exists = await this.db.query(`SELECT 1 AS X FROM Users WHERE Email = @e`, [{ name: 'e', type: sql.NVarChar(254), value: p.email }]);
    const idTail = p.externalId.slice(-3);
    return {
      profile: {
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        idType: p.idType,
        maskedId: `${'*'.repeat(Math.max(0, p.externalId.length - 3))}${idTail}`,
        institutionCode: p.institutionCode,
        institutionName: p.institutionName,
        programName: p.programName,
        degree: p.degree,
        fieldOfStudy: p.fieldOfStudy,
        gpa: p.gpa,
        graduationYear: p.graduationYear,
        creditsCompleted: p.creditsCompleted,
        country: p.country,
        phone: p.phone,
      },
      courses: record.courses,
      documents: record.documents.map((d) => ({ docType: d.docType, fileName: d.fileName })),
      universities: unis.recordset.map((u) => ({ id: u.Id, code: u.Code, name: u.Name })),
      accountExists: !!exists.recordset[0],
    };
  }

  // ── claim: the account is created only here ───────────────────────

  async claim(dto: ClaimDto, ip: string, userAgent = '') {
    await this.requireSchema();
    if (dto.consent !== true) throw new BadRequestException('You need to confirm the details and give consent to continue.');
    const session = await this.openSession(dto.token);

    // Take the session so two clicks cannot create two accounts.
    const lock = await this.db.query(`UPDATE IntakeSessions SET Status = 'claimed', ClaimedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 'open'`, [
      { name: 'id', type: sql.UniqueIdentifier, value: session.Id },
    ]);
    if (!lock.rowsAffected[0]) throw new BadRequestException('This link is invalid or has expired.');
    const reopen = () =>
      this.db
        .query(`UPDATE IntakeSessions SET Status = 'open', ClaimedAt = NULL, ClaimedUserId = NULL WHERE Id = @id`, [
          { name: 'id', type: sql.UniqueIdentifier, value: session.Id },
        ])
        .catch(() => undefined);

    let userId: string | null = null;
    try {
      const record = await this.loadRecord(session.SourceProfileId, true);
      if (!record) throw new BadRequestException('This link is invalid or has expired.');
      const p = record.profile;

      const existing = await this.db.query(`SELECT 1 AS X FROM Users WHERE Email = @e`, [{ name: 'e', type: sql.NVarChar(254), value: p.email }]);
      if (existing.recordset[0]) throw new ConflictException('You already have an account - please sign in.');
      if (dto.targetInstitutionId !== undefined) {
        const t = await this.db.query(`SELECT 1 AS X FROM Institutions WHERE Id = @i AND IsActive = 1`, [{ name: 'i', type: sql.Int, value: dto.targetInstitutionId }]);
        if (!t.recordset[0]) throw new BadRequestException('Please choose a valid target university.');
      }

      const roleRes = await this.db.query<{ Id: number }>(`SELECT Id FROM Roles WHERE Name = 'student'`);
      const roleId = roleRes.recordset[0]?.Id;
      if (!roleId) throw new NotFoundException('student role not found - has the DB been seeded?');

      // A student ID is only kept when nobody else already uses it.
      const sidTaken = await this.db.query(`SELECT 1 AS X FROM Users WHERE StudentId = @s`, [{ name: 's', type: sql.NVarChar(50), value: p.externalId.slice(0, 50) }]);
      const studentId = sidTaken.recordset[0] ? null : p.externalId.slice(0, 50);

      const hasVerified = await this.schema.has('Users', 'EmailVerified');
      const hash = await argon2.hash(dto.password);
      const userRes = await this.db.query<{ Id: string }>(
        `INSERT INTO Users (Email, PasswordHash, FirstName, LastName, RoleId, MustChangePass, StudentId, Mobile, City, State, Country, CountryOfOrigin${hasVerified ? ', EmailVerified' : ''})
         OUTPUT inserted.Id
         VALUES (@email, @hash, @first, @last, @roleId, 0, @sid, @mobile, @city, @state, @country, @origin${hasVerified ? ', 1' : ''})`,
        [
          { name: 'email', type: sql.NVarChar(254), value: p.email },
          { name: 'hash', type: sql.NVarChar(255), value: hash },
          { name: 'first', type: sql.NVarChar(100), value: p.firstName },
          { name: 'last', type: sql.NVarChar(100), value: p.lastName },
          { name: 'roleId', type: sql.Int, value: roleId },
          { name: 'sid', type: sql.NVarChar(50), value: studentId },
          { name: 'mobile', type: sql.NVarChar(30), value: (dto.mobile || p.phone || '').slice(0, 30) || null },
          { name: 'city', type: sql.NVarChar(100), value: p.city },
          { name: 'state', type: sql.NVarChar(100), value: p.state },
          { name: 'country', type: sql.NVarChar(100), value: p.country },
          { name: 'origin', type: sql.NVarChar(100), value: p.countryOfOrigin },
        ],
      );
      userId = userRes.recordset[0].Id;
      const uid = { name: 'u', type: sql.UniqueIdentifier, value: userId } as QueryInput;

      await this.db.query(
        `INSERT INTO StudentProfiles (UserId, TargetInstitutionId, PriorInstitutionName, HighestEducationLevel, FieldOfStudy, GPA, GraduationYear)
         VALUES (@u, @target, @prior, @level, @field, @gpa, @grad)`,
        [
          uid,
          { name: 'target', type: sql.Int, value: dto.targetInstitutionId ?? null },
          { name: 'prior', type: sql.NVarChar(200), value: p.institutionName },
          { name: 'level', type: sql.NVarChar(100), value: this.levelFrom(p.degree) },
          { name: 'field', type: sql.NVarChar(200), value: p.fieldOfStudy },
          { name: 'gpa', type: sql.Decimal(3, 2), value: p.gpa },
          { name: 'grad', type: sql.Int, value: p.graduationYear },
        ],
      );
      if (await this.schema.policyReady()) {
        await this.db.query(
          `UPDATE StudentProfiles SET ApplicantType = 'transfer_applicant', AdmissionStatus = 'applicant', CreditsCompleted = @cred, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @u`,
          [uid, { name: 'cred', type: sql.Decimal(6, 2), value: p.creditsCompleted }],
        );
      }
      if (await this.schema.has('StudentEducation')) {
        const outside = !!p.country && !/^(us|usa|united states( of america)?)$/i.test(p.country.trim());
        await this.db.query(
          `INSERT INTO StudentEducation (UserId, InstitutionName, City, StateRegion, Country, IsOutsideUS, FromYear, ToYear, CreditsEarned, FullTime, SortOrder)
           VALUES (@u, @n, @c, @s, @co, @os, @f, @t, @cr, 1, 0)`,
          [
            uid,
            { name: 'n', type: sql.NVarChar(200), value: p.institutionName },
            { name: 'c', type: sql.NVarChar(100), value: p.city },
            { name: 's', type: sql.NVarChar(100), value: p.state },
            { name: 'co', type: sql.NVarChar(100), value: p.country },
            { name: 'os', type: sql.Bit, value: outside ? 1 : 0 },
            { name: 'f', type: sql.Int, value: p.graduationYear ? p.graduationYear - 2 : null },
            { name: 't', type: sql.Int, value: p.graduationYear },
            { name: 'cr', type: sql.Decimal(6, 2), value: p.creditsCompleted },
          ],
        );
      }

      // Documents go to the student's own blob folder, tagged with their type.
      let documentsSaved = 0;
      let documentsFailed = 0;
      let transcriptUploadId: string | undefined;
      for (const d of record.documents) {
        if (!d.bytes.length) continue;
        try {
          const saved = await this.uploads.save(
            { originalname: d.fileName, buffer: d.bytes, mimetype: d.mimeType, size: d.bytes.length },
            { ownerUserId: userId, role: 'student', entityType: 'intake', entityId: String(p.id), isPublic: false, documentType: d.docType },
          );
          documentsSaved++;
          if (d.docType === 'transcript' && !transcriptUploadId) transcriptUploadId = saved.id;
        } catch (e) {
          documentsFailed++;
          this.logger.warn(`Intake document "${d.fileName}" was not saved: ${(e as Error).message}`);
        }
      }

      await this.db.query(`UPDATE IntakeSessions SET ClaimedUserId = @u WHERE Id = @id`, [uid, { name: 'id', type: sql.UniqueIdentifier, value: session.Id }]);
      await this.db
        .query(
          `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, IpAddress, UserAgent)
           VALUES (@u, @e, 'student', 'STUDENT_INTAKE_CLAIMED', 'User', @eid, @ip, @ua)`,
          [
            uid,
            { name: 'e', type: sql.NVarChar(254), value: p.email },
            { name: 'eid', type: sql.NVarChar(100), value: userId },
            { name: 'ip', type: sql.VarChar(64), value: ip.slice(0, 64) },
            { name: 'ua', type: sql.NVarChar(500), value: userAgent.slice(0, 500) },
          ],
        )
        .catch(() => undefined);

      // The account exists from here on; what follows never undoes it.
      let transcriptId: string | undefined;
      let evaluationError: string | undefined;
      if (dto.submitForEvaluation && record.courses.length > 0) {
        try {
          const submit: SubmitTranscriptDto = {
            institutionName: p.institutionName,
            institutionCode: p.institutionCode,
            calendar: ['semester', 'quarter', 'trimester'].includes(p.calendar) ? p.calendar : 'semester',
            studentName: `${p.firstName} ${p.lastName}`,
            studentId: p.externalId,
            notes: 'Imported from the student record via TransferHub intake',
            documentUploadId: transcriptUploadId,
            courses: record.courses.map((c) => ({
              courseCode: c.courseCode,
              courseTitle: c.courseTitle,
              originalCredits: c.credits,
              grade: c.grade,
              term: c.term ?? undefined,
            })),
          };
          const created = await this.transcripts.submit(submit, userId, 'student');
          transcriptId = (created as { id?: string }).id;
        } catch (e) {
          evaluationError = (e as Error).message;
          this.logger.warn(`Intake evaluation submit failed for ${userId}: ${evaluationError}`);
        }
      }

      try {
        await this.email.sendWelcome(p.email, p.firstName);
      } catch {
        // best effort
      }

      const login = await this.auth.login(
        { id: userId, email: p.email, firstName: p.firstName, lastName: p.lastName, role: 'student', departmentId: null },
        ip,
        userAgent,
      );
      return { ...login, documentsSaved, documentsFailed, transcriptId, evaluationError };
    } catch (err) {
      if (userId) await this.rollback(userId);
      await reopen();
      throw err;
    }
  }

  private levelFrom(degree: string | null): string | null {
    if (!degree) return 'High School';
    if (/^(aa|as|aas|associate)/i.test(degree)) return "Associate's";
    if (/^(ba|bs|b\.|bachelor|beng|bsc)/i.test(degree)) return "Bachelor's";
    if (/^(ma|ms|m\.|master|msc|mba)/i.test(degree)) return "Master's";
    return 'Other';
  }

  /** Removes a half-created student so the link can be used again (blobs already written stay orphaned). */
  private async rollback(userId: string) {
    const p = [{ name: 'u', type: sql.UniqueIdentifier, value: userId }];
    for (const stmt of [
      `DELETE FROM Uploads WHERE OwnerUserId = @u`,
      `DELETE FROM StudentExamCredits WHERE UserId = @u`,
      `DELETE FROM StudentEducation WHERE UserId = @u`,
      `DELETE FROM StudentProfiles WHERE UserId = @u`,
      `DELETE FROM Users WHERE Id = @u`,
    ]) {
      try {
        await this.db.query(stmt, p);
      } catch (e) {
        this.logger.warn(`Intake rollback step failed (${stmt.slice(0, 40)}): ${(e as Error).message}`);
      }
    }
  }

  // ── admin ─────────────────────────────────────────────────────────

  async adminOverview() {
    const ready = await this.schema.has('IntakeSessions');
    const base = { shareUrl: `${this.email.baseUrl}/intake` };
    if (!ready) {
      return { ...base, ready: false, counts: { profiles: 0, mockProfiles: 0, openSessions: 0, claimed: 0 }, demoProfiles: [], recentSessions: [] };
    }
    const counts = await this.db.query<{ profiles: number; mockProfiles: number; openSessions: number; claimed: number }>(
      `SELECT (SELECT COUNT(*) FROM StudentSourceProfiles) AS profiles,
              (SELECT COUNT(*) FROM StudentSourceProfiles WHERE IsMock = 1) AS mockProfiles,
              (SELECT COUNT(*) FROM IntakeSessions WHERE Status = 'open' AND ExpiresAt > SYSUTCDATETIME()) AS openSessions,
              (SELECT COUNT(*) FROM IntakeSessions WHERE Status = 'claimed') AS claimed`,
    );
    const demo = await this.db.query(
      `SELECT TOP 50 p.Id AS id, p.ExternalId AS externalId, p.IdType AS idType, p.Email AS email, p.InstitutionCode AS institutionCode,
              p.FirstName AS firstName, p.LastName AS lastName,
              CAST(CASE WHEN EXISTS (SELECT 1 FROM IntakeSessions s WHERE s.SourceProfileId = p.Id AND s.Status = 'claimed') THEN 1 ELSE 0 END AS BIT) AS claimed
       FROM StudentSourceProfiles p WHERE p.IsMock = 1 ORDER BY p.Id`,
    );
    const recent = await this.db.query(
      `SELECT TOP 20 s.Id AS id, s.Email AS email, s.Channel AS channel, s.Status AS status, s.CreatedAt AS createdAt, s.ClaimedAt AS claimedAt,
              p.InstitutionCode AS institutionCode
       FROM IntakeSessions s JOIN StudentSourceProfiles p ON p.Id = s.SourceProfileId ORDER BY s.CreatedAt DESC`,
    );
    return { ...base, ready: true, counts: counts.recordset[0], demoProfiles: demo.recordset, recentSessions: recent.recordset };
  }
}
