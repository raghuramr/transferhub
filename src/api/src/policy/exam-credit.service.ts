import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from './schema.service';
import {
  DEFAULT_EXAM_RULES, DocConditionContext, ExamResult, ExamRule, ExamType, countedExamCredits, evaluateExams, scoreOrdinal,
} from './exam-credit';

interface RuleRow {
  Id: number; InstitutionId: number | null; InstitutionName?: string | null; ExamType: ExamType; SubjectPattern: string | null;
  MinScore: string; CreditsAwarded: number | null; IsActive: boolean; Notes: string | null;
}
const mapRule = (r: RuleRow): ExamRule & { institutionName?: string | null } => ({
  id: r.Id, institutionId: r.InstitutionId, institutionName: r.InstitutionName ?? null, examType: r.ExamType, subjectPattern: r.SubjectPattern,
  minScore: r.MinScore, creditsAwarded: r.CreditsAwarded == null ? null : Number(r.CreditsAwarded), isActive: !!r.IsActive, notes: r.Notes,
});

export interface ExamSummary { results: ExamResult[]; countedCredits: number; belowMinimum: ExamResult[] }

/** Exam credit rules (migration 028) and their application to a student's AP / IB / CLEP / A-level results. */
@Injectable()
export class ExamCreditService {
  constructor(private db: DatabaseService, private schema: SchemaService) {}

  ready(): Promise<boolean> {
    return this.schema.has('ExamCreditRules');
  }

  /** All rules, or just the global ones plus one university's when institutionId is given. Defaults when migration 028 is absent. */
  async listRules(institutionId?: number | null): Promise<(ExamRule & { institutionName?: string | null })[]> {
    if (!(await this.ready())) return DEFAULT_EXAM_RULES.map((r, i) => ({ ...r, id: -(i + 1) }));
    const r = await this.db.query<RuleRow>(
      `SELECT x.*, i.Name AS InstitutionName FROM ExamCreditRules x LEFT JOIN Institutions i ON i.Id = x.InstitutionId
       WHERE (@i IS NULL OR x.InstitutionId IS NULL OR x.InstitutionId = @i)
       ORDER BY CASE WHEN x.InstitutionId IS NULL THEN 0 ELSE 1 END, i.Name, x.ExamType, x.SubjectPattern`,
      [{ name: 'i', type: sql.Int, value: institutionId ?? null }],
    );
    return r.recordset.map(mapRule);
  }

  /** Validation shared by the DTO and direct callers: the minimum must be a valid score for the exam. */
  validMin(examType: string, minScore: string): boolean {
    return scoreOrdinal(examType, minScore) != null;
  }

  async saveRule(input: Omit<ExamRule, 'isActive'> & { isActive?: boolean }): Promise<ExamRule> {
    if (!(await this.ready())) throw new Error('Exam credit rules need migration 028 to be applied first.');
    const params = [
      { name: 'id', type: sql.Int, value: input.id ?? null },
      { name: 'i', type: sql.Int, value: input.institutionId ?? null },
      { name: 't', type: sql.VarChar(10), value: input.examType },
      { name: 'p', type: sql.NVarChar(150), value: input.subjectPattern?.trim() || null },
      { name: 'm', type: sql.VarChar(10), value: input.minScore.trim() },
      { name: 'c', type: sql.Decimal(5, 2), value: input.creditsAwarded ?? null },
      { name: 'a', type: sql.Bit, value: input.isActive === false ? 0 : 1 },
      { name: 'n', type: sql.NVarChar(300), value: input.notes ?? null },
    ];
    let id = input.id ?? null;
    if (id) {
      await this.db.query(
        `UPDATE ExamCreditRules SET InstitutionId=@i, ExamType=@t, SubjectPattern=@p, MinScore=@m, CreditsAwarded=@c, IsActive=@a, Notes=@n, UpdatedAt=SYSUTCDATETIME() WHERE Id=@id`,
        params,
      );
    } else {
      const r = await this.db.query<{ Id: number }>(
        `INSERT INTO ExamCreditRules (InstitutionId, ExamType, SubjectPattern, MinScore, CreditsAwarded, IsActive, Notes)
         OUTPUT INSERTED.Id VALUES (@i, @t, @p, @m, @c, @a, @n)`,
        params,
      );
      id = r.recordset[0].Id;
    }
    const row = await this.db.query<RuleRow>(`SELECT * FROM ExamCreditRules WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    return mapRule(row.recordset[0]);
  }

  async removeRule(id: number): Promise<void> {
    if (!(await this.ready())) return;
    await this.db.query(`DELETE FROM ExamCreditRules WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
  }

  /** Each of the student's exams evaluated against the rules of their target university (global defaults otherwise). */
  async summaryFor(studentUserId: string, institutionId: number | null): Promise<ExamSummary> {
    let exams: { ExamType: string; Subject: string; Score: string | null; Credits: number | null }[] = [];
    try {
      const e = await this.db.query<{ ExamType: string; Subject: string; Score: string | null; Credits: number | null }>(
        `SELECT ExamType, Subject, Score, Credits FROM StudentExamCredits WHERE UserId = @u ORDER BY ExamType, Subject`,
        [{ name: 'u', type: sql.UniqueIdentifier, value: studentUserId }],
      );
      exams = e.recordset;
    } catch {
      // migration 015 not applied: no exam credits
    }
    const rules = await this.listRules(institutionId);
    const results = evaluateExams(
      exams.map((x) => ({ examType: x.ExamType, subject: x.Subject, score: x.Score, credits: x.Credits == null ? null : Number(x.Credits) })),
      rules,
      institutionId,
    );
    return { results, countedCredits: countedExamCredits(results), belowMinimum: results.filter((r) => r.state === 'below_minimum') };
  }

  /** What the conditional documents (credential evaluation, translation, exam score report) depend on. */
  async documentContext(transcriptId: string): Promise<DocConditionContext> {
    const r = await this.db.query<{ Outside: number; Native: boolean | null; Intl: boolean | null; Exams: number; OutsideCourses: number }>(
      `SELECT (SELECT COUNT(*) FROM StudentEducation e WHERE e.UserId = t.StudentUserId AND e.IsOutsideUS = 1) AS Outside,
              sp.IsNativeEnglish AS Native, sp.HasIntlCoursework AS Intl,
              (SELECT COUNT(*) FROM StudentExamCredits x WHERE x.UserId = t.StudentUserId) AS Exams,
              (SELECT COUNT(*) FROM TranscriptCourses c WHERE c.TranscriptId = t.Id AND c.IsOutsideUS = 1) AS OutsideCourses
       FROM Transcripts t LEFT JOIN StudentProfiles sp ON sp.UserId = t.StudentUserId WHERE t.Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const x = r.recordset[0];
    return {
      outsideUS: !!x && (x.Outside > 0 || !!x.Intl || x.OutsideCourses > 0),
      nativeEnglish: x?.Native ?? null,
      hasExamCredits: !!x && x.Exams > 0,
    };
  }
}
