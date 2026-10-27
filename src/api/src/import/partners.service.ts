import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as sql from 'mssql';
import { DatabaseService, type QueryInput } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';

export interface PartnerContext {
  partnerId: number;
  keyId: number;
  universityName: string;
  universityCode: string;
  contactName: string;
  contactEmail: string;
}

interface PartnerRow {
  Id: number;
  UniversityName: string;
  UniversityCode: string;
  ContactName: string;
  ContactEmail: string;
  ContactPhone: string | null;
  Website: string | null;
  Notes: string | null;
  IsActive: boolean;
  CreatedAt: Date;
}

interface KeyRow {
  Id: number;
  PartnerId: number;
  Label: string;
  KeyPrefix: string;
  IsActive: boolean;
  ExpiresAt: Date | null;
  LastUsedAt: Date | null;
  CreatedAt: Date;
  RevokedAt: Date | null;
}

export interface PartnerInput {
  universityName: string;
  universityCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class PartnersService {
  constructor(private db: DatabaseService, private email: EmailService) {}

  get endpointBase(): string {
    return `${this.email.baseUrl.replace(/\/$/, '')}/api/public/v1`;
  }

  private generateKey() {
    const key = `th_live_${randomBytes(24).toString('base64url')}`;
    return { key, prefix: key.slice(0, 12), hash: sha256(key) };
  }

  private mapPartner(p: PartnerRow, keys: KeyRow[], batches: { total: number; open: number; last: Date | null }) {
    return {
      id: p.Id,
      universityName: p.UniversityName,
      universityCode: p.UniversityCode,
      contactName: p.ContactName,
      contactEmail: p.ContactEmail,
      contactPhone: p.ContactPhone,
      website: p.Website,
      notes: p.Notes,
      isActive: !!p.IsActive,
      createdAt: p.CreatedAt,
      submissions: batches.total,
      openSubmissions: batches.open,
      lastSubmissionAt: batches.last,
      keys: keys.map((k) => ({
        id: k.Id,
        label: k.Label,
        prefix: k.KeyPrefix,
        isActive: !!k.IsActive && !k.RevokedAt && (!k.ExpiresAt || k.ExpiresAt > new Date()),
        revoked: !!k.RevokedAt,
        expiresAt: k.ExpiresAt,
        lastUsedAt: k.LastUsedAt,
        createdAt: k.CreatedAt,
      })),
    };
  }

  async list() {
    const partners = await this.db.query<PartnerRow>(`SELECT * FROM DataPartners ORDER BY IsActive DESC, UniversityName`);
    const keys = await this.db.query<KeyRow>(`SELECT * FROM PartnerApiKeys ORDER BY CreatedAt DESC`);
    // OPEN is a reserved word in T-SQL, so the waiting count is aliased OpenCount.
    const counts = await this.db.query<{ PartnerId: number; Total: number; OpenCount: number; Last: Date | null }>(
      `SELECT PartnerId, COUNT(*) AS Total, SUM(CASE WHEN Status IN ('pending','partial') THEN 1 ELSE 0 END) AS OpenCount, MAX(SubmittedAt) AS Last
       FROM ImportBatches WHERE PartnerId IS NOT NULL GROUP BY PartnerId`,
    );
    return partners.recordset.map((p) => {
      const c = counts.recordset.find((x) => x.PartnerId === p.Id);
      return this.mapPartner(
        p,
        keys.recordset.filter((k) => k.PartnerId === p.Id),
        { total: c?.Total ?? 0, open: c?.OpenCount ?? 0, last: c?.Last ?? null },
      );
    });
  }

  private async load(id: number) {
    const r = await this.db.query<PartnerRow>(`SELECT * FROM DataPartners WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    if (!r.recordset[0]) throw new NotFoundException('Partner not found');
    return r.recordset[0];
  }

  async create(dto: PartnerInput & { emailKey?: boolean }, userId: string) {
    const code = dto.universityCode.trim();
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) throw new BadRequestException('University code may use letters, numbers, - and _ (max 20).');
    const res = await this.db.query<{ Id: number }>(
      `INSERT INTO DataPartners (UniversityName, UniversityCode, ContactName, ContactEmail, ContactPhone, Website, Notes, CreatedBy)
       OUTPUT inserted.Id
       VALUES (@n, @c, @cn, @ce, @cp, @w, @no, @u)`,
      [
        { name: 'n', type: sql.NVarChar(200), value: dto.universityName.trim() },
        { name: 'c', type: sql.VarChar(20), value: code },
        { name: 'cn', type: sql.NVarChar(150), value: dto.contactName.trim() },
        { name: 'ce', type: sql.NVarChar(256), value: dto.contactEmail.trim() },
        { name: 'cp', type: sql.NVarChar(40), value: dto.contactPhone?.trim() || null },
        { name: 'w', type: sql.NVarChar(300), value: dto.website?.trim() || null },
        { name: 'no', type: sql.NVarChar(1000), value: dto.notes?.trim() || null },
        { name: 'u', type: sql.UniqueIdentifier, value: userId },
      ],
    );
    const partnerId = res.recordset[0].Id;
    const issued = await this.issueKey(partnerId, { label: 'Default' }, userId, !!dto.emailKey);
    return { partnerId, ...issued };
  }

  async update(id: number, dto: Partial<PartnerInput>) {
    await this.load(id);
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const inputs: QueryInput[] = [{ name: 'id', type: sql.Int, value: id }];
    const set = (col: string, name: string, type: sql.ISqlType, v: string | undefined, nullable = false) => {
      if (v === undefined) return;
      sets.push(`${col} = @${name}`);
      inputs.push({ name, type, value: v.trim() || (nullable ? null : v.trim()) });
    };
    set('UniversityName', 'n', sql.NVarChar(200), dto.universityName);
    if (dto.universityCode !== undefined) {
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(dto.universityCode.trim())) throw new BadRequestException('University code may use letters, numbers, - and _ (max 20).');
      set('UniversityCode', 'c', sql.VarChar(20), dto.universityCode);
    }
    set('ContactName', 'cn', sql.NVarChar(150), dto.contactName);
    set('ContactEmail', 'ce', sql.NVarChar(256), dto.contactEmail);
    set('ContactPhone', 'cp', sql.NVarChar(40), dto.contactPhone, true);
    set('Website', 'w', sql.NVarChar(300), dto.website, true);
    set('Notes', 'no', sql.NVarChar(1000), dto.notes, true);
    await this.db.query(`UPDATE DataPartners SET ${sets.join(', ')} WHERE Id = @id`, inputs);
    return { message: 'Partner updated' };
  }

  private async audit(userId: string | undefined, action: string, partnerId: number, detail: Record<string, unknown>) {
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, Action, EntityType, EntityId, NewValue, OccurredAt)
         VALUES (@u, @a, 'DataPartner', @e, @v, SYSUTCDATETIME())`,
        [
          { name: 'u', type: sql.UniqueIdentifier, value: userId ?? null },
          { name: 'a', type: sql.NVarChar(100), value: action },
          { name: 'e', type: sql.NVarChar(100), value: String(partnerId) },
          { name: 'v', type: sql.NVarChar(sql.MAX), value: JSON.stringify(detail) },
        ],
      );
    } catch {
      /* auditing must never block the action itself */
    }
  }

