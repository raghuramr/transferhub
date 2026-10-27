import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from './schema.service';
import { asOfFromTerm, combineShares, inWindow, splitCredits, validateMultiDecision } from './multi-mapping';

export interface MappedCourse {
  buCourseId: number;
  code: string;
  title: string;
  credits: number | null;
  source: 'decision' | 'equivalency';
}

export interface MappingFlag {
  code: string;
  severity: 'review' | 'info';
  message: string;
}

export interface KnownMappingResult {
  /** BU course codes each transcript course (lower-cased id) maps to: decided, recorded mappings, auto-applied equivalencies. */
  codes: Map<string, string[]>;
  /** Extra flags (a combined equivalency whose partner course is missing), by lower-cased course id. */
  flags: Map<string, MappingFlag[]>;
}

type MappingRow = { Tc: string; Id: number; Code: string; Title: string; Credits: number | null; Source: 'decision' | 'equivalency' };

const lc = (s: unknown) => String(s).toLowerCase();
const todayIso = () => new Date().toISOString().slice(0, 10);
const convertedOf = (h: { Orig: number; Norm: number | null; Calendar: string | null }) =>
  h.Norm != null ? Number(h.Norm) : h.Calendar === 'quarter' ? Math.floor(((Number(h.Orig) * 2) / 3) * 100) / 100 : Number(h.Orig);

/**
 * OUT-06: one external course counting as several BU courses (and the reverse, several external courses together
 * counting as one). sp_RecordDecision is left as it is: it records the PRIMARY mapping exactly like before, and this
 * service adds the other mappings (EvaluationCourseMappings, migration 026) and equivalency rows on the SAME
 * transaction/connection, so a failure rolls the whole decision back.
 */
@Injectable()
export class CourseMappingsService {
  private readonly logger = new Logger(CourseMappingsService.name);

  constructor(private db: DatabaseService, private schema: SchemaService) {}

  ready(): Promise<boolean> {
    return this.schema.has('EvaluationCourseMappings');
  }

  // ── evaluator decisions ────────────────────────────────────

