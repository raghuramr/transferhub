import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from './schema.service';
import { ProgramRule, RuleCourse, RuleFlag, RuleInput, RuleType, evaluateProgrammeRules, validateRuleInput } from './programme-rules';

interface RuleRow {
  Id: number;
  InstitutionId: number;
  InstitutionCode: string | null;
  InstitutionName: string | null;
  ProgramId: number | null;
  ProgramName: string | null;
  RuleCode: string | null;
  RuleType: RuleType;
  LevelMin: number | null;
  MaxCount: number | null;
  MinCount: number | null;
  CourseCodePattern: string | null;
  SubstituteFor: string | null;
  ParamsJson: string | null;
  Description: string;
  IsActive: boolean;
  UpdatedAt: Date | null;
}

const parseParams = (s: string | null): Record<string, unknown> => {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

const mapRule = (r: RuleRow): ProgramRule & { institutionName: string | null; updatedAt: Date | null } => ({
  id: r.Id,
  institutionId: r.InstitutionId,
  institutionCode: r.InstitutionCode,
  institutionName: r.InstitutionName,
  programId: r.ProgramId,
  programName: r.ProgramName,
  ruleCode: r.RuleCode,
  ruleType: r.RuleType,
  levelMin: r.LevelMin,
  maxCount: r.MaxCount,
  minCount: r.MinCount,
  courseCodePattern: r.CourseCodePattern,
  substituteFor: r.SubstituteFor,
  params: parseParams(r.ParamsJson),
  description: r.Description,
  isActive: !!r.IsActive,
  updatedAt: r.UpdatedAt,
});

export type ProgramRuleInput = RuleInput & { institutionId?: number; programId?: number | null; ruleCode?: string | null; isActive?: boolean };

/** Programme rules (PRG-03..08): admin CRUD plus the lookup the engine uses for one transcript. */
@Injectable()
export class ProgrammeRulesService {
  constructor(private db: DatabaseService, private schema: SchemaService) {}

  ready(): Promise<boolean> {
    return this.schema.has('ProgramRules');
  }

  private static readonly SELECT = `
    SELECT r.Id, r.InstitutionId, i.Code AS InstitutionCode, i.Name AS InstitutionName, r.ProgramId, p.Name AS ProgramName,
           r.RuleCode, r.RuleType, r.LevelMin, r.MaxCount, r.MinCount, r.CourseCodePattern, r.SubstituteFor, r.ParamsJson,
           r.Description, r.IsActive, r.UpdatedAt
    FROM ProgramRules r
    JOIN Institutions i ON i.Id = r.InstitutionId
    LEFT JOIN Programs p ON p.Id = r.ProgramId`;

  // ── admin ─────────────────────────────────────────────────

  async list(filter: { institutionId?: number; programId?: number; includeInactive?: boolean }) {
    if (!(await this.ready())) return { ready: false, rules: [] };
    const where: string[] = ['1=1'];
    const inputs = [];
    if (filter.institutionId != null) { where.push('r.InstitutionId = @i'); inputs.push({ name: 'i', type: sql.Int, value: filter.institutionId }); }
    if (filter.programId != null) { where.push('r.ProgramId = @p'); inputs.push({ name: 'p', type: sql.Int, value: filter.programId }); }
    if (!filter.includeInactive) where.push('r.IsActive = 1');
    const r = await this.db.query<RuleRow>(
      `${ProgrammeRulesService.SELECT} WHERE ${where.join(' AND ')} ORDER BY i.Name, p.Name, r.RuleCode, r.Id`,
      inputs,
    );
    return { ready: true, rules: r.recordset.map(mapRule) };
  }

  private async checkScope(institutionId: number, programId: number | null) {
    const inst = await this.db.query<{ Id: number }>(`SELECT Id FROM Institutions WHERE Id = @i`, [{ name: 'i', type: sql.Int, value: institutionId }]);
    if (!inst.recordset[0]) throw new BadRequestException('Choose a university.');
    if (programId != null) {
      const p = await this.db.query<{ InstitutionId: number }>(`SELECT InstitutionId FROM Programs WHERE Id = @p`, [{ name: 'p', type: sql.Int, value: programId }]);
      if (!p.recordset[0]) throw new BadRequestException('That programme does not exist.');
      // A programme may also be offered by other universities (ProgramUniversities, migration 011); accept either link.
      let ok = p.recordset[0].InstitutionId === institutionId;
      if (!ok && (await this.schema.has('ProgramUniversities'))) {
        const pu = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM ProgramUniversities WHERE ProgramId = @p AND InstitutionId = @i`, [
          { name: 'p', type: sql.Int, value: programId },
          { name: 'i', type: sql.Int, value: institutionId },
        ]);
        ok = !!pu.recordset[0]?.N;
      }
      if (!ok) throw new BadRequestException('That programme does not belong to the chosen university.');
    }
  }

  private inputsOf(d: ProgramRuleInput, userId: string) {
    return [
      { name: 'type', type: sql.VarChar(30), value: d.ruleType },
      { name: 'code', type: sql.VarChar(20), value: d.ruleCode?.trim() || null },
      { name: 'lvl', type: sql.Int, value: d.levelMin ?? null },
      { name: 'mx', type: sql.Int, value: d.maxCount ?? null },
      { name: 'mn', type: sql.Int, value: d.minCount ?? null },
      { name: 'pat', type: sql.NVarChar(200), value: d.courseCodePattern?.trim() || null },
      { name: 'sub', type: sql.NVarChar(100), value: d.substituteFor?.trim() || null },
      { name: 'pj', type: sql.NVarChar(sql.MAX), value: d.params && Object.keys(d.params).length ? JSON.stringify(d.params) : null },
      { name: 'desc', type: sql.NVarChar(500), value: (d.description ?? '').trim() },
      { name: 'u', type: sql.UniqueIdentifier, value: userId },
    ];
  }

  async create(d: ProgramRuleInput, userId: string) {
    if (!(await this.ready())) throw new ServiceUnavailableException('Programme rules need database migration 027, which has not been applied yet.');
    const errs = validateRuleInput(d);
    if (d.institutionId == null) errs.unshift('Choose a university.');
    if (errs.length) throw new BadRequestException(errs.join(' '));
    await this.checkScope(d.institutionId!, d.programId ?? null);
    const r = await this.db.query<{ Id: number }>(
      `INSERT INTO ProgramRules (InstitutionId, ProgramId, RuleCode, RuleType, LevelMin, MaxCount, MinCount, CourseCodePattern, SubstituteFor, ParamsJson, Description, UpdatedBy)
       OUTPUT INSERTED.Id
       VALUES (@inst, @prog, @code, @type, @lvl, @mx, @mn, @pat, @sub, @pj, @desc, @u)`,
      [
        { name: 'inst', type: sql.Int, value: d.institutionId },
        { name: 'prog', type: sql.Int, value: d.programId ?? null },
        ...this.inputsOf(d, userId),
      ],
    );
    return this.get(r.recordset[0].Id);
  }

  async get(id: number) {
    const r = await this.db.query<RuleRow>(`${ProgrammeRulesService.SELECT} WHERE r.Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    if (!r.recordset[0]) throw new NotFoundException('Rule not found');
    return mapRule(r.recordset[0]);
  }

  async update(id: number, d: ProgramRuleInput, userId: string) {
    if (!(await this.ready())) throw new ServiceUnavailableException('Programme rules need database migration 027, which has not been applied yet.');
    const cur = await this.get(id);
    const merged: ProgramRuleInput = {
      ruleType: d.ruleType ?? cur.ruleType,
      ruleCode: d.ruleCode !== undefined ? d.ruleCode : cur.ruleCode,
      levelMin: d.levelMin !== undefined ? d.levelMin : cur.levelMin,
      maxCount: d.maxCount !== undefined ? d.maxCount : cur.maxCount,
      minCount: d.minCount !== undefined ? d.minCount : cur.minCount,
      courseCodePattern: d.courseCodePattern !== undefined ? d.courseCodePattern : cur.courseCodePattern,
      substituteFor: d.substituteFor !== undefined ? d.substituteFor : cur.substituteFor,
      params: d.params !== undefined ? d.params : cur.params,
      description: d.description ?? cur.description,
    };
    const errs = validateRuleInput(merged);
    if (errs.length) throw new BadRequestException(errs.join(' '));
    const institutionId = d.institutionId ?? cur.institutionId;
    const programId = d.programId !== undefined ? d.programId : cur.programId;
    await this.checkScope(institutionId, programId ?? null);
    await this.db.query(
      `UPDATE ProgramRules SET InstitutionId=@inst, ProgramId=@prog, RuleCode=@code, RuleType=@type, LevelMin=@lvl, MaxCount=@mx, MinCount=@mn,
              CourseCodePattern=@pat, SubstituteFor=@sub, ParamsJson=@pj, Description=@desc, IsActive=@act, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u
       WHERE Id=@id`,
      [
        { name: 'id', type: sql.Int, value: id },
        { name: 'inst', type: sql.Int, value: institutionId },
        { name: 'prog', type: sql.Int, value: programId ?? null },
        { name: 'act', type: sql.Bit, value: (d.isActive ?? cur.isActive) ? 1 : 0 },
        ...this.inputsOf(merged, userId),
      ],
    );
    return this.get(id);
  }

  async setActive(id: number, active: boolean, userId: string) {
    if (!(await this.ready())) throw new ServiceUnavailableException('Programme rules need database migration 027, which has not been applied yet.');
    await this.get(id);
    await this.db.query(`UPDATE ProgramRules SET IsActive=@a, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@id`, [
      { name: 'a', type: sql.Bit, value: active ? 1 : 0 },
      { name: 'u', type: sql.UniqueIdentifier, value: userId },
      { name: 'id', type: sql.Int, value: id },
    ]);
    return this.get(id);
  }

  // ── engine ────────────────────────────────────────────────

  /**
   * Rules that apply to a student: the target university's rules, narrowed to the target programme (plus the rules
   * that cover every programme) when one is on file; with no programme, all of the university's rules.
   */
  async rulesForStudent(studentUserId: string, transcriptId: string): Promise<ProgramRule[]> {
    if (!(await this.ready())) return [];
    let instId: number | null = null;
    let progId: number | null = null;
    try {
      const t = await this.db.query<{ SpInst: number | null; SpProg: number | null; TrInst: number | null }>(
        `SELECT sp.TargetInstitutionId AS SpInst, sp.TargetProgramId AS SpProg, t.TargetInstitutionId AS TrInst
         FROM Transcripts t LEFT JOIN StudentProfiles sp ON sp.UserId = t.StudentUserId WHERE t.Id = @t`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      );
      const x = t.recordset[0];
      instId = x?.TrInst ?? x?.SpInst ?? null;
      progId = x?.SpProg ?? null;
    } catch {
      // older schema: fall through to BU
    }
    if (instId == null) {
      const bu = await this.db.query<{ Id: number }>(`SELECT TOP 1 Id FROM Institutions WHERE Code = 'BU'`);
      instId = bu.recordset[0]?.Id ?? null;
    }
    if (instId == null) return [];
    const r = await this.db.query<RuleRow>(
      `${ProgrammeRulesService.SELECT}
       WHERE r.InstitutionId = @i AND r.IsActive = 1 AND (@p IS NULL OR r.ProgramId IS NULL OR r.ProgramId = @p)`,
      [
        { name: 'i', type: sql.Int, value: instId },
        { name: 'p', type: sql.Int, value: progId },
      ],
    );
    return r.recordset.map(mapRule);
  }

  /** Flags per transcript course (keyed by lower-cased id) for one request. */
  async evaluate(studentUserId: string, transcriptId: string, courses: RuleCourse[]): Promise<Map<string, RuleFlag[]>> {
    const rules = await this.rulesForStudent(studentUserId, transcriptId);
    if (!rules.length) return new Map();
    const byId = evaluateProgrammeRules(rules, courses);
    return new Map([...byId].map(([id, f]) => [id.toLowerCase(), f]));
  }
}
