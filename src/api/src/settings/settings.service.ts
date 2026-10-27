import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { buildPublicDemoLogin, DEMO_LOGIN_DEFAULTS, DemoLoginSettings, parseFlag, PublicDemoLogin } from './demo-login.logic';

const KEY_ENABLED = 'demo_login.enabled';
const KEY_CREDS = 'demo_login.show_credentials';

@Injectable()
export class SettingsService {
  private publicCache: { at: number; value: PublicDemoLogin } | null = null;
  private hits = new Map<string, { n: number; reset: number }>();

  constructor(private db: DatabaseService, private schema: SchemaService) {}

  /** Stored settings; hidden defaults when migration 023 is not applied or the read fails. */
  async getDemoLogin(): Promise<DemoLoginSettings & { ready: boolean }> {
    if (!(await this.schema.has('AppSettings'))) return { ...DEMO_LOGIN_DEFAULTS, ready: false };
    try {
      const r = await this.db.query<{ SettingKey: string; SettingValue: string | null }>(
        `SELECT SettingKey, SettingValue FROM AppSettings WHERE SettingKey IN (@a, @b)`,
        [
          { name: 'a', type: sql.VarChar(100), value: KEY_ENABLED },
          { name: 'b', type: sql.VarChar(100), value: KEY_CREDS },
        ],
      );
      const m = new Map(r.recordset.map((x) => [x.SettingKey, x.SettingValue]));
      return { enabled: parseFlag(m.get(KEY_ENABLED)), showCredentials: parseFlag(m.get(KEY_CREDS)), ready: true };
    } catch {
      return { ...DEMO_LOGIN_DEFAULTS, ready: false };
    }
  }

  /** Returns the saved settings. `showCredentials` is forced off when the box is off (cannot be misconfigured). */
  async saveDemoLogin(input: DemoLoginSettings, by: { id: string; email: string; role: string }, ip?: string) {
    if (!(await this.schema.has('AppSettings'))) {
      throw new ServiceUnavailableException('Migration 023 (AppSettings) has not been applied yet.');
    }
    const before = await this.getDemoLogin();
    const next: DemoLoginSettings = { enabled: input.enabled, showCredentials: input.enabled && input.showCredentials };
    for (const [key, val] of [[KEY_ENABLED, next.enabled], [KEY_CREDS, next.showCredentials]] as const) {
      await this.db.query(
        `MERGE AppSettings AS t
         USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
         WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @by
         WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@k, @v, @by);`,
        [
          { name: 'k', type: sql.VarChar(100), value: key },
          { name: 'v', type: sql.NVarChar(1000), value: val ? '1' : '0' },
          { name: 'by', type: sql.NVarChar(254), value: by.email },
        ],
      );
    }
    this.publicCache = null;
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, OldValue, NewValue, IpAddress)
         VALUES (@uid, @email, @role, 'DEMO_LOGIN_SETTINGS_CHANGED', 'AppSettings', 'demo_login', @old, @new, @ip)`,
        [
          { name: 'uid', type: sql.UniqueIdentifier, value: by.id },
          { name: 'email', type: sql.NVarChar(254), value: by.email },
          { name: 'role', type: sql.VarChar(20), value: by.role },
          { name: 'old', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ enabled: before.enabled, showCredentials: before.showCredentials }) },
          { name: 'new', type: sql.NVarChar(sql.MAX), value: JSON.stringify(next) },
          { name: 'ip', type: sql.NVarChar(45), value: ip ? ip.slice(0, 45) : null },
        ],
      );
    } catch {
      // auditing must never undo the change itself
    }
    return { ...next, ready: true };
  }

  /** Public login-page payload. Cached <=10s; per-IP limit 60/min. Never logs passwords. Failure -> disabled. */
  async publicDemoLogin(ip: string): Promise<PublicDemoLogin> {
    this.checkRate(ip);
    const now = Date.now();
    if (this.publicCache && now - this.publicCache.at < 10_000) return this.publicCache.value;
    const s = await this.getDemoLogin();
    const value = buildPublicDemoLogin(s);
    this.publicCache = { at: now, value };
    return value;
  }

  private checkRate(ip: string) {
    const now = Date.now();
    const h = this.hits.get(ip);
    if (!h || h.reset < now) {
      if (this.hits.size > 5000) this.hits.clear();
      this.hits.set(ip, { n: 1, reset: now + 60_000 });
      return;
    }
    h.n += 1;
    if (h.n > 60) {
      throw new HttpException('Too many requests', 429);
    }
  }
}
