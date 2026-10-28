import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { ScopeService } from '../policy/scope.service';
import type { EventAccess, HubViewer } from './live-hub';
import type { LiveEvent } from './event-bus.service';

const OWNER_TTL_MS = 60_000;
const DECISION_TTL_MS = 30_000;

/**
 * Same visibility rules as RequestsService.assertCanView: a student sees their own request, an agency
 * the ones it submitted, a scoped admin incoming/outgoing for their universities, other staff all.
 * Staff-only events (internal notes) never reach a student/agency (the hub also enforces that).
 */
@Injectable()
export class EventAccessService implements EventAccess {
  private owners = new Map<string, { student: string; submitter: string; at: number } | null>();
  private decisions = new Map<string, { ok: boolean; at: number }>();

  constructor(
    private db: DatabaseService,
    private scope: ScopeService,
  ) {}

  private async owner(transcriptId: string) {
    const hit = this.owners.get(transcriptId);
    if (hit !== undefined && (hit === null || Date.now() - hit.at < OWNER_TTL_MS)) return hit;
    const r = await this.db.query<{ StudentUserId: string; SubmittedById: string }>(
      `SELECT StudentUserId, SubmittedById FROM Transcripts WHERE Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const row = r.recordset[0];
    const val = row ? { student: String(row.StudentUserId).toLowerCase(), submitter: String(row.SubmittedById).toLowerCase(), at: Date.now() } : null;
    if (this.owners.size > 5000) this.owners.clear();
    this.owners.set(transcriptId, val);
    return val;
  }

  async canSee(viewer: HubViewer, transcriptId: string, audience: LiveEvent['audience']): Promise<boolean> {
    const uid = viewer.id.toLowerCase();
    if (viewer.role === 'student' || viewer.role === 'agency') {
      if (audience === 'staff') return false;
      const o = await this.owner(transcriptId);
      if (!o) return false;
      return viewer.role === 'student' ? o.student === uid : o.submitter === uid;
    }
    if (viewer.role === 'admin') {
      const key = `${uid}:${transcriptId}`;
      const hit = this.decisions.get(key);
      if (hit && Date.now() - hit.at < DECISION_TTL_MS) return hit.ok;
      const ok = await this.scope.canViewTranscript({ id: viewer.id, role: viewer.role }, transcriptId);
      if (this.decisions.size > 5000) this.decisions.clear();
      this.decisions.set(key, { ok, at: Date.now() });
      return ok;
    }
    return viewer.role === 'super_admin' || viewer.role === 'faculty';
  }
}
