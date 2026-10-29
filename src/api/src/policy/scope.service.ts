import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';

export interface ScopeViewer {
  id: string;
  role: string;
}

/** The three sides of a transfer: the student, the university they come from, the one they go to. */
export type Party = 'student' | 'source_university' | 'target_university';
export const PARTIES: Party[] = ['student', 'source_university', 'target_university'];

export interface TransferSides {
  studentUserId: string;
  submittedById: string;
  /** Transcripts.InstitutionId - the university the student is leaving (University 1). */
  sourceId: number | null;
  /** Transcripts.TargetInstitutionId, else the student's registered target (University 2). */
  targetId: number | null;
}

/**
 * Staff who work for a university (admin and faculty) are assigned to one or more
 * universities (UserScopeUniversities) and should only see students who registered for -
 * or submitted transfer requests to/from - those universities. No scope rows =
 * unrestricted (the existing default); super admins are never restricted; students and
 * agencies keep their own ownership checks and are never narrowed here.
 *
 * Faculty are ALSO limited by workflow-stage membership elsewhere; university scope is an
 * additional narrowing on top of that, never a replacement for it.
 */
export const SCOPED_STAFF_ROLES = ['admin', 'faculty'] as const;

/** Roles whose visibility UserScopeUniversities narrows. */
export const isScopedStaffRole = (role: string): boolean => (SCOPED_STAFF_ROLES as readonly string[]).includes(role);

@Injectable()
export class ScopeService {
  constructor(private db: DatabaseService) {}

  /** null = unrestricted, otherwise the university ids the viewer is limited to. */
  async universityScope(viewer: ScopeViewer): Promise<number[] | null> {
    if (!isScopedStaffRole(viewer.role)) return null;
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

  /**
   * SQL predicate on a Transcripts alias: the request is OUTGOING from a scoped university
   * (its source institution is in scope). Outgoing access is read + documents + reminders only.
   */
  transcriptOutgoingInScope(ids: number[], transcriptAlias: string, inputs: QueryInput[], prefix = 'so'): string {
    const p = this.list(ids, prefix, inputs);
    return `(${transcriptAlias}.InstitutionId IN (${p}))`;
  }

  /** Incoming OR outgoing: everything a scoped admin may at least read. */
  transcriptVisibleInScope(ids: number[], transcriptAlias: string, inputs: QueryInput[]): string {
    return `(${this.transcriptInScope(ids, transcriptAlias, inputs, 'sc')} OR ${this.transcriptOutgoingInScope(ids, transcriptAlias, inputs, 'so')})`;
  }

  /**
   * Kept as the name the transfer exchange uses; identical to universityScope() now that
   * faculty are narrowed by their university assignment too.
   */
  async staffUniversityScope(viewer: ScopeViewer): Promise<number[] | null> {
    return this.universityScope(viewer);
  }

  /**
   * Which sides of this transfer the viewer may speak for. A student (or the agency that submitted
   * for them) is the student side; super admins and unscoped admin/faculty may act for either
   * university; scoped admin/faculty only for the universities they are assigned to.
   */
  async partiesFor(viewer: ScopeViewer, t: TransferSides): Promise<Party[]> {
    const same = (a: string | null) => !!a && String(a).toLowerCase() === viewer.id.toLowerCase();
    if (viewer.role === 'student') return same(t.studentUserId) ? ['student'] : [];
    if (viewer.role === 'agency') return same(t.submittedById) ? ['student'] : [];
    if (viewer.role === 'super_admin') return ['source_university', 'target_university'];
    if (!isScopedStaffRole(viewer.role)) return [];
    const ids = await this.staffUniversityScope(viewer);
    if (!ids) return ['source_university', 'target_university'];
    const out: Party[] = [];
    if (t.sourceId != null && ids.includes(t.sourceId)) out.push('source_university');
    if (t.targetId != null && ids.includes(t.targetId)) out.push('target_university');
    return out;
  }

  /**
   * False only for scoped staff (admin or faculty) looking at an OUTGOING request: they may read it,
   * upload documents and send reminders, but not approve/decide stages. Everyone else keeps today's
   * behaviour.
   */
  async canWorkRequest(viewer: ScopeViewer, transcriptId: string): Promise<boolean> {
    if (!isScopedStaffRole(viewer.role)) return true;
    const ids = await this.universityScope(viewer);
    if (!ids) return true;
    const inputs: QueryInput[] = [{ name: 'tid', type: sql.UniqueIdentifier, value: transcriptId }];
    const pred = this.transcriptInScope(ids, 't', inputs);
    const r = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Transcripts t WHERE t.Id = @tid AND ${pred}`, inputs);
    return r.recordset[0].N > 0;
  }

  /** Read access to a request: everyone but scoped staff sees it; scoped staff need it incoming OR outgoing. */
  async canViewTranscript(viewer: ScopeViewer, transcriptId: string): Promise<boolean> {
    if (!isScopedStaffRole(viewer.role)) return true;
    const ids = await this.universityScope(viewer);
    if (!ids) return true;
    const inputs: QueryInput[] = [{ name: 'tid', type: sql.UniqueIdentifier, value: transcriptId }];
    const pred = this.transcriptVisibleInScope(ids, 't', inputs);
    const r = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Transcripts t WHERE t.Id = @tid AND ${pred}`, inputs);
    return r.recordset[0].N > 0;
  }

  /**
   * Can this viewer manage the given user? Plain admins never see or manage super admins, and scoped
   * staff (admin or faculty) only reach students of the universities they are assigned to.
   */
  async canManageUser(viewer: ScopeViewer, targetUserId: string): Promise<boolean> {
    if (!isScopedStaffRole(viewer.role)) return true;
    const roleRes = await this.db.query<{ Role: string }>(
      `SELECT r.Name AS Role FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE u.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: targetUserId }],
    );
    const role = roleRes.recordset[0]?.Role;
    if (role === 'super_admin') return false;
    const ids = await this.universityScope(viewer);
    if (!ids || role !== 'student') return true;
    const inputs: QueryInput[] = [{ name: 'id', type: sql.UniqueIdentifier, value: targetUserId }];
    const pred = this.studentInScope(ids, 'u', inputs);
    const r = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Users u WHERE u.Id = @id AND ${pred}`, inputs);
    return r.recordset[0].N > 0;
  }
}
