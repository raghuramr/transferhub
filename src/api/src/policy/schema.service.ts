import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';

/**
 * "Has migration N been applied yet?" checks, cached. The app is deployed before migrations are run
 * (they are applied by hand), so new features check here and fall back instead of erroring.
 * A positive answer is cached for good; a negative one is re-checked after a minute.
 */
@Injectable()
export class SchemaService {
  private cache = new Map<string, { ok: boolean; at: number }>();

  constructor(private db: DatabaseService) {}

  async has(table: string, column?: string): Promise<boolean> {
    const key = `${table}.${column ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && (hit.ok || Date.now() - hit.at < 60_000)) return hit.ok;
    let ok = false;
    try {
      const r = await this.db.query<{ N: number }>(
        column
          ? `SELECT CASE WHEN COL_LENGTH(@t, @c) IS NULL THEN 0 ELSE 1 END AS N`
          : `SELECT CASE WHEN OBJECT_ID(@t) IS NULL THEN 0 ELSE 1 END AS N`,
        [
          { name: 't', type: sql.NVarChar(128), value: table },
          { name: 'c', type: sql.NVarChar(128), value: column ?? null },
        ],
      );
      ok = r.recordset[0]?.N === 1;
    } catch {
      ok = false;
    }
    this.cache.set(key, { ok, at: Date.now() });
    return ok;
  }

  /** Migration 015 (BU policy alignment). */
  policyReady(): Promise<boolean> {
    return this.has('CourseAppeals');
  }
}
