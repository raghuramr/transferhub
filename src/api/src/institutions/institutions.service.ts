import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';
import { parseCsvRows, toCsv } from '../common/csv.util';

// "Institutions" in the UI/API == the `AcademicUnits` SQL table (a school
// or college within a University, e.g. "College of Arts & Sciences").
// See CLAUDE.md / migration 008 for the naming rationale.
function mapInstitution(row: any) {
  return {
    id: row.Id,
    universityId: row.InstitutionId ?? null,
    universityCode: row.UniversityCode ?? null,
    universityName: row.UniversityName ?? null,
    name: row.Name,
    code: row.Code,
    isActive: !!row.IsActive,
    logoUrl: row.LogoUrl ?? null,
    heroImageUrl: row.HeroImageUrl ?? null,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

const EXPORT_COLUMNS = ['id', 'universityCode', 'universityName', 'code', 'name', 'isActive'];

// LEFT JOIN: an AcademicUnit ("Institution") may have no University mapping
// yet (AcademicUnits.InstitutionId is nullable as of migration 016).
const BASE_SELECT = `
  SELECT au.Id, au.InstitutionId, au.Name, au.Code, au.IsActive, au.LogoUrl, au.HeroImageUrl, au.CreatedAt, au.UpdatedAt,
         i.Code AS UniversityCode, i.Name AS UniversityName
  FROM AcademicUnits au
  LEFT JOIN Institutions i ON i.Id = au.InstitutionId
`;

@Injectable()
export class InstitutionsService {
  constructor(private db: DatabaseService) {}

  async findAll(
    filters: { universityId?: number; unmapped?: boolean; search?: string; isActive?: boolean } = {},
  ) {
    let where = '1=1';
    const inputs: any[] = [];
    if (filters.unmapped) {
      // "— Unmapped —" filter: Institutions with no University assigned yet.
      where += ' AND au.InstitutionId IS NULL';
    } else if (filters.universityId !== undefined) {
      where += ' AND au.InstitutionId = @uid';
      inputs.push({ name: 'uid', type: sql.Int, value: filters.universityId });
    }
    if (filters.search) {
      where += ' AND (au.Code LIKE @q OR au.Name LIKE @q)';
      inputs.push({ name: 'q', type: sql.NVarChar(200), value: `%${filters.search}%` });
    }
    if (filters.isActive !== undefined) {
      where += ' AND au.IsActive = @active';
      inputs.push({ name: 'active', type: sql.Bit, value: filters.isActive ? 1 : 0 });
    }

    const res = await this.db.query<any>(`${BASE_SELECT} WHERE ${where} ORDER BY i.Name, au.Name`, inputs);
    return res.recordset.map(mapInstitution);
  }

  async findById(id: number) {
    const res = await this.db.query<any>(`${BASE_SELECT} WHERE au.Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    if (!res.recordset[0]) throw new NotFoundException('Institution not found');
    return mapInstitution(res.recordset[0]);
  }

  async findByUniversityAndName(universityId: number | null | undefined, name: string) {
    // Unmapped institutions (no universityId) aren't checked for duplicate
    // names — only (university, name) pairs are meant to be unique.
    if (universityId === null || universityId === undefined) return null;
    const res = await this.db.query<any>(`${BASE_SELECT} WHERE au.InstitutionId = @uid AND au.Name = @name`, [
      { name: 'uid', type: sql.Int, value: universityId },
      { name: 'name', type: sql.NVarChar(200), value: name },
    ]);
    return res.recordset[0] ? mapInstitution(res.recordset[0]) : null;
  }

  private async resolveUniversityId(code: string): Promise<number | null> {
    const res = await this.db.query<any>(`SELECT Id FROM Institutions WHERE Code = @code`, [
      { name: 'code', type: sql.VarChar(20), value: code },
    ]);
    return res.recordset[0]?.Id ?? null;
  }

  async create(dto: CreateInstitutionDto) {
    const universityId = dto.universityId ?? null;
    const existing = await this.findByUniversityAndName(universityId, dto.name);
    if (existing) throw new ConflictException('An institution with this name already exists for that university');

    const res = await this.db.query<any>(
      `INSERT INTO AcademicUnits (InstitutionId, Name, Code, IsActive, LogoUrl, HeroImageUrl)
       OUTPUT inserted.Id
       VALUES (@uid, @name, @code, @active, @logoUrl, @heroImageUrl)`,
      [
        { name: 'uid', type: sql.Int, value: universityId },
        { name: 'name', type: sql.NVarChar(200), value: dto.name },
        { name: 'code', type: sql.VarChar(30), value: dto.code || null },
        { name: 'active', type: sql.Bit, value: dto.isActive !== false ? 1 : 0 },
        { name: 'logoUrl', type: sql.NVarChar(500), value: dto.logoUrl || null },
        { name: 'heroImageUrl', type: sql.NVarChar(500), value: dto.heroImageUrl || null },
      ],
    );
    return this.findById(res.recordset[0].Id);
  }

  async update(id: number, dto: UpdateInstitutionDto) {
    await this.findById(id);
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const inputs: any[] = [{ name: 'id', type: sql.Int, value: id }];

    if (dto.universityId !== undefined) {
      sets.push('InstitutionId = @uid');
      inputs.push({ name: 'uid', type: sql.Int, value: dto.universityId });
    }
    if (dto.name !== undefined) {
      sets.push('Name = @name');
      inputs.push({ name: 'name', type: sql.NVarChar(200), value: dto.name });
    }
    if (dto.code !== undefined) {
      sets.push('Code = @code');
      inputs.push({ name: 'code', type: sql.VarChar(30), value: dto.code || null });
    }
    if (dto.isActive !== undefined) {
      sets.push('IsActive = @active');
      inputs.push({ name: 'active', type: sql.Bit, value: dto.isActive ? 1 : 0 });
    }
    if (dto.logoUrl !== undefined) {
      sets.push('LogoUrl = @logoUrl');
      inputs.push({ name: 'logoUrl', type: sql.NVarChar(500), value: dto.logoUrl || null });
    }
    if (dto.heroImageUrl !== undefined) {
      sets.push('HeroImageUrl = @heroImageUrl');
      inputs.push({ name: 'heroImageUrl', type: sql.NVarChar(500), value: dto.heroImageUrl || null });
    }

    await this.db.query(`UPDATE AcademicUnits SET ${sets.join(', ')} WHERE Id = @id`, inputs);
    return this.findById(id);
  }

  /** Soft delete — never hard-deletes, Programs/etc. reference AcademicUnits going forward. */
  async deactivate(id: number) {
    await this.findById(id);
    await this.db.query(`UPDATE AcademicUnits SET IsActive = 0, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    return { message: 'Institution deactivated' };
  }

  async exportCsv(filters: { universityId?: number } = {}): Promise<string> {
    const rows = await this.findAll(filters);
    return toCsv(rows, EXPORT_COLUMNS);
  }

  /**
   * Upserts by (universityCode, code) when a code is given, otherwise by
   * (universityCode, name). Expects columns: universityCode, code, name, isActive.
   */
  async importCsv(text: string) {
    const rows = parseCsvRows(text);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const universityCode = row.universityCode || row.UniversityCode;
      const name = row.name || row.Name;
      const code = row.code || row.Code || undefined;
      if (!universityCode || !name) {
        errors.push(`Skipped row (missing universityCode/name): ${JSON.stringify(row)}`);
        continue;
      }
      const universityId = await this.resolveUniversityId(universityCode);
      if (!universityId) {
        errors.push(`Skipped row (unknown universityCode "${universityCode}")`);
        continue;
      }

      const isActiveRaw = row.isActive ?? row.IsActive;
      const dto: CreateInstitutionDto = {
        universityId,
        name,
        code,
        isActive: isActiveRaw === undefined || isActiveRaw === '' ? undefined : /^(true|1)$/i.test(isActiveRaw),
      };

      const existing = await this.findByUniversityAndName(universityId, name);
      if (existing) {
        await this.update(existing.id, dto);
        updated++;
      } else {
        await this.create({ ...dto, isActive: dto.isActive !== false });
        created++;
      }
    }
    return { created, updated, errors };
  }
}