  /**
   * Records an equivalent/elective decision with several BU courses. `mappings[0]` is the primary one (it is what
   * Evaluations.DecidedBUCourseId holds, so every existing query keeps working). Credits not stated are split with
   * `splitCredits`; Evaluations.AwardedCredits becomes the total of all mappings.
   */
  async recordMultiDecision(
    evaluationId: string,
    decidedBy: string,
    outcome: string,
    mappings: { buCourseId: number; awardedCredits?: number | null }[],
    notes: string | null,
  ) {
    const problems = validateMultiDecision(outcome, mappings);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    if (!(await this.ready())) {
      throw new ServiceUnavailableException('Recording several BU courses needs database migration 026, which has not been applied yet.');
    }

    const head = await this.db.query<{ TcId: string; Orig: number; Norm: number | null; Calendar: string | null; ExtId: number }>(
      `SELECT tc.Id AS TcId, tc.OriginalCredits AS Orig, tc.NormalisedCredits AS Norm, i.Calendar, tc.ExternalCourseId AS ExtId
       FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       JOIN Transcripts t ON t.Id = tc.TranscriptId JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE e.Id = @e`,
      [{ name: 'e', type: sql.UniqueIdentifier, value: evaluationId }],
    );
    const h = head.recordset[0];
    if (!h) throw new BadRequestException('Evaluation not found');
    const converted = convertedOf(h);

    const ids = mappings.map((m) => m.buCourseId);
    const cat = await this.db.query<{ Id: number; Credits: number | null }>(
      `SELECT Id, Credits FROM Courses WHERE Id IN (${ids.map((_, i) => `@c${i}`).join(',')})`,
      ids.map((v, i) => ({ name: `c${i}`, type: sql.Int, value: v })),
    );
    if (cat.recordset.length !== ids.length) throw new BadRequestException('One of the BU courses does not exist.');
    const catalog = new Map(cat.recordset.map((r) => [r.Id, r.Credits == null ? null : Number(r.Credits)]));

    const split = splitCredits(
      converted,
      mappings.map((m) => ({ buCourseId: m.buCourseId, catalogCredits: catalog.get(m.buCourseId), credits: m.awardedCredits ?? null })),
    );
    const total = Math.round(split.reduce((s, m) => s + m.awardedCredits, 0) * 100) / 100;
    const primary = split[0];

    await this.db.transaction(async (run) => {
      // 1. The primary mapping goes through the stored procedure unchanged (outcome, equivalency row, audit, statuses).
      await run(
        `EXEC sp_RecordDecision @EvaluationId = @e, @DecidedBy = @by, @Outcome = @o, @BUCourseId = @bu, @AwardedCredits = @cr, @EvaluatorNotes = @n`,
        [
          { name: 'e', type: sql.UniqueIdentifier, value: evaluationId },
          { name: 'by', type: sql.UniqueIdentifier, value: decidedBy },
          { name: 'o', type: sql.VarChar(20), value: outcome },
          { name: 'bu', type: sql.Int, value: primary.buCourseId },
          { name: 'cr', type: sql.Decimal(5, 2), value: primary.awardedCredits },
          { name: 'n', type: sql.NVarChar(sql.MAX), value: notes },
        ],
      );
      // 2. The evaluation's awarded credits are the total over all mapped courses (the procedure stored only the primary's).
      await run(`UPDATE Evaluations SET AwardedCredits = @t WHERE Id = @e`, [
        { name: 't', type: sql.Decimal(5, 2), value: total },
        { name: 'e', type: sql.UniqueIdentifier, value: evaluationId },
      ]);
      // 3. Every mapping, replacing any earlier one for this course (UNIQUE per course + BU course).
      await run(`DELETE FROM EvaluationCourseMappings WHERE TranscriptCourseId = @tc`, [{ name: 'tc', type: sql.UniqueIdentifier, value: h.TcId }]);
      for (const m of split) {
        await run(
          `INSERT INTO EvaluationCourseMappings (TranscriptCourseId, EvaluationId, BUCourseId, AwardedCredits, Outcome, Source, SortOrder)
           VALUES (@tc, @e, @bu, @cr, @o, 'decision', @so)`,
          [
            { name: 'tc', type: sql.UniqueIdentifier, value: h.TcId },
            { name: 'e', type: sql.UniqueIdentifier, value: evaluationId },
            { name: 'bu', type: sql.Int, value: m.buCourseId },
            { name: 'cr', type: sql.Decimal(5, 2), value: m.awardedCredits },
            { name: 'o', type: sql.VarChar(20), value: outcome },
            { name: 'so', type: sql.Int, value: m.sortOrder },
          ],
        );
      }
      // 4. Learning loop: the procedure already wrote the primary equivalency; add one row per other BU course
      //    (same "not already recorded and still valid" test the procedure uses), so a later request applies ALL of them.
      for (const m of split.slice(1)) {
        await run(
          `IF NOT EXISTS (SELECT 1 FROM Equivalencies WHERE ExternalCourseId = @x AND BUCourseId = @bu AND IsActive = 1
                          AND (EffectiveTo IS NULL OR EffectiveTo >= CAST(SYSUTCDATETIME() AS DATE)))
             INSERT INTO Equivalencies (ExternalCourseId, BUCourseId, Outcome, BUCredits, Source, DecidedBy, DecidedAt)
             VALUES (@x, @bu, @o, @cr, 'evaluator', @by, SYSUTCDATETIME())`,
          [
            { name: 'x', type: sql.Int, value: h.ExtId },
            { name: 'bu', type: sql.Int, value: m.buCourseId },
            { name: 'o', type: sql.VarChar(20), value: outcome },
            { name: 'cr', type: sql.Decimal(5, 2), value: m.awardedCredits },
            { name: 'by', type: sql.UniqueIdentifier, value: decidedBy },
          ],
        );
      }
      await run(
        `INSERT INTO AuditLog (UserId, Action, EntityType, EntityId, NewValue, OccurredAt)
         VALUES (@by, 'DECISION_MULTI_MAPPING', 'Evaluation', @eid, @nv, SYSUTCDATETIME())`,
        [
          { name: 'by', type: sql.UniqueIdentifier, value: decidedBy },
          { name: 'eid', type: sql.NVarChar(100), value: evaluationId },
          { name: 'nv', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ outcome, mappings: split, total }) },
        ],
      );
    });
    return { total, mappings: split };
  }

  /** A later single-course decision replaces an earlier multi-course one: drop the old extra mappings. */
  async clearDecisionMappings(evaluationId: string): Promise<void> {
    if (!(await this.ready())) return;
    await this.db.query(
      `DELETE m FROM EvaluationCourseMappings m WHERE m.Source = 'decision'
         AND m.TranscriptCourseId = (SELECT TranscriptCourseId FROM Evaluations WHERE Id = @e)`,
      [{ name: 'e', type: sql.UniqueIdentifier, value: evaluationId }],
    );
  }

  // ── display ────────────────────────────────────────────────

  private group(rows: MappingRow[]): Map<string, MappedCourse[]> {
    const out = new Map<string, MappedCourse[]>();
    for (const m of rows) {
      const list = out.get(lc(m.Tc)) ?? [];
      list.push({ buCourseId: m.Id, code: m.Code, title: m.Title, credits: m.Credits == null ? null : Number(m.Credits), source: m.Source });
      out.set(lc(m.Tc), list);
    }
    return out;
  }

  /** BU courses each course of a request counts as (only courses with recorded/auto-applied multi mappings). */
  async forTranscript(transcriptId: string): Promise<Map<string, MappedCourse[]>> {
    if (!(await this.ready())) return new Map();
    try {
      const r = await this.db.query<MappingRow>(
        `SELECT m.TranscriptCourseId AS Tc, c.Id, c.Code, c.Title, m.AwardedCredits AS Credits, m.Source
         FROM EvaluationCourseMappings m
         JOIN TranscriptCourses tc ON tc.Id = m.TranscriptCourseId
         JOIN Courses c ON c.Id = m.BUCourseId
         WHERE tc.TranscriptId = @t ORDER BY m.TranscriptCourseId, m.SortOrder, c.Code`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      return this.group(r.recordset);
    } catch (err) {
      this.logger.warn(`mappings lookup failed: ${(err as Error).message}`);
      return new Map();
    }
  }

  /** Same, for every request of one student (progress view). */
  async forStudent(studentUserId: string): Promise<Map<string, MappedCourse[]>> {
    if (!(await this.ready())) return new Map();
    try {
      const r = await this.db.query<MappingRow>(
        `SELECT m.TranscriptCourseId AS Tc, c.Id, c.Code, c.Title, m.AwardedCredits AS Credits, m.Source
         FROM EvaluationCourseMappings m
         JOIN TranscriptCourses tc ON tc.Id = m.TranscriptCourseId
         JOIN Transcripts t ON t.Id = tc.TranscriptId
         JOIN Courses c ON c.Id = m.BUCourseId
         WHERE t.StudentUserId = @u ORDER BY m.TranscriptCourseId, m.SortOrder, c.Code`,
        [{ name: 'u', type: sql.UniqueIdentifier, value: studentUserId }],
      );
      return this.group(r.recordset);
    } catch (err) {
      this.logger.warn(`mappings lookup failed: ${(err as Error).message}`);
      return new Map();
    }
  }

  // ── known equivalencies applied by the rules engine ─────────

  /**
   * For every course of the request that a known equivalency covers: works out ALL the BU courses it maps to,
   * writes them (when it is a one-to-many or a combined equivalency) and returns the BU codes per course plus
   * a flag when a combined equivalency is missing its partner course. A decision already recorded for a course wins.
   * Safe to run repeatedly; the writes only happen once migration 026 is applied.
   */
  async materializeKnown(transcriptId: string): Promise<KnownMappingResult> {
    const result: KnownMappingResult = { codes: new Map(), flags: new Map() };
    const hasTable = await this.ready();
    const hasGroup = hasTable && (await this.schema.has('Equivalencies', 'GroupKey'));

    type Row = {
      TcId: string; ExtId: number | null; Term: string | null; Orig: number; Norm: number | null; Calendar: string | null; Code: string;
      BuId: number; Outcome: string; EqCredits: number | null; Group: string | null; From: Date | null; To: Date | null; BuCode: string; BuCredits: number | null;
    };
    const rows = await this.db.query<Row>(
      `SELECT tc.Id AS TcId, tc.ExternalCourseId AS ExtId, tc.Term, tc.OriginalCredits AS Orig, tc.NormalisedCredits AS Norm, i.Calendar, tc.CourseCode AS Code,
              eq.BUCourseId AS BuId, eq.Outcome, eq.BUCredits AS EqCredits, ${hasGroup ? 'eq.GroupKey' : 'CAST(NULL AS NVARCHAR(40))'} AS [Group],
              eq.EffectiveFrom AS [From], eq.EffectiveTo AS [To], bc.Code AS BuCode, bc.Credits AS BuCredits
       FROM TranscriptCourses tc
       JOIN Transcripts t ON t.Id = tc.TranscriptId
       JOIN Institutions i ON i.Id = t.InstitutionId
       JOIN Equivalencies eq ON eq.ExternalCourseId = tc.ExternalCourseId AND eq.IsActive = 1 AND eq.Outcome IN ('equivalent','elective')
       JOIN Courses bc ON bc.Id = eq.BUCourseId
       WHERE tc.TranscriptId = @t AND tc.Lane <> 'not_eligible'
       ORDER BY tc.SortOrder, tc.CourseCode, eq.Id`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );

    // Equivalencies valid on the date the course was taken (same test as sp_TriageCourse), per course.
    const byCourse = new Map<string, { head: Row; cands: Row[] }>();
    for (const r of rows.recordset) {
      if (!inWindow({ EffectiveFrom: r.From, EffectiveTo: r.To }, asOfFromTerm(r.Term, todayIso()))) continue;
      const k = lc(r.TcId);
      const e = byCourse.get(k) ?? { head: r, cands: [] };
      if (!e.cands.some((c) => c.BuId === r.BuId)) e.cands.push(r);
      byCourse.set(k, e);
    }

    // Decided courses keep their recorded decision: report its codes, never overwrite it.
    const decided = new Map<string, string[]>();
    const dr = await this.db.query<{ Tc: string; Code: string }>(
      `SELECT e.TranscriptCourseId AS Tc, c.Code FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       JOIN Courses c ON c.Id = e.DecidedBUCourseId
       WHERE tc.TranscriptId = @t AND e.Status IN ('decided','posted') AND e.Outcome IN ('equivalent','elective')`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    for (const d of dr.recordset) decided.set(lc(d.Tc), [...(decided.get(lc(d.Tc)) ?? []), d.Code]);
    if (hasTable) {
      const mr = await this.db.query<{ Tc: string; Code: string }>(
        `SELECT m.TranscriptCourseId AS Tc, c.Code FROM EvaluationCourseMappings m JOIN TranscriptCourses tc ON tc.Id = m.TranscriptCourseId
         JOIN Courses c ON c.Id = m.BUCourseId WHERE tc.TranscriptId = @t AND m.Source = 'decision'`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      for (const d of mr.recordset) {
        const list = decided.get(lc(d.Tc)) ?? [];
        if (!list.includes(d.Code)) list.push(d.Code);
        decided.set(lc(d.Tc), list);
      }
    }
    for (const [k, v] of decided) result.codes.set(k, v);

    // Group partners: "GroupKey|BU course" -> every external course those (valid) equivalencies list.
    const partners = new Map<string, Set<number>>();
    const presentExternal = new Set<number>();
    if (hasGroup) {
      const ext = await this.db.query<{ ExtId: number }>(
        `SELECT DISTINCT ExternalCourseId AS ExtId FROM TranscriptCourses WHERE TranscriptId = @t AND ExternalCourseId IS NOT NULL AND Lane <> 'not_eligible'`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      ext.recordset.forEach((r) => presentExternal.add(r.ExtId));
      const keys = new Set<string>();
      for (const { cands } of byCourse.values()) for (const c of cands) if (c.Group) keys.add(c.Group);
      for (const key of keys) {
        const p = await this.db.query<{ ExtId: number; BuId: number }>(
          `SELECT ExternalCourseId AS ExtId, BUCourseId AS BuId FROM Equivalencies
           WHERE GroupKey = @g AND IsActive = 1 AND Outcome IN ('equivalent','elective')`,
          [{ name: 'g', type: sql.NVarChar(40), value: key }],
        );
        for (const r of p.recordset) {
          const pk = `${key}|${r.BuId}`;
          partners.set(pk, (partners.get(pk) ?? new Set()).add(r.ExtId));
        }
      }
    }

    const writes: { tcId: string; buId: number; credits: number; outcome: string; order: number }[] = [];
    const combineSeen = new Set<string>();
    for (const [k, { head, cands }] of byCourse) {
      if (decided.has(k)) continue; // a recorded decision wins
      const single = cands.filter((c) => !c.Group);
      result.codes.set(k, cands.map((c) => c.BuCode));

      // One-to-many: several BU courses for one external course.
      if (single.length > 1) {
        const split = splitCredits(
          convertedOf(head),
          single.map((c) => ({ buCourseId: c.BuId, catalogCredits: c.BuCredits == null ? null : Number(c.BuCredits), credits: c.EqCredits == null ? null : Number(c.EqCredits) })),
        );
        split.forEach((s, i) => writes.push({ tcId: head.TcId, buId: s.buCourseId, credits: s.awardedCredits, outcome: single[i].Outcome, order: i }));
      }

      // Many-to-one: this course only counts together with its partner course(s).
      for (const g of cands.filter((c) => c.Group)) {
        const members = [...(partners.get(`${g.Group}|${g.BuId}`) ?? [])];
        if (members.length < 2) continue;
        const missing = members.filter((m) => !presentExternal.has(m));
        if (missing.length) {
          const f = result.flags.get(k) ?? [];
          f.push({
            code: 'partial_combination',
            severity: 'review',
            message: `${head.Code} counts as ${g.BuCode} only together with ${missing.length} other course(s) that are not on this request; a reviewer decides whether it counts on its own.`,
          });
          result.flags.set(k, f);
          continue;
        }
        const seenKey = `${g.Group}|${g.BuId}`;
        if (combineSeen.has(seenKey)) continue;
        combineSeen.add(seenKey);
        const memberCourses = [...byCourse.entries()].filter(
          ([mk, x]) => !decided.has(mk) && x.head.ExtId != null && members.includes(x.head.ExtId) && x.cands.some((c) => c.Group === g.Group && c.BuId === g.BuId),
        );
        const shares = combineShares(
          g.EqCredits != null ? Number(g.EqCredits) : Number(g.BuCredits ?? 0),
          memberCourses.map(([, x]) => ({ courseId: x.head.TcId, convertedCredits: convertedOf(x.head) })),
        );
        for (const [, x] of memberCourses) writes.push({ tcId: x.head.TcId, buId: g.BuId, credits: shares.get(x.head.TcId) ?? 0, outcome: g.Outcome, order: 0 });
      }
    }

    if (hasTable && byCourse.size) {
      await this.db.transaction(async (run) => {
        // Rebuild only the auto-applied rows of courses without a decision; recorded decisions are never touched.
        for (const [k, { head }] of byCourse) {
          if (decided.has(k)) continue;
          await run(`DELETE FROM EvaluationCourseMappings WHERE TranscriptCourseId = @tc AND Source = 'equivalency'`, [{ name: 'tc', type: sql.UniqueIdentifier, value: head.TcId }]);
        }
        for (const w of writes) {
          await run(
            `INSERT INTO EvaluationCourseMappings (TranscriptCourseId, BUCourseId, AwardedCredits, Outcome, Source, SortOrder)
             VALUES (@tc, @bu, @cr, @o, 'equivalency', @so)`,
            [
              { name: 'tc', type: sql.UniqueIdentifier, value: w.tcId },
              { name: 'bu', type: sql.Int, value: w.buId },
              { name: 'cr', type: sql.Decimal(5, 2), value: w.credits },
              { name: 'o', type: sql.VarChar(20), value: w.outcome },
              { name: 'so', type: sql.Int, value: w.order },
            ],
          );
        }
      });
    }
    return result;
  }
}
