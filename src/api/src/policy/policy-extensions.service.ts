import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { CourseMappingsService } from './course-mappings.service';
import { ProgrammeRulesService } from './programme-rules.service';
import { RuleFlag, mergeOwnedFlags } from './programme-rules';

const REVIEWABLE = new Set(['applied', 'likely', 'needs_syllabus', 'elective_only', 'pending']);

interface Flag { code: string; severity: string; message: string }

const parse = (json: string | null | undefined): Flag[] => {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as Flag[]) : [];
  } catch {
    return [];
  }
};

/**
 * Runs after TransferPolicyService.applyToTranscript's own checks (one call site there):
 *   1. one-to-many / combined equivalencies are materialised (OUT-06);
 *   2. programme rules (PRG-03..08) are evaluated for the student's target programme.
 * Everything here only ADDS flags (stored in TranscriptCourses.PolicyFlags next to the policy flags) and, for a
 * "review" flag, sends a course that is still open to the department; it never denies anything (GOV-01).
 * Both parts quietly do nothing until migrations 026 / 027 are applied.
 */
@Injectable()
export class PolicyExtensionsService {
  private readonly logger = new Logger(PolicyExtensionsService.name);

  constructor(private db: DatabaseService, private mappings: CourseMappingsService, private rules: ProgrammeRulesService) {}

  async afterPolicy(transcriptId: string): Promise<{ flagged: number }> {
    const head = await this.db.query<{ StudentUserId: string }>(`SELECT StudentUserId FROM Transcripts WHERE Id = @t`, [
      { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
    ]);
    const studentId = head.recordset[0]?.StudentUserId;
    if (!studentId) return { flagged: 0 };

    let known: Awaited<ReturnType<CourseMappingsService['materializeKnown']>> = { codes: new Map(), flags: new Map() };
    try {
      known = await this.mappings.materializeKnown(transcriptId);
    } catch (err) {
      this.logger.warn(`Request ${transcriptId}: multi-course mappings skipped: ${(err as Error).message}`);
    }

    const courses = await this.db.query<{ Id: string; CourseCode: string; Lane: string; IsOutsideUS: boolean | null; PolicyFlags: string | null; HasEval: number; Settled: number }>(
      `SELECT tc.Id, tc.CourseCode, tc.Lane, tc.IsOutsideUS, tc.PolicyFlags,
              (SELECT COUNT(*) FROM Evaluations e WHERE e.TranscriptCourseId = tc.Id) AS HasEval,
              CASE WHEN tc.Status IN ('decided','posted')
                     OR EXISTS (SELECT 1 FROM Evaluations e WHERE e.TranscriptCourseId = tc.Id AND e.Status IN ('decided','posted'))
                   THEN 1 ELSE 0 END AS Settled
       FROM TranscriptCourses tc WHERE tc.TranscriptId = @t ORDER BY tc.SortOrder, tc.CourseCode`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );

    let ruleFlags = new Map<string, RuleFlag[]>();
    try {
      ruleFlags = await this.rules.evaluate(
        studentId,
        transcriptId,
        courses.recordset.map((c) => ({ id: c.Id, code: c.CourseCode, lane: c.Lane, isOutsideUS: !!c.IsOutsideUS, buCodes: known.codes.get(c.Id.toLowerCase()) ?? [] })),
      );
    } catch (err) {
      this.logger.warn(`Request ${transcriptId}: programme rules skipped: ${(err as Error).message}`);
    }

    let flagged = 0;
    for (const c of courses.recordset) {
      const k = c.Id.toLowerCase();
      const extra: Flag[] = [...(known.flags.get(k) ?? []), ...(ruleFlags.get(k) ?? [])];
      const before = parse(c.PolicyFlags);
      const merged = mergeOwnedFlags(before, extra);
      const changed = JSON.stringify(merged) !== JSON.stringify(before);
      const needsReview = extra.some((f) => f.severity === 'review') && !c.Settled && !c.IsOutsideUS;
      const lane = needsReview && REVIEWABLE.has(c.Lane) && c.Lane !== 'pending' ? 'pending' : c.Lane;
      if (extra.some((f) => f.severity === 'review')) flagged++;
      if (changed || lane !== c.Lane) {
        await this.db.query(`UPDATE TranscriptCourses SET Lane = @l, PolicyFlags = @f, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
          { name: 'l', type: sql.VarChar(30), value: lane },
          { name: 'f', type: sql.NVarChar(sql.MAX), value: merged.length ? JSON.stringify(merged) : null },
          { name: 'id', type: sql.UniqueIdentifier, value: c.Id },
        ]);
      }
      // A course a person must now look at needs an evaluation record, like the policy engine's own review flags.
      if (needsReview && !c.HasEval && lane === 'pending') {
        await this.db.query(`INSERT INTO Evaluations (TranscriptCourseId, Status) VALUES (@tc, 'queued')`, [{ name: 'tc', type: sql.UniqueIdentifier, value: c.Id }]);
      }
    }
    return { flagged };
  }
}
