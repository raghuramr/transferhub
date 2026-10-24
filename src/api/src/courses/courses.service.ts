import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, QueryInput } from '../database/database.service';
import * as sql from 'mssql';
import { CreateCourseDto } from './dto/create-course.dto';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { parseCsvRows, toCsv } from '../common/csv.util';

function mapProgram(r: ProgramRow) {
  return {
    id: r.Id,
    institutionId: r.InstitutionId,
    area: r.Area,
    name: r.Name,
    degree: r.Degree,
    school: r.School,
    keyRules: r.KeyRules,
    source: r.Source,
    matchStrength: r.MatchStrength,
    notes: r.Notes,
    isActive: !!r.IsActive,
  };
}

const EXPORT_COLUMNS = ['id', 'institutionCode', 'programName', 'code', 'title', 'programArea', 'requirementType', 'credits', 'level', 'verified', 'notes'];

interface CourseRow {
  Id: number;
  InstitutionId: number;
  ProgramId: number | null;
  Code: string;
  Title: string;
  ProgramArea: string | null;
  RequirementType: string | null;
  Credits: number;
  Description: string | null;
  Level: string | null;
  Verified: string | null;
  Notes: string | null;
  IsActive?: boolean;
  InstitutionCode: string;
  InstitutionName: string;
  ProgramName: string | null;
}

interface ProgramRow {
  Id: number;
  InstitutionId: number;
  Area: string | null;
  Name: string;
  Degree: string | null;
  School: string | null;
  KeyRules: string | null;
  Source: string | null;
  MatchStrength: string | null;
  Notes: string | null;
  IsActive: boolean;
}

interface InstitutionRow {
  Id: number;
  Name: string;
  Code: string;
  Calendar: string | null;
  Type: string | null;
  IsBU: boolean;
}

interface EquivalencyRow {
  Id: number;
  Outcome: string;
  BUCredits: number | null;
  MatchLevel: string | null;
  Rationale: string | null;
  Source: string | null;
  DecidedAt: Date | null;
  BuCode: string;
  BuTitle: string;
  BuCourseCredits: number;
  ExtCode: string;
  ExtTitle: string;
  ExtCredits: number;
  InstitutionName: string;
  InstitutionCode: string;
}

interface DepartmentRow {
  Id: number;
  Name: string;
  Code: string;
}

function mapCourse(row: CourseRow) {
  return {
    id: row.Id,
    institutionId: row.InstitutionId,
    institutionCode: row.InstitutionCode,
    institutionName: row.InstitutionName,
    programId: row.ProgramId,
    programName: row.ProgramName,
    code: row.Code,
    title: row.Title,
    programArea: row.ProgramArea,
    requirementType: row.RequirementType,
    credits: row.Credits,
    description: row.Description,
    level: row.Level,
    verified: row.Verified,
    notes: row.Notes,
    isActive: row.IsActive === undefined ? undefined : !!row.IsActive,
  };
}

const COURSE_SELECT = `
  c.Id, c.InstitutionId, c.ProgramId, c.Code, c.Title, c.ProgramArea, c.RequirementType,
  c.Credits, c.Description, c.Level, c.Verified, c.Notes, c.IsActive,
  i.Code AS InstitutionCode, i.Name AS InstitutionName,
  pr.Name AS ProgramName
  FROM Courses c
  JOIN Institutions i ON i.Id = c.InstitutionId
  LEFT JOIN Programs pr ON pr.Id = c.ProgramId
`;

@Injectable()
export class CoursesService {
  constructor(private db: DatabaseService) {}

