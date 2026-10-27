import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { DEMO_FALLBACK_EMAILS, DEMO_LOGIN_DEFAULTS, DemoLoginSettings, DemoLoginUser, parseFlag, parseUsers, PublicDemoLogin } from './demo-login.logic';

const KEY_ENABLED = 'demo_login.enabled';
const KEY_USERS = 'demo_login.users';

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
          { name: 'b', type: sql.VarChar(100), value: KEY_USERS },
        ],
      );
      const m = new Map(r.recordset.map((x) => [x.SettingKey, x.SettingValue]));
      return { enabled: parseFlag(m.get(KEY_ENABLED)), users: parseUsers(m.get(KEY_USERS)), ready: true };
    } catch {
      return { ...DEMO_LOGIN_DEFAULTS, ready: false };
    }
  }

  /** The super admin's picks, resolved to names, plus the enabled flag — for the settings screen. */
  async getDemoLoginAdmin() {
    const s = await this.getDemoLogin();
    return { ...s, resolved: await this.resolveDemoUsers(s.users) };
  }

  /** Saves the enabled flag and the per-role user picks. */
  async saveDemoLogin(input: DemoLoginSettings, by: { id: string; email: string; role: string }, ip?: string) {
    if (!(await this.schema.has('AppSettings'))) {
      throw new ServiceUnavailableException('Migration 023 (AppSettings) has not been applied yet.');
    }
    const before = await this.getDemoLogin();
    const users = parseUsers(JSON.stringify(input.users ?? {}));
    const next: DemoLoginSettings = { enabled: input.enabled, users };
    for (const [key, val] of [[KEY_ENABLED, next.enabled ? '1' : '0'], [KEY_USERS, JSON.stringify(next.users)]] as const) {
      await this.db.query(
        `MERGE AppSettings AS t
         USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
         WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @by
         WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@k, @v, @by);`,
        [
          { name: 'k', type: sql.VarChar(100), value: key },
          { name: 'v', type: sql.NVarChar(1000), value: val },
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
          { name: 'old', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ enabled: before.enabled, users: before.users }) },
          { name: 'new', type: sql.NVarChar(sql.MAX), value: JSON.stringify(next) },
          { name: 'ip', type: sql.NVarChar(45), value: ip ? ip.slice(0, 45) : null },
        ],
      );
    } catch {
      // auditing must never undo the change itself
    }
    return { ...next, ready: true, resolved: await this.resolveDemoUsers(next.users) };
  }

  /** Public login-page payload. Cached <=10s; per-IP limit 60/min. Never sends passwords. Failure -> disabled. */
  async publicDemoLogin(ip: string): Promise<PublicDemoLogin> {
    this.checkRate(ip);
    const now = Date.now();
    if (this.publicCache && now - this.publicCache.at < 10_000) return this.publicCache.value;
    const s = await this.getDemoLogin();
    const value: PublicDemoLogin = s.enabled ? { enabled: true, users: await this.activeDemoUsers(s.users) } : { enabled: false };
    this.publicCache = { at: now, value };
    return value;
  }

  /**
   * The demo accounts actually offered: the super admin's picks, or (if none picked) the seed demo
   * accounts as a fallback so the login page still works out of the box. Names resolved from Users.
   */
  async activeDemoUsers(configured: Record<string, string>): Promise<DemoLoginUser[]> {
    const ids = Object.values(configured);
    if (ids.length) return this.resolveDemoUsers(configured);
    // Fallback: the seed accounts, resolved by email to their real user ids.
    try {
      const rows = await this.db.query<{ Id: string; Name: string; Role: string }>(
        `SELECT u.Id, u.FirstName + ' ' + u.LastName AS Name, r.Name AS Role
         FROM Users u JOIN Roles r ON r.Id = u.RoleId
         WHERE u.Email IN (${DEMO_FALLBACK_EMAILS.map((_, i) => `@e${i}`).join(', ')}) AND u.IsActive = 1`,
        DEMO_FALLBACK_EMAILS.map((e, i) => ({ name: `e${i}`, type: sql.NVarChar(254), value: e })),
      );
      return rows.recordset.map((x) => ({ userId: x.Id, label: x.Name, role: x.Role }));
    } catch {
      return [];
    }
  }

  /** Resolve a role->userId map to display rows (skips any id that no longer exists / is inactive). */
  private async resolveDemoUsers(configured: Record<string, string>): Promise<DemoLoginUser[]> {
    const ids = Object.values(configured);
    if (!ids.length) return [];
    try {
      const rows = await this.db.query<{ Id: string; Name: string; Role: string }>(
        `SELECT u.Id, u.FirstName + ' ' + u.LastName AS Name, r.Name AS Role
         FROM Users u JOIN Roles r ON r.Id = u.RoleId
         WHERE u.Id IN (${ids.map((_, i) => `@u${i}`).join(', ')}) AND u.IsActive = 1`,
        ids.map((id, i) => ({ name: `u${i}`, type: sql.UniqueIdentifier, value: id })),
      );
      const byId = new Map(rows.recordset.map((x) => [String(x.Id).toLowerCase(), x]));
      // Preserve the role order the super admin configured.
      return Object.entries(configured)
        .map(([role, id]) => {
          const u = byId.get(String(id).toLowerCase());
          return u ? { userId: u.Id, label: u.Name, role: u.Role || role } : null;
        })
        .filter((x): x is DemoLoginUser => !!x);
    } catch {
      return [];
    }
  }

  /** Guard for the public demo-login endpoint: enabled AND the id is one of the offered accounts. */
  async isDemoLoginAllowed(userId: string, ip: string): Promise<boolean> {
    this.checkRate(ip);
    const s = await this.getDemoLogin();
    if (!s.enabled) return false;
    const offered = await this.activeDemoUsers(s.users);
    return offered.some((u) => String(u.userId).toLowerCase() === String(userId).toLowerCase());
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