  /** Hard delete, only when nothing references the partner. Its API keys go with it (FK cascade). */
  async remove(id: number, userId?: string) {
    const p = await this.load(id);
    const used = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM ImportBatches WHERE PartnerId = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    const n = used.recordset[0]?.N ?? 0;
    if (n > 0) {
      throw new BadRequestException(`${p.UniversityName} has ${n} submission(s) on record, so it cannot be deleted. Deactivate it instead - that disables its keys and keeps the history.`);
    }
    await this.db.query(`DELETE FROM PartnerApiKeys WHERE PartnerId = @id; DELETE FROM DataPartners WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    await this.audit(userId, 'PARTNER_DELETED', id, { universityName: p.UniversityName, universityCode: p.UniversityCode });
    return { message: 'Partner deleted' };
  }

  /** Applies one action to several partners; reports per-partner success so a refused delete does not hide the rest. */
  async bulk(ids: number[], action: 'activate' | 'deactivate' | 'delete', userId?: string) {
    const results: { id: number; ok: boolean; message: string }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const r = action === 'delete' ? await this.remove(id, userId) : await this.setActive(id, action === 'activate', userId);
        results.push({ id, ok: true, message: r.message });
      } catch (e) {
        results.push({ id, ok: false, message: (e as { message?: string }).message ?? 'Failed' });
      }
    }
    return { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  async setActive(id: number, active: boolean, userId?: string) {
    await this.load(id);
    await this.db.query(`UPDATE DataPartners SET IsActive = @a, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'a', type: sql.Bit, value: active ? 1 : 0 },
      { name: 'id', type: sql.Int, value: id },
    ]);
    await this.audit(userId, active ? 'PARTNER_ACTIVATED' : 'PARTNER_DEACTIVATED', id, {});
    return { message: active ? 'Partner reactivated' : 'Partner deactivated - their keys no longer work' };
  }

  /** Creates a key. The plaintext is returned exactly once and never stored. */
  async issueKey(partnerId: number, opts: { label?: string; expiresInDays?: number }, userId: string, emailKey: boolean) {
    const partner = await this.load(partnerId);
    const { key, prefix, hash } = this.generateKey();
    const expires = opts.expiresInDays && opts.expiresInDays > 0 ? opts.expiresInDays : null;
    await this.db.query(
      `INSERT INTO PartnerApiKeys (PartnerId, Label, KeyPrefix, KeyHash, ExpiresAt, CreatedBy)
       VALUES (@p, @l, @pre, @h, CASE WHEN @e IS NULL THEN NULL ELSE DATEADD(DAY, @e, SYSUTCDATETIME()) END, @u)`,
      [
        { name: 'p', type: sql.Int, value: partnerId },
        { name: 'l', type: sql.NVarChar(100), value: (opts.label || 'Default').trim() },
        { name: 'pre', type: sql.VarChar(16), value: prefix },
        { name: 'h', type: sql.Char(64), value: hash },
        { name: 'e', type: sql.Int, value: expires },
        { name: 'u', type: sql.UniqueIdentifier, value: userId },
      ],
    );
    let emailed = false;
    if (emailKey) {
      emailed = (await this.sendOnboardingEmail(partner, key)).ok;
    }
    return { apiKey: key, prefix, endpoint: `${this.endpointBase}/submissions`, emailed, instructions: this.instructions(partner.UniversityCode, key) };
  }

  async revokeKey(partnerId: number, keyId: number, userId?: string) {
    const r = await this.db.query(
      `UPDATE PartnerApiKeys SET IsActive = 0, RevokedAt = SYSUTCDATETIME() WHERE Id = @k AND PartnerId = @p AND RevokedAt IS NULL`,
      [
        { name: 'k', type: sql.Int, value: keyId },
        { name: 'p', type: sql.Int, value: partnerId },
      ],
    );
    if (!r.rowsAffected[0]) throw new NotFoundException('Key not found or already revoked');
    await this.audit(userId, 'PARTNER_KEY_REVOKED', partnerId, { keyId });
    return { message: 'Key revoked' };
  }

  /** Resolves an API key to its partner, or null. Also stamps last-used. */
  async authenticate(rawKey: string, ip: string): Promise<PartnerContext | null> {
    if (!rawKey || rawKey.length < 20 || rawKey.length > 200) return null;
    const r = await this.db.query<{ KeyId: number } & Omit<PartnerRow, 'Id'> & { PartnerId: number }>(
      `SELECT k.Id AS KeyId, p.Id AS PartnerId, p.UniversityName, p.UniversityCode, p.ContactName, p.ContactEmail
       FROM PartnerApiKeys k JOIN DataPartners p ON p.Id = k.PartnerId
       WHERE k.KeyHash = @h AND k.IsActive = 1 AND k.RevokedAt IS NULL AND p.IsActive = 1
         AND (k.ExpiresAt IS NULL OR k.ExpiresAt > SYSUTCDATETIME())`,
      [{ name: 'h', type: sql.Char(64), value: sha256(rawKey) }],
    );
    const row = r.recordset[0];
    if (!row) return null;
    void this.db
      .query(`UPDATE PartnerApiKeys SET LastUsedAt = SYSUTCDATETIME(), LastUsedIp = @ip WHERE Id = @id`, [
        { name: 'ip', type: sql.VarChar(64), value: ip.slice(0, 64) },
        { name: 'id', type: sql.Int, value: row.KeyId },
      ])
      .catch(() => undefined);
    return {
      partnerId: row.PartnerId,
      keyId: row.KeyId,
      universityName: row.UniversityName,
      universityCode: row.UniversityCode,
      contactName: row.ContactName,
      contactEmail: row.ContactEmail,
    };
  }

  /** The copy-paste text a super admin hands to the partner. */
  instructions(universityCode: string, key: string): string {
    const base = this.endpointBase;
    return [
      `TransferHub data submission API`,
      ``,
      `Endpoint : POST ${base}/submissions`,
      `API key  : ${key}`,
      `Header   : X-API-Key: <your key>   (keep the key secret; it is shown only once)`,
      ``,
      `Example:`,
      `curl -X POST ${base}/submissions \\`,
      `  -H "X-API-Key: ${key}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"note":"Catalogue update","courses":[{"universityCode":"${universityCode}","code":"CS101","name":"Intro to Computing","credits":3}]}'`,
      ``,
      `No coding? Upload an Excel or JSON file instead at ${this.email.baseUrl.replace(/\/$/, '')}/partner (sign in with this key).`,
      ``,
      `Format guide : GET ${base}/format`,
      `Check status : GET ${base}/submissions/<reference>   (same X-API-Key header)`,
      ``,
      `Submissions are reviewed by a TransferHub administrator before anything is added.`,
      `You will receive an email report when your data has been processed.`,
    ].join('\n');
  }

  private async sendOnboardingEmail(partner: PartnerRow, key: string) {
    return this.email.sendEmail(partner.ContactEmail, templates.partnerAccess(this.email.context, {
      contactName: partner.ContactName, university: partner.UniversityName, code: partner.UniversityCode,
      endpoint: `${this.endpointBase}/submissions`, instructions: this.instructions(partner.UniversityCode, key),
    }));
  }
}
