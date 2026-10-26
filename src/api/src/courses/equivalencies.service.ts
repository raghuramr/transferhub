import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import type { CreateEquivalencyDto, UpdateEquivalencyDto } from './dto/equivalency.dto';

interface Row {
  Id: number;
  ExternalCourseId: number;
  BUCourseId: number;
  Outcome: string;
  BUCredits: number | null;
  MatchLevel: string | null;
  Rationale: string | null;
  Source: string | null;
  IsActive: boolean;
  EffectiveFrom: Date | null;
  EffectiveTo: Date | null;
  BuCode: string;
  BuTitle: string;
  BuInstitutionCode: string;
  ExtCode: string;
  ExtTitle: string;
  ExtInstitutionCode: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

function parseDate(v: string | null | undefined, label: string): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (!DATE_ONLY.test(v) || Number.isNaN(Date.parse(v))) throw new BadRequestException(`${label} must be YYYY-MM-DD`);
  return new Date(`${v}T00:00:00Z`);
}

/** current = in effect today, upcoming = starts later, expired = ended, inactive = switched off. */
function statusOf(r: { IsActive: boolean; EffectiveFrom: Date | null; EffectiveTo: Date | null }) {
  if (!r.IsActive) return 'inactive';
  const today = new Date().toISOString().slice(0, 10);
  const from = iso(r.EffectiveFrom);
  const to = iso(r.EffectiveTo);
  if (from && from > today) return 'upcoming';
  if (to && to < today) return 'expired';
  return 'current';
}

@Injectable()
export class EquivalenciesService {
  constructor(
    private db: DatabaseService,
    private schema: SchemaService,
  ) {}

  private hasDates() {
    return this.schema.has('Equivalencies', 'EffectiveFrom');
  }

  async list(filters: { externalCourseId?: number; buCourseId?: number; status?: string; search?: string }) {
    const dates = await this.hasDates();
    let where = '1=1';
    const inputs: QueryInput[] = [];
    if (filters.externalCourseId) {
      where += ' AND e.ExternalCourseId = @ext';
      inputs.push({ name: 'ext', type: sql.Int, value: filters.externalCourseId });
    }
    if (filters.buCourseId) {
      where += ' AND e.BUCourseId = @bu';
      inputs.push({ name: 'bu', type: sql.Int, value: filters.buCourseId });
    }
    if (filters.search) {
      where += ' AND (bu.Code LIKE @q OR bu.Title LIKE @q OR ext.Code LIKE @q OR ext.Title LIKE @q)';
      inputs.push({ name: 'q', type: sql.NVarChar(200), value: `%${filters.search}%` });
    }
    const res = await this.db.query<Row>(
      `SELECT e.Id, e.ExternalCourseId, e.BUCourseId, e.Outcome, e.BUCredits, e.MatchLevel, e.Rationale, e.Source, e.IsActive,
              ${dates ? 'e.EffectiveFrom, e.EffectiveTo' : 'CAST(NULL AS DATE) AS EffectiveFrom, CAST(NULL AS DATE) AS EffectiveTo'},
              bu.Code AS BuCode, bu.Title AS BuTitle, bi.Code AS BuInstitutionCode,
              ext.Code AS ExtCode, ext.Title AS ExtTitle, xi.Code AS ExtInstitutionCode
       FROM Equivalencies e
       JOIN Courses bu  ON bu.Id = e.BUCourseId
       JOIN Institutions bi ON bi.Id = bu.InstitutionId
       JOIN Courses ext ON ext.Id = e.ExternalCourseId
       JOIN Institutions xi ON xi.Id = ext.InstitutionId
       WHERE ${where}
       ORDER BY xi.Code, ext.Code, bu.Code`,
      inputs,
    );
    const rows = res.recordset.map((r) => ({
      id: r.Id,
      externalCourseId: r.ExternalCourseId,
      buCourseId: r.BUCourseId,
      outcome: r.Outcome,
      buCredits: r.BUCredits,
      matchLevel: r.MatchLevel,
      rationale: r.Rationale,
      source: r.Source,
      isActive: !!r.IsActive,
      effectiveFrom: iso(r.EffectiveFrom),
      effectiveTo: iso(r.EffectiveTo),
      status: statusOf(r),
      buCourse: { code: r.BuCode, title: r.BuTitle, institutionCode: r.BuInstitutionCode },
      externalCourse: { code: r.ExtCode, title: r.ExtTitle, institutionCode: r.ExtInstitutionCode },
    }));
    return filters.status ? rows.filter((r) => r.status === filters.status) : rows;
  }

