import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { sanitizeCustom, type CustomTemplate } from './email-templates';
import type { Actor } from './email-overrides.service';

const PREFIX = 'email.custom.';
const CHUNK = 900; // AppSettings.SettingValue is NVARCHAR(1000)
const MAX_JSON = 6000;
const MAX_TEMPLATES = 100;
const KEY_RE = /^email\.custom\.([a-z0-9]+)(?:~(\d+))?$/;

/** Super-admin created e-mail templates, stored in AppSettings (`email.custom.<id>`, chunked like the built-in overrides). */
@Injectable()
export class EmailCustomService {
  constructor(private db: DatabaseService, private schema: SchemaService) {}

  ready() {
    return this.schema.has('AppSettings');
  }

  private async need() {
    if (!(await this.ready())) throw new ServiceUnavailableException('Migration 023 (AppSettings) has not been applied yet.');
  }

  async list(): Promise<CustomTemplate[]> {
    if (!(await this.ready())) return [];
    const r = await this.db.query<{ SettingKey: string; SettingValue: string | null }>(`SELECT SettingKey, SettingValue FROM AppSettings WHERE SettingKey LIKE 'email.custom.%'`);
    const parts = new Map<string, string[]>();
    for (const row of r.recordset) {
      const m = KEY_RE.exec(row.SettingKey);
      if (!m) continue;
      const arr = parts.get(m[1]) ?? [];
      arr[m[2] ? Number(m[2]) : 0] = row.SettingValue ?? '';
      parts.set(m[1], arr);
    }
    const out: CustomTemplate[] = [];
    for (const [id, arr] of parts) {
      try {
        const o = JSON.parse(Array.from(arr, (x) => x ?? '').join('')) as Omit<CustomTemplate, 'id'>;
        if (o && typeof o === 'object') out.push({ ...o, id });
      } catch {
        // unreadable template: skipped
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<CustomTemplate> {
    const t = (await this.list()).find((x) => x.id === id);
    if (!t) throw new NotFoundException('No such template');
    return t;
  }

  private clean(raw: Partial<CustomTemplate>) {
    try {
      return sanitizeCustom(raw);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private async write(id: string, body: Omit<CustomTemplate, 'id'>) {
    const json = JSON.stringify(body);
    if (json.length > MAX_JSON) throw new BadRequestException('This template is too long to store. Shorten the text.');
    const names: string[] = [];
    for (let i = 0; i * CHUNK < json.length; i++) {
      const name = i === 0 ? `${PREFIX}${id}` : `${PREFIX}${id}~${i}`;
      names.push(name);
      await this.db.query(
        `MERGE AppSettings AS t USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
         WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue) VALUES (@k, @v);`,
        [{ name: 'k', type: sql.VarChar(100), value: name }, { name: 'v', type: sql.NVarChar(1000), value: json.slice(i * CHUNK, (i + 1) * CHUNK) }],
      );
    }
    await this.db.query(
      `DELETE FROM AppSettings WHERE SettingKey LIKE @p AND SettingKey NOT IN (${names.map((_, i) => `@n${i}`).join(', ')})`,
      [{ name: 'p', type: sql.VarChar(100), value: `${PREFIX}${id}~%` }, ...names.map((n, i) => ({ name: `n${i}`, type: sql.VarChar(100), value: n }))],
    );
  }

  async create(raw: Partial<CustomTemplate>, by: Actor): Promise<CustomTemplate> {
    await this.need();
    const body = this.clean(raw);
    if ((await this.list()).length >= MAX_TEMPLATES) throw new BadRequestException(`At most ${MAX_TEMPLATES} custom templates.`);
    const id = randomBytes(6).toString('hex');
    await this.write(id, body);
    await this.audit('EMAIL_CUSTOM_CREATED', id, null, body, by);
    return { ...body, id };
  }

  async update(id: string, raw: Partial<CustomTemplate>, by: Actor): Promise<CustomTemplate> {
    await this.need();
    const before = await this.get(id);
    const body = this.clean({ ...raw, enabled: raw.enabled ?? before.enabled });
    await this.write(id, body);
    await this.audit('EMAIL_CUSTOM_UPDATED', id, before, body, by);
    return { ...body, id };
  }

  async setEnabled(id: string, enabled: boolean, by: Actor) {
    const before = await this.get(id);
    const { id: _id, ...rest } = before;
    await this.write(id, { ...rest, enabled });
    await this.audit('EMAIL_CUSTOM_UPDATED', id, before, { ...rest, enabled }, by);
  }

  async remove(id: string, by: Actor) {
    await this.need();
    const before = await this.get(id);
    await this.db.query(`DELETE FROM AppSettings WHERE SettingKey = @k OR SettingKey LIKE @p`, [
      { name: 'k', type: sql.VarChar(100), value: `${PREFIX}${id}` },
      { name: 'p', type: sql.VarChar(100), value: `${PREFIX}${id}~%` },
    ]);
    await this.audit('EMAIL_CUSTOM_DELETED', id, before, null, by);
  }

  private async audit(action: string, id: string, before: unknown, after: unknown, by: Actor) {
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, OldValue, NewValue)
         VALUES (@uid, @email, @role, @action, 'AppSettings', @eid, @old, @new)`,
        [
          { name: 'uid', type: sql.UniqueIdentifier, value: by.id },
          { name: 'email', type: sql.NVarChar(254), value: by.email },
          { name: 'role', type: sql.VarChar(20), value: by.role },
          { name: 'action', type: sql.VarChar(100), value: action },
          { name: 'eid', type: sql.NVarChar(100), value: `${PREFIX}${id}` },
          { name: 'old', type: sql.NVarChar(sql.MAX), value: before ? JSON.stringify(before) : null },
          { name: 'new', type: sql.NVarChar(sql.MAX), value: after ? JSON.stringify(after) : null },
        ],
      );
    } catch {
      // auditing must never undo the change itself
    }
  }
}