  async findBuCourses(filters: { programArea?: string; search?: string } = {}, requestingUserId?: string) {
    let where = `i.Code = 'BU'`;
    const inputs: QueryInput[] = [];
    if (filters.programArea) {
      where += ' AND c.ProgramArea = @area';
      inputs.push({ name: 'area', type: sql.NVarChar(100), value: filters.programArea });
    }
    if (filters.search) {
      where += ' AND (c.Code LIKE @q OR c.Title LIKE @q)';
      inputs.push({ name: 'q', type: sql.NVarChar(100), value: `%${filters.search}%` });
    }

    // Scoped the same as findExternalCourses — BU is no longer treated as an
    // always-visible fixed home institution now that the product is heading
    // toward a multi-tenant model (see CLAUDE.md "Future direction").
    const scope = await this.getUniversityScope(requestingUserId);
    if (scope) {
      const scopeParams = scope.map((instId, i) => {
        const name = `scopeInst${i}`;
        inputs.push({ name, type: sql.Int, value: instId });
        return `@${name}`;
      });
      where += ` AND c.InstitutionId IN (${scopeParams.join(', ')})`;
    }

    const res = await this.db.query<CourseRow>(
      `SELECT ${COURSE_SELECT}
       WHERE ${where} AND c.IsActive = 1
       ORDER BY c.Code`,
      inputs,
    );
    return res.recordset.map(mapCourse);
  }

  /**
   * No rows in UserScopeUniversities for this user = unrestricted (sees
   * everything) — must remain the default. Returns null when unrestricted,
   * or the list of InstitutionIds the user is scoped to otherwise.
   */
  private async getUniversityScope(userId?: string): Promise<number[] | null> {
    if (!userId) return null;
    const res = await this.db.query<{ InstitutionId: number }>(
      `SELECT InstitutionId FROM UserScopeUniversities WHERE UserId = @uid`,
      [{ name: 'uid', type: sql.UniqueIdentifier, value: userId }],
    );
    return res.recordset.length ? res.recordset.map((r) => r.InstitutionId) : null;
  }

  async findExternalCourses(institutionCode?: string, search?: string, requestingUserId?: string) {
    let where = `i.Code <> 'BU'`;
    const inputs: QueryInput[] = [];
    if (institutionCode) {
      where += ' AND i.Code = @code';
      inputs.push({ name: 'code', type: sql.VarChar(20), value: institutionCode });
    }
    if (search) {
      where += ' AND (c.Code LIKE @q OR c.Title LIKE @q)';
      inputs.push({ name: 'q', type: sql.NVarChar(100), value: `%${search}%` });
    }

    const scope = await this.getUniversityScope(requestingUserId);
    if (scope) {
      const scopeParams = scope.map((instId, i) => {
        const name = `scopeInst${i}`;
        inputs.push({ name, type: sql.Int, value: instId });
        return `@${name}`;
      });
      where += ` AND c.InstitutionId IN (${scopeParams.join(', ')})`;
    }

    const res = await this.db.query<CourseRow>(
      `SELECT ${COURSE_SELECT}
       WHERE ${where} AND c.IsActive = 1
       ORDER BY i.Code, c.Code`,
      inputs,
    );
    return res.recordset.map(mapCourse);
  }

