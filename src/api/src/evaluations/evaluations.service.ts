import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventBus } from '../events/event-bus.service';
import { DatabaseService, QueryInput } from '../database/database.service';
import * as sql from 'mssql';
import { DecideEvaluationDto, AssignEvaluationDto } from './dto/create-evaluation.dto';
import { CourseMappingsService } from '../policy/course-mappings.service';

interface EvaluationListRow {
  Id: string;
  Status: string;
  QueuedAt: Date;
  CourseCode: string;
  CourseTitle: string;
  Grade: string;
  InstitutionName: string;
  AiCandidateCount: number;
}

interface EvaluationDetailRow {
  Id: string;
  Status: string;
  AIConfidence: number | null;
  AIRationale: string | null;
  CourseCode: string;
  CourseTitle: string;
  OriginalCredits: number;
  Grade: string;
  InstitutionName: string;
  Calendar: string | null;
}

interface AiCandidateRow {
  Rank: number;
  Score: number;
  Rationale: string | null;
  BuId: number;
  BuCode: string;
  BuTitle: string;
  BuCredits: number;
}

@Injectable()
export class EvaluationsService {
  constructor(private db: DatabaseService, private mappings: CourseMappingsService, @Optional() private bus?: EventBus) {}

  /** Live-tracker event for an evaluation change. Best-effort: never throws, never delays the response. */
  private emitEvaluation(evaluationId: string, type: 'evaluation_decided' | 'evaluation_posted', text: string) {
    if (!this.bus) return;
    void this.db
      .query<{ TranscriptId: string }>(
        `SELECT tc.TranscriptId FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId WHERE e.Id = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: evaluationId }],
      )
      .then((r) => {
        const t = r.recordset[0]?.TranscriptId;
        if (t) this.bus?.emit({ type, transcriptId: t, text });
      })
      .catch(() => undefined);
  }

  /**
   * assignedToMe=true + userId means "my queue": evaluations already
   * assigned to this faculty member, plus anything still unassigned
   * (simplification — this app doesn't yet map course ProgramArea text
   * to a specific Department, so any faculty can pick up an unassigned
   * item rather than nobody ever seeing it).
   */
  async list(filters: { statusList?: string[]; assignedToMe?: boolean; userId?: string } = {}) {
    let where = '1=1';
    const inputs: QueryInput[] = [];

    if (filters.statusList?.length) {
      const names = filters.statusList.map((_, i) => `@s${i}`);
      filters.statusList.forEach((s, i) => inputs.push({ name: `s${i}`, type: sql.VarChar(20), value: s }));
      where += ` AND e.Status IN (${names.join(',')})`;
    }
    if (filters.assignedToMe && filters.userId) {
      where += ' AND (e.AssignedToUserId = @uid OR e.AssignedToUserId IS NULL)';
      inputs.push({ name: 'uid', type: sql.UniqueIdentifier, value: filters.userId });
    }

    const res = await this.db.query<EvaluationListRow>(
      `SELECT e.Id, e.Status, e.CreatedAt AS QueuedAt,
              tc.CourseCode, tc.CourseTitle, tc.Grade,
              i.Name AS InstitutionName,
              (SELECT COUNT(*) FROM AIMatchCandidates WHERE EvaluationId = e.Id) AS AiCandidateCount
       FROM Evaluations e
       JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       JOIN Transcripts t        ON t.Id = tc.TranscriptId
       JOIN Institutions i       ON i.Id = t.InstitutionId
       WHERE ${where}
       ORDER BY e.CreatedAt ASC`,
      inputs,
    );

    return res.recordset.map((r) => ({
      id: r.Id,
      status: r.Status,
      queuedAt: r.QueuedAt,
      aiCandidatesCount: r.AiCandidateCount,
      transcriptCourse: {
        courseCode: r.CourseCode,
        courseTitle: r.CourseTitle,
        grade: r.Grade,
        transcript: { institution: { name: r.InstitutionName } },
      },
    }));
  }

  async findById(id: string) {
    const res = await this.db.query<EvaluationDetailRow>(
      `SELECT e.Id, e.Status, e.AIConfidence, e.AIRationale,
              tc.CourseCode, tc.CourseTitle, tc.OriginalCredits, tc.Grade,
              i.Name AS InstitutionName, i.Calendar
       FROM Evaluations e
       JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       JOIN Transcripts t        ON t.Id = tc.TranscriptId
       JOIN Institutions i       ON i.Id = t.InstitutionId
       WHERE e.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Evaluation not found');
    const e = res.recordset[0];

    const candidatesRes = await this.db.query<AiCandidateRow>(
      `SELECT amc.Rank, amc.Score, amc.Rationale,
              c.Id AS BuId, c.Code AS BuCode, c.Title AS BuTitle, c.Credits AS BuCredits
       FROM AIMatchCandidates amc
       JOIN Courses c ON c.Id = amc.BUCourseId
       WHERE amc.EvaluationId = @id
       ORDER BY amc.Rank`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );

    return {
      id: e.Id,
      status: e.Status,
      aiConfidence: e.AIConfidence,
      aiRationale: e.AIRationale,
      transcriptCourse: {
        courseCode: e.CourseCode,
        courseTitle: e.CourseTitle,
        originalCredits: e.OriginalCredits,
        grade: e.Grade,
        transcript: { institution: { name: e.InstitutionName, calendar: e.Calendar } },
      },
      aiCandidates: candidatesRes.recordset.map((c) => ({
        rank: c.Rank,
        score: c.Score,
        rationale: c.Rationale,
        buCourse: { id: c.BuId, code: c.BuCode, title: c.BuTitle, credits: c.BuCredits },
      })),
    };
  }

  async decide(id: string, dto: DecideEvaluationDto, decidedBy: string) {
    const exists = await this.db.query<{ Id: string }>(`SELECT Id FROM Evaluations WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: id },
    ]);
    if (!exists.recordset[0]) throw new NotFoundException('Evaluation not found');

    // OUT-06: one external course counting as several BU courses.
    const multi = dto.mappings?.length ? dto.mappings : dto.buCourseIds?.map((buCourseId) => ({ buCourseId }));
    if (multi && multi.length > 1) {
      const r = await this.mappings.recordMultiDecision(id, decidedBy, dto.outcome, multi, dto.notes ?? null);
      this.emitEvaluation(id, 'evaluation_decided', 'A course decision was recorded');
      return { message: 'Decision recorded', total: r.total, mappings: r.mappings };
    }
    const only = multi?.[0]; // a one-element list is just the single-course path

    await this.db.execute('sp_RecordDecision', [
      { name: 'EvaluationId', type: sql.UniqueIdentifier, value: id },
      { name: 'DecidedBy', type: sql.UniqueIdentifier, value: decidedBy },
      { name: 'Outcome', type: sql.VarChar(20), value: dto.outcome },
      { name: 'BUCourseId', type: sql.Int, value: only?.buCourseId ?? dto.buCourseId ?? null },
      { name: 'AwardedCredits', type: sql.Decimal(5, 2), value: (only as { awardedCredits?: number } | undefined)?.awardedCredits ?? dto.awardedCredits ?? null },
      { name: 'EvaluatorNotes', type: sql.NVarChar(sql.MAX), value: dto.notes ?? null },
    ]);

    await this.mappings.clearDecisionMappings(id).catch(() => undefined);
    this.emitEvaluation(id, 'evaluation_decided', 'A course decision was recorded');
    return { message: 'Decision recorded' };
  }

  async assign(id: string, dto: AssignEvaluationDto) {
    await this.db.query(
      `UPDATE Evaluations
       SET AssignedToUserId = @uid,
           Status = CASE WHEN Status = 'queued' THEN 'in_progress' ELSE Status END,
           UpdatedAt = SYSUTCDATETIME()
       WHERE Id = @id`,
      [
        { name: 'uid', type: sql.UniqueIdentifier, value: dto.userId },
        { name: 'id', type: sql.UniqueIdentifier, value: id },
      ],
    );
    return { message: 'Evaluation assigned' };
  }

  async post(id: string, postedBy: string) {
    await this.db.query(
      `UPDATE Evaluations
       SET Status = 'posted', PostedAt = SYSUTCDATETIME(), PostedBy = @by, UpdatedAt = SYSUTCDATETIME()
       WHERE Id = @id AND Status = 'decided'`,
      [
        { name: 'by', type: sql.UniqueIdentifier, value: postedBy },
        { name: 'id', type: sql.UniqueIdentifier, value: id },
      ],
    );

    // Mirror onto the transcript course so the student sees it as final.
    await this.db.query(
      `UPDATE tc SET tc.Status = 'posted'
       FROM TranscriptCourses tc
       JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
       WHERE e.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );

    this.emitEvaluation(id, 'evaluation_posted', 'A course result was posted');
    return { message: 'Evaluation posted' };
  }
}
