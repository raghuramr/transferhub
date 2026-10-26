import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';

export interface ScopeViewer {
  id: string;
  role: string;
}

/**
 * Admins are assigned to one or more universities (UserScopeUniversities) and
 * should only see students who registered for - or submitted transfer requests
 * to - those universities. No scope rows = unrestricted (the existing default);
 * super admins are never restricted. Only the `admin` role is narrowed here.
 */
@Injectable()
export class ScopeService {
  constructor(private db: DatabaseService) {}

  /** null = unrestricted, otherwise the university ids the viewer is limited to. */
  async universityScope(viewer: ScopeViewer): Promise<number[] | null> {
    if (viewer.role !== 'admin') return null;
    const res = await this.db.query<{ InstitutionId: number }>(
      `SELECT InstitutionId FROM UserScopeUniversities WHERE UserId = @uid`,
      [{ name: 'uid', type: sql.UniqueIdentifier, value: viewer.id }],
    );
    return res.recordset.length ? res.recordset.map((r) => r.InstitutionId) : null;
  }

  private list(ids: number[], prefix: string, inputs: QueryInput[]) {
    return ids
      .map((id, i) => {
        const name = `${prefix}${i}`;
        inputs.push({ name, type: sql.Int, value: id });
        return `@${name}`;
      })
      .join(', ');
  }

  /** SQL predicate on a Users alias: "this student belongs to one of the universities". */
  studentInScope(ids: number[], userAlias: string, inputs: QueryInput[], prefix = 'sc'): string {
    const p = this.list(ids, prefix, inputs);
    return `(EXISTS (SELECT 1 FROM StudentProfiles sp_s WHERE sp_s.UserId = ${userAlias}.Id AND sp_s.TargetInstitutionId IN (${p}))
       OR EXISTS (SELECT 1 FROM Transcripts t_s WHERE t_s.StudentUserId = ${userAlias}.Id AND t_s.TargetInstitutionId IN (${p})))`;
  }

  /** SQL predicate on a Transcripts alias: the request targets (or its student registered for) a scoped university. */
  transcriptInScope(ids: number[], transcriptAlias: string, inputs: QueryInput[], prefix = 'sc'): string {
    const p = this.list(ids, prefix, inputs);
    return `(${transcriptAlias}.TargetInstitutionId IN (${p})
       OR EXISTS (SELECT 1 FROM StudentProfiles sp_t WHERE sp_t.UserId = ${transcriptAlias}.StudentUserId AND sp_t.TargetInstitutionId IN (${p})))`;
  }

  /** Can this viewer manage the given user? (admins: only students within their universities.) */
  async canManageUser(viewer: ScopeViewer, targetUserId: string): Promise<boolean> {
    const ids = await this.universityScope(viewer);
    if (!ids) return true;
    const roleRes = await this.db.query<{ Role: string }>(
      `SELECT r.Name AS Role FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: targetUserId }],
    );
    if (roleRes.recordset[0]?.Role !== 'student') return true;
    const inputs: QueryInput[] = [{ name: 'id', type: sql.UniqueIdentifier, value: targetUserId }];
    const pred = this.studentInScope(ids, 'u', inputs);
    const r = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Users u WHERE u.Id = @id AND ${pred}`, inputs);
    return r.recordset[0].N > 0;
  }
}
