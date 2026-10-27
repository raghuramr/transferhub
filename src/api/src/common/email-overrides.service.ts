import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { sanitizeOverride, setTemplateOverrides, type TemplateOverride } from './email-templates';

const PREFIX = 'email.template.';
/** AppSettings.SettingValue is NVARCHAR(1000) and no migration is allowed, so longer JSON is split over `~n` keys. */
const CHUNK = 900;
const MAX_JSON = 6000;
const KEY_RE = /^email\.template\.([A-Za-z]+)(?:~(\d+))?$/;

export interface Actor { id: string; email: string; role: string }

/**
 * Stores per-template text overrides in AppSettings (`email.template.<key>`) and keeps the
 * in-process copy used by `templates.*` fresh: loaded at start, refreshed every minute (other
 * App Service instances pick up changes then) and immediately after a save/reset on this one.
 */
@Injectable()
export class EmailOverridesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOverridesService.name);
  private timer?: NodeJS.Timeout;

  constructor(private db: DatabaseService, private schema: SchemaService) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async ready(): Promise<boolean> {
    return this.schema.has('AppSettings');
  }

  /** Reads every stored override; an unreadable one is skipped (the coded text is used). */
  async loadAll(): Promise<Map<string, TemplateOverride>> {
    const out = new Map<string, TemplateOverride>();
    if (!(await this.ready())) return out;
    const r = await this.db.query<{ SettingKey: string; SettingValue: string | null }>(
      `SELECT SettingKey, SettingValue FROM AppSettings WHERE SettingKey LIKE 'email.template.%'`,
    );
    const parts = new Map<string, string[]>();
    for (const row of r.recordset) {
      const m = KEY_RE.exec(row.SettingKey);
      if (!m) continue;
      const arr = parts.get(m[1]) ?? [];
      arr[m[2] ? Number(m[2]) : 0] = row.SettingValue ?? '';
      parts.set(m[1], arr);
    }
    for (const [key, arr] of parts) {
      try {
        const o = JSON.parse(Array.from(arr, (x) => x ?? '').join('')) as TemplateOverride;
        if (o && typeof o === 'object') out.set(key, o);
      } catch {
        this.logger.warn(`Ignoring unreadable e-mail override for ${key}`);
      }
    }
    return out;
  }

  async refresh(): Promise<void> {
    try {
      setTemplateOverrides(await this.loadAll());
    } catch (e) {
      this.logger.warn(`Could not load e-mail overrides: ${(e as Error).message}`);
    }
  }

  async save(key: string, input: TemplateOverride, by: Actor, ip?: string): Promise<TemplateOverride> {
    if (!(await this.ready())) throw new ServiceUnavailableException('Migration 023 (AppSettings) has not been applied yet.');
    let clean: TemplateOverride;
    try {
      clean = sanitizeOverride(key, input);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const before = (await this.loadAll()).get(key) ?? null;
    if (!Object.keys(clean).length) {
      await this.remove(key, by, ip);
      return {};
    }
    const json = JSON.stringify(clean);
    if (json.length > MAX_JSON) throw new BadRequestException('This template is too long to store. Shorten the text.');
    const names: string[] = [];
    for (let i = 0; i * CHUNK < json.length; i++) {
      const name = i === 0 ? `${PREFIX}${key}` : `${PREFIX}${key}~${i}`;
      names.push(name);
      await this.db.query(
        `MERGE AppSettings AS t
         USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
         WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @by
         WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@k, @v, @by);`,
        [
          { name: 'k', type: sql.VarChar(100), value: name },
          { name: 'v', type: sql.NVarChar(1000), value: json.slice(i * CHUNK, (i + 1) * CHUNK) },
          { name: 'by', type: sql.NVarChar(254), value: by.email },
        ],
      );
    }
    // Drop chunks left over from a longer previous version.
    await this.db.query(
      `DELETE FROM AppSettings WHERE SettingKey LIKE @p AND SettingKey NOT IN (${names.map((_, i) => `@n${i}`).join(', ')})`,
      [
        { name: 'p', type: sql.VarChar(100), value: `${PREFIX}${key}~%` },
        ...names.map((n, i) => ({ name: `n${i}`, type: sql.VarChar(100), value: n })),
      ],
    );
    await this.refresh();
    await this.audit('EMAIL_TEMPLATE_CHANGED', key, before, clean, by, ip);
    return clean;
  }

  async remove(key: string, by: Actor, ip?: string): Promise<void> {
    if (!(await this.ready())) throw new ServiceUnavailableException('Migration 023 (AppSettings) has not been applied yet.');
    const before = (await this.loadAll()).get(key) ?? null;
    await this.db.query(
      `DELETE FROM AppSettings WHERE SettingKey = @k OR SettingKey LIKE @p`,
      [
        { name: 'k', type: sql.VarChar(100), value: `${PREFIX}${key}` },
        { name: 'p', type: sql.VarChar(100), value: `${PREFIX}${key}~%` },
      ],
    );
    await this.refresh();
    if (before) await this.audit('EMAIL_TEMPLATE_RESET', key, before, null, by, ip);
  }

  private async audit(action: string, key: string, before: unknown, after: unknown, by: Actor, ip?: string) {
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, OldValue, NewValue, IpAddress)
         VALUES (@uid, @email, @role, @action, 'AppSettings', @eid, @old, @new, @ip)`,
        [
          { name: 'uid', type: sql.UniqueIdentifier, value: by.id },
          { name: 'email', type: sql.NVarChar(254), value: by.email },
          { name: 'role', type: sql.VarChar(20), value: by.role },
          { name: 'action', type: sql.VarChar(100), value: action },
          { name: 'eid', type: sql.NVarChar(100), value: `email.template.${key}` },
          { name: 'old', type: sql.NVarChar(sql.MAX), value: before ? JSON.stringify(before) : null },
          { name: 'new', type: sql.NVarChar(sql.MAX), value: after ? JSON.stringify(after) : null },
          { name: 'ip', type: sql.NVarChar(45), value: ip ? ip.slice(0, 45) : null },
        ],
      );
    } catch {
      // auditing must never undo the change itself
    }
  }
}