  private assertRange(from: Date | null, to: Date | null) {
    if (from && to && from > to) throw new BadRequestException('The end date must be on or after the start date');
  }

  async create(dto: CreateEquivalencyDto, userId: string) {
    const dates = await this.hasDates();
    const from = parseDate(dto.effectiveFrom, 'effectiveFrom');
    const to = parseDate(dto.effectiveTo, 'effectiveTo');
    if ((from || to) && !dates) throw new BadRequestException('Effective dates need migration 017 to be applied');
    this.assertRange(from, to);
    if (dto.externalCourseId === dto.buCourseId) throw new BadRequestException('A course cannot be equivalent to itself');

    const res = await this.db.query<{ Id: number }>(
      `INSERT INTO Equivalencies (ExternalCourseId, BUCourseId, Outcome, BUCredits, MatchLevel, Rationale, Source, DecidedBy, DecidedAt${dates ? ', EffectiveFrom, EffectiveTo' : ''})
       OUTPUT inserted.Id
       VALUES (@ext, @bu, @outcome, @credits, @level, @why, 'evaluator', @by, SYSUTCDATETIME()${dates ? ', @from, @to' : ''})`,
      [
        { name: 'ext', type: sql.Int, value: dto.externalCourseId },
        { name: 'bu', type: sql.Int, value: dto.buCourseId },
        { name: 'outcome', type: sql.VarChar(20), value: dto.outcome },
        { name: 'credits', type: sql.Decimal(5, 2), value: dto.buCredits ?? null },
        { name: 'level', type: sql.VarChar(40), value: dto.matchLevel ?? null },
        { name: 'why', type: sql.NVarChar(sql.MAX), value: dto.rationale ?? null },
        { name: 'by', type: sql.UniqueIdentifier, value: userId },
        ...(dates
          ? [
              { name: 'from', type: sql.Date, value: from },
              { name: 'to', type: sql.Date, value: to },
            ]
          : []),
      ],
    );
    return { id: res.recordset[0].Id };
  }

  async update(id: number, dto: UpdateEquivalencyDto) {
    const dates = await this.hasDates();
    const existing = await this.db.query<{ EffectiveFrom: Date | null; EffectiveTo: Date | null }>(
      `SELECT ${dates ? 'EffectiveFrom, EffectiveTo' : 'CAST(NULL AS DATE) AS EffectiveFrom, CAST(NULL AS DATE) AS EffectiveTo'} FROM Equivalencies WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!existing.recordset[0]) throw new NotFoundException('Equivalency not found');

    const sets: string[] = [];
    const inputs: QueryInput[] = [{ name: 'id', type: sql.Int, value: id }];
    const set = (col: string, name: string, type: QueryInput["type"], value: unknown) => {
      sets.push(`${col} = @${name}`);
      inputs.push({ name, type, value });
    };
    if (dto.outcome !== undefined) set('Outcome', 'outcome', sql.VarChar(20), dto.outcome);
    if (dto.buCredits !== undefined) set('BUCredits', 'credits', sql.Decimal(5, 2), dto.buCredits);
    if (dto.matchLevel !== undefined) set('MatchLevel', 'level', sql.VarChar(40), dto.matchLevel);
    if (dto.rationale !== undefined) set('Rationale', 'why', sql.NVarChar(sql.MAX), dto.rationale);
    if (dto.isActive !== undefined) set('IsActive', 'active', sql.Bit, dto.isActive ? 1 : 0);

    if (dto.effectiveFrom !== undefined || dto.effectiveTo !== undefined) {
      if (!dates) throw new BadRequestException('Effective dates need migration 017 to be applied');
      const from = dto.effectiveFrom !== undefined ? parseDate(dto.effectiveFrom, 'effectiveFrom') : existing.recordset[0].EffectiveFrom;
      const to = dto.effectiveTo !== undefined ? parseDate(dto.effectiveTo, 'effectiveTo') : existing.recordset[0].EffectiveTo;
      this.assertRange(from, to);
      if (dto.effectiveFrom !== undefined) set('EffectiveFrom', 'from', sql.Date, from);
      if (dto.effectiveTo !== undefined) set('EffectiveTo', 'to', sql.Date, to);
    }
    if (sets.length === 0) return { id };
    if (dates) sets.push('UpdatedAt = SYSUTCDATETIME()');
    await this.db.query(`UPDATE Equivalencies SET ${sets.join(', ')} WHERE Id = @id`, inputs);
    return { id };
  }

  async deactivate(id: number) {
    return this.update(id, { isActive: false });
  }
}
