import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from './schema.service';
import { computeCreditDeadline, CreditDeadline } from './credit-deadline';

interface ProfileRow {
  UserId: string;
  EntryTerm: string | null;
  EntryYear: number | null;
  StartDate: Date | string | null;
  TargetInstitutionId: number | null;
  FirstAt: Date | null;
}

/**
 * Looks up what computeCreditDeadline needs (entry term/start date, the university's configured
 * months, first request date) for one or many students. Every method returns null/an empty map when
 * migration 024 is not applied, so callers simply skip the deadline (nothing errors, nothing enforced).
 */
@Injectable()
export class CreditDeadlineService {
  private readonly logger = new Logger(CreditDeadlineService.name);

  constructor(private db: DatabaseService, private schema: SchemaService) {}

  /** Keyed by lower-cased student user id. Students without a profile row are simply absent. */
  async forStudents(userIds: string[], now: Date = new Date()): Promise<Map<string, CreditDeadline>> {
    const out = new Map<string, CreditDeadline>();
    const ids = [...new Set(userIds.map((u) => String(u).toLowerCase()))];
    if (!ids.length || !(await this.schema.deadlineReady()) || !(await this.schema.policyReady())) return out;
    try {
      const months = new Map<number | null, number>();
      const pol = await this.db.query<{ InstitutionId: number | null; M: number }>(`SELECT InstitutionId, CreditDeadlineMonths AS M FROM TransferPolicies`);
      for (const p of pol.recordset) months.set(p.InstitutionId, Number(p.M));
      const bu = await this.db.query<{ Id: number }>(`SELECT TOP 1 Id FROM Institutions WHERE Code = 'BU'`);
      const buId = bu.recordset[0]?.Id ?? null;

      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const inputs = chunk.map((id, n) => ({ name: `u${n}`, type: sql.UniqueIdentifier, value: id }));
        const rows = await this.db.query<ProfileRow>(
          `SELECT sp.UserId, sp.EntryTerm, sp.EntryYear, sp.StartDate, sp.TargetInstitutionId,
                  (SELECT MIN(t.ReceivedAt) FROM Transcripts t WHERE t.StudentUserId = sp.UserId AND ISNULL(t.EvaluationKind, 'official') <> 'preview') AS FirstAt
           FROM StudentProfiles sp WHERE sp.UserId IN (${chunk.map((_, n) => `@u${n}`).join(',')})`,
          inputs,
        );
        for (const r of rows.recordset) {
          const target = r.TargetInstitutionId ?? buId;
          const m = months.get(target) ?? months.get(null) ?? 12;
          out.set(String(r.UserId).toLowerCase(), computeCreditDeadline({
            entryTerm: r.EntryTerm, entryYear: r.EntryYear, startDate: r.StartDate, months: m, now, firstRequestAt: r.FirstAt,
          }));
        }
      }
    } catch (e) {
      this.logger.warn(`credit deadline lookup failed: ${(e as Error).message}`);
    }
    return out;
  }

  async forStudent(userId: string, now?: Date): Promise<CreditDeadline | null> {
    return (await this.forStudents([userId], now)).get(String(userId).toLowerCase()) ?? null;
  }

  /** Same, keyed by request id. Preview requests are exempt and get null. */
  async forTranscripts(transcriptIds: string[], now?: Date): Promise<Map<string, CreditDeadline | null>> {
    const out = new Map<string, CreditDeadline | null>();
    const ids = [...new Set(transcriptIds.map((t) => String(t).toLowerCase()))];
    if (!ids.length || !(await this.schema.deadlineReady()) || !(await this.schema.policyReady())) return out;
    const owners = new Map<string, { student: string; kind: string }>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const r = await this.db.query<{ Id: string; StudentUserId: string; Kind: string | null }>(
        `SELECT Id, StudentUserId, ISNULL(EvaluationKind, 'official') AS Kind FROM Transcripts WHERE Id IN (${chunk.map((_, n) => `@t${n}`).join(',')})`,
        chunk.map((id, n) => ({ name: `t${n}`, type: sql.UniqueIdentifier, value: id })),
      );
      for (const row of r.recordset) owners.set(String(row.Id).toLowerCase(), { student: String(row.StudentUserId).toLowerCase(), kind: row.Kind ?? 'official' });
    }
    const byStudent = await this.forStudents([...new Set([...owners.values()].map((o) => o.student))], now);
    for (const [tid, o] of owners) out.set(tid, o.kind === 'preview' ? null : byStudent.get(o.student) ?? null);
    return out;
  }
}