  async findById(id: number) {
    const res = await this.db.query<CourseRow>(
      `SELECT ${COURSE_SELECT}
       WHERE c.Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Course not found');
    return mapCourse(res.recordset[0]);
  }

  async findPrograms(institutionId?: number, includeInactive = false) {
    let where = '1=1';
    const inputs: QueryInput[] = [];
    if (institutionId !== undefined) {
      where += ' AND InstitutionId = @instId';
      inputs.push({ name: 'instId', type: sql.Int, value: institutionId });
    }
    if (!includeInactive) {
      where += ' AND IsActive = 1';
    }
    const res = await this.db.query<ProgramRow>(
      `SELECT Id, InstitutionId, Area, Name, Degree, School, KeyRules, Source, MatchStrength, Notes, IsActive
       FROM Programs WHERE ${where} ORDER BY Area, Name`,
      inputs,
    );
    return res.recordset.map(mapProgram);
  }

  async findProgramById(id: number) {
    const res = await this.db.query<ProgramRow>(
      `SELECT Id, InstitutionId, Area, Name, Degree, School, KeyRules, Source, MatchStrength, Notes, IsActive
       FROM Programs WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Program not found');
    return mapProgram(res.recordset[0]);
  }

  async createProgram(dto: CreateProgramDto) {
    const res = await this.db.query<{ Id: number }>(
      `INSERT INTO Programs (InstitutionId, Area, Name, Degree, School, KeyRules, Source, MatchStrength, Notes, IsActive)
       OUTPUT inserted.Id
       VALUES (@institutionId, @area, @name, @degree, @school, @keyRules, @source, @matchStrength, @notes, @isActive)`,
      [
        { name: 'institutionId', type: sql.Int, value: dto.institutionId },
        { name: 'area', type: sql.NVarChar(100), value: dto.area || null },
        { name: 'name', type: sql.NVarChar(200), value: dto.name },
        { name: 'degree', type: sql.VarChar(10), value: dto.degree || null },
        { name: 'school', type: sql.NVarChar(200), value: dto.school || null },
        { name: 'keyRules', type: sql.NVarChar(sql.MAX), value: dto.keyRules || null },
        { name: 'source', type: sql.NVarChar(500), value: dto.source || null },
        { name: 'matchStrength', type: sql.VarChar(20), value: dto.matchStrength || null },
        { name: 'notes', type: sql.NVarChar(sql.MAX), value: dto.notes || null },
        { name: 'isActive', type: sql.Bit, value: dto.isActive !== false ? 1 : 0 },
      ],
    );
    return this.findProgramById(res.recordset[0].Id);
  }

  async updateProgram(id: number, dto: UpdateProgramDto) {
    await this.findProgramById(id);
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const inputs: QueryInput[] = [{ name: 'id', type: sql.Int, value: id }];

    if (dto.institutionId !== undefined) {
      sets.push('InstitutionId = @institutionId');
      inputs.push({ name: 'institutionId', type: sql.Int, value: dto.institutionId });
    }
    if (dto.area !== undefined) {
      sets.push('Area = @area');
      inputs.push({ name: 'area', type: sql.NVarChar(100), value: dto.area || null });
    }
    if (dto.name !== undefined) {
      sets.push('Name = @name');
      inputs.push({ name: 'name', type: sql.NVarChar(200), value: dto.name });
    }
    if (dto.degree !== undefined) {
      sets.push('Degree = @degree');
      inputs.push({ name: 'degree', type: sql.VarChar(10), value: dto.degree || null });
    }
    if (dto.school !== undefined) {
      sets.push('School = @school');
      inputs.push({ name: 'school', type: sql.NVarChar(200), value: dto.school || null });
    }
    if (dto.keyRules !== undefined) {
      sets.push('KeyRules = @keyRules');
      inputs.push({ name: 'keyRules', type: sql.NVarChar(sql.MAX), value: dto.keyRules || null });
    }
    if (dto.source !== undefined) {
      sets.push('Source = @source');
      inputs.push({ name: 'source', type: sql.NVarChar(500), value: dto.source || null });
    }
    if (dto.matchStrength !== undefined) {
      sets.push('MatchStrength = @matchStrength');
      inputs.push({ name: 'matchStrength', type: sql.VarChar(20), value: dto.matchStrength || null });
    }
    if (dto.notes !== undefined) {
      sets.push('Notes = @notes');
      inputs.push({ name: 'notes', type: sql.NVarChar(sql.MAX), value: dto.notes || null });
    }
    if (dto.isActive !== undefined) {
      sets.push('IsActive = @isActive');
      inputs.push({ name: 'isActive', type: sql.Bit, value: dto.isActive ? 1 : 0 });
    }

    await this.db.query(`UPDATE Programs SET ${sets.join(', ')} WHERE Id = @id`, inputs);
    return this.findProgramById(id);
  }

  /** Soft delete — Courses.ProgramId can reference a Program historically. */
  async deactivateProgram(id: number) {
    await this.findProgramById(id);
    await this.db.query(`UPDATE Programs SET IsActive = 0, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    return { message: 'Program deactivated' };
  }

  async findInstitutions() {
    const res = await this.db.query<InstitutionRow>(
      `SELECT Id, Name, Code, Calendar, Type, IsBU
       FROM Institutions WHERE IsActive = 1 ORDER BY Name`,
    );
    return res.recordset.map((r) => ({
      id: r.Id,
      name: r.Name,
      code: r.Code,
      calendar: r.Calendar,
      type: r.Type,
      isBU: !!r.IsBU,
    }));
  }

  async findEquivalencies(buCourseId?: number, externalCourseId?: number) {
    let where = '1=1';
    const inputs: QueryInput[] = [];
    if (buCourseId) {
      where += ' AND e.BUCourseId = @buId';
      inputs.push({ name: 'buId', type: sql.Int, value: buCourseId });
    }
    if (externalCourseId) {
      where += ' AND e.ExternalCourseId = @extId';
      inputs.push({ name: 'extId', type: sql.Int, value: externalCourseId });
    }

    const res = await this.db.query<EquivalencyRow>(
      `SELECT e.Id, e.Outcome, e.BUCredits, e.MatchLevel, e.Rationale, e.Source, e.DecidedAt,
              bu.Code AS BuCode, bu.Title AS BuTitle, bu.Credits AS BuCourseCredits,
              ext.Code AS ExtCode, ext.Title AS ExtTitle, ext.Credits AS ExtCredits,
              inst.Name AS InstitutionName, inst.Code AS InstitutionCode
       FROM Equivalencies e
       JOIN Courses bu  ON bu.Id = e.BUCourseId
       JOIN Courses ext ON ext.Id = e.ExternalCourseId
       JOIN Institutions inst ON inst.Id = ext.InstitutionId
       WHERE ${where} AND e.IsActive = 1
       ORDER BY inst.Code, ext.Code`,
      inputs,
    );
    return res.recordset.map((r) => ({
      id: r.Id,
      outcome: r.Outcome,
      buCredits: r.BUCredits,
      matchLevel: r.MatchLevel,
      rationale: r.Rationale,
      source: r.Source,
      decidedAt: r.DecidedAt,
      buCourse: { code: r.BuCode, title: r.BuTitle, credits: r.BuCourseCredits },
      externalCourse: { code: r.ExtCode, title: r.ExtTitle, credits: r.ExtCredits },
      institution: { name: r.InstitutionName, code: r.InstitutionCode },
    }));
  }

  async getDepartments() {
    const res = await this.db.query<DepartmentRow>(
      `SELECT Id, Name, Code FROM Departments WHERE IsActive = 1 ORDER BY Name`,
    );
    return res.recordset.map((r) => ({ id: r.Id, name: r.Name, code: r.Code }));
  }

  async create(dto: CreateCourseDto) {
    const res = await this.db.query<{ Id: number }>(
      `INSERT INTO Courses (InstitutionId, ProgramId, Code, Title, Description, Credits, ProgramArea, RequirementType, IsActive)
       OUTPUT inserted.Id
       VALUES (@instId, @programId, @code, @title, @desc, @credits, @area, @reqType, @active)`,
      [
        { name: 'instId', type: sql.Int, value: dto.institutionId },
        { name: 'programId', type: sql.Int, value: dto.programId ?? null },
        { name: 'code', type: sql.NVarChar(30), value: dto.code },
        { name: 'title', type: sql.NVarChar(300), value: dto.title },
        { name: 'desc', type: sql.NVarChar(sql.MAX), value: dto.description || null },
        { name: 'credits', type: sql.Decimal(5, 2), value: dto.credits },
        { name: 'area', type: sql.NVarChar(100), value: dto.programArea || null },
        { name: 'reqType', type: sql.NVarChar(100), value: dto.requirementType || null },
        { name: 'active', type: sql.Bit, value: dto.isActive !== false ? 1 : 0 },
      ],
    );
    return this.findById(res.recordset[0].Id);
  }

  async findByInstitutionAndCode(institutionId: number, code: string) {
    const res = await this.db.query<{ Id: number }>(
      `SELECT Id FROM Courses WHERE InstitutionId = @instId AND Code = @code`,
      [
        { name: 'instId', type: sql.Int, value: institutionId },
        { name: 'code', type: sql.NVarChar(30), value: code },
      ],
    );
    return res.recordset[0]?.Id as number | undefined;
  }

  async update(id: number, dto: Partial<CreateCourseDto>) {
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const inputs: QueryInput[] = [{ name: 'id', type: sql.Int, value: id }];

    if (dto.institutionId !== undefined) {
      sets.push('InstitutionId = @instId');
      inputs.push({ name: 'instId', type: sql.Int, value: dto.institutionId });
    }
    if (dto.programId !== undefined) {
      sets.push('ProgramId = @programId');
      inputs.push({ name: 'programId', type: sql.Int, value: dto.programId });
    }
    if (dto.code !== undefined) {
      sets.push('Code = @code');
      inputs.push({ name: 'code', type: sql.NVarChar(30), value: dto.code });
    }
    if (dto.title !== undefined) {
      sets.push('Title = @title');
      inputs.push({ name: 'title', type: sql.NVarChar(300), value: dto.title });
    }
    if (dto.description !== undefined) {
      sets.push('Description = @desc');
      inputs.push({ name: 'desc', type: sql.NVarChar(sql.MAX), value: dto.description });
    }
    if (dto.credits !== undefined) {
      sets.push('Credits = @credits');
      inputs.push({ name: 'credits', type: sql.Decimal(5, 2), value: dto.credits });
    }
    if (dto.programArea !== undefined) {
      sets.push('ProgramArea = @area');
      inputs.push({ name: 'area', type: sql.NVarChar(100), value: dto.programArea });
    }
    if (dto.requirementType !== undefined) {
      sets.push('RequirementType = @reqType');
      inputs.push({ name: 'reqType', type: sql.NVarChar(100), value: dto.requirementType });
    }
    if (dto.isActive !== undefined) {
      sets.push('IsActive = @active');
      inputs.push({ name: 'active', type: sql.Bit, value: dto.isActive ? 1 : 0 });
    }

    await this.db.query(`UPDATE Courses SET ${sets.join(', ')} WHERE Id = @id`, inputs);
    return this.findById(id);
  }

  async deactivate(id: number) {
    await this.findById(id);
    await this.db.query(`UPDATE Courses SET IsActive = 0 WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    return { message: 'Course deactivated' };
  }

  async exportCsv(): Promise<string> {
    const [bu, external] = await Promise.all([this.findBuCourses(), this.findExternalCourses()]);
    return toCsv([...bu, ...external], EXPORT_COLUMNS);
  }

  /** Upserts by (institutionCode, code). Institution must already exist (create it first under Universities). */
  async importCsv(text: string) {
    const rows = parseCsvRows(text);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const institutionCode = row.institutionCode || row.InstitutionCode;
      const code = row.code || row.Code;
      const title = row.title || row.Title;
      const creditsRaw = row.credits || row.Credits;
      if (!institutionCode || !code || !title || !creditsRaw) {
        errors.push(`Skipped row (missing institutionCode/code/title/credits): ${JSON.stringify(row)}`);
        continue;
      }
      const instRes = await this.db.query<{ Id: number }>(`SELECT Id FROM Institutions WHERE Code = @code`, [
        { name: 'code', type: sql.VarChar(20), value: institutionCode },
      ]);
      const institutionId = instRes.recordset[0]?.Id;
      if (!institutionId) {
        errors.push(`Skipped row (unknown institutionCode "${institutionCode}"): ${JSON.stringify(row)}`);
        continue;
      }

      const dto: CreateCourseDto = {
        institutionId,
        code,
        title,
        credits: parseFloat(creditsRaw),
        programArea: row.programArea || row.ProgramArea || undefined,
        requirementType: row.requirementType || row.RequirementType || undefined,
      };

      const existingId = await this.findByInstitutionAndCode(institutionId, code);
      if (existingId) {
        await this.update(existingId, dto);
        updated++;
      } else {
        await this.create(dto);
        created++;
      }
    }
    return { created, updated, errors };
  }
}
