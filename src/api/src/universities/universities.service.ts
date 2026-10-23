import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import { CreateUniversityDto } from './dto/create-university.dto';
import { UpdateUniversityDto } from './dto/update-university.dto';
import { parseCsvRows, toCsv } from '../common/csv.util';

// "Universities" in the UI == the existing `Institutions` SQL table.
// See CLAUDE.md / migration 008 for why the table itself keeps its name.
function mapUniversity(row: any) {
  return {
    id: row.Id,
    code: row.Code,
    name: row.Name,
    calendar: row.Calendar,
    type: row.Type,
    isBU: !!row.IsBU,
    isActive: !!row.IsActive,
    source: row.Source,
    createdAt: row.CreatedAt,
  };
}

const EXPORT_COLUMNS = ['id', 'code', 'name', 'calendar', 'type', 'isBU', 'isActive', 'source'];

@Injectable()
export class UniversitiesService {
  constructor(private db: DatabaseService) {}

  async findAll(filters: { search?: string; isActive?: boolean } = {}) {
    let where = '1=1';
    const inputs: any[] = [];
    if (filters.search) {
      where += ' AND (Code LIKE @q OR Name LIKE @q)';
      inputs.push({ name: 'q', type: sql.NVarChar(200), value: `%${filters.search}%` });
    }
    if (filters.isActive !== undefined) {
      where += ' AND IsActive = @active';
      inputs.push({ name: 'active', type: sql.Bit, value: filters.isActive ? 1 : 0 });
    }

    const res = await this.db.query<any>(
      `SELECT Id, Code, Name, Calendar, Type, IsBU, IsActive, Source, CreatedAt
       FROM Institutions WHERE ${where} ORDER BY Name`,
      inputs,
    );
    return res.recordset.map(mapUniversity);
  }

  async findById(id: number) {
    const res = await this.db.query<any>(
      `SELECT Id, Code, Name, Calendar, Type, IsBU, IsActive, Source, CreatedAt
       FROM Institutions WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('University not found');
    return mapUniversity(res.recordset[0]);
  }

  async findByCode(code: string) {
    const res = await this.db.query<any>(
      `SELECT Id, Code, Name, Calendar, Type, IsBU, IsActive, Source, CreatedAt
       FROM Institutions WHERE Code = @code`,
      [{ name: 'code', type: sql.VarChar(20), value: code }],
    );
    return res.recordset[0] ? mapUniversity(res.recordset[0]) : null;
  }

  async create(dto: CreateUniversityDto) {
    const existing = await this.findByCode(dto.code);
    if (existing) throw new ConflictException('A university with this code already exists');

    const res = await this.db.query<any>(
      `INSERT INTO Institutions (Code, Name, Calendar, Type, IsBU, IsActive, Source)
       OUTPUT inserted.Id
       VALUES (@code, @name, @calendar, @type, @isBU, @active, @source)`,
      [
        { name: 'code', type: sql.VarChar(20), value: dto.code },
        { name: 'name', type: sql.NVarChar(200), value: dto.name },
        { name: 'calendar', type: sql.VarChar(10), value: dto.calendar ?? 'semester' },
        { name: 'type', type: sql.VarChar(30), value: dto.type ?? 'university' },
        { name: 'isBU', type: sql.Bit, value: dto.isBU ? 1 : 0 },
        { name: 'active', type: sql.Bit, value: dto.isActive !== false ? 1 : 0 },
        { name: 'source', type: sql.NVarChar(500), value: dto.source || null },
      ],
    );
    return this.findById(res.recordset[0].Id);
  }

  async update(id: number, dto: UpdateUniversityDto) {
    await this.findById(id);
    const sets: string[] = [];
    const inputs: any[] = [{ name: 'id', type: sql.Int, value: id }];

    if (dto.code !== undefined) {
      sets.push('Code = @code');
      inputs.push({ name: 'code', type: sql.VarChar(20), value: dto.code });
    }
    if (dto.name !== undefined) {
      sets.push('Name = @name');
      inputs.push({ name: 'name', type: sql.NVarChar(200), value: dto.name });
    }
    if (dto.calendar !== undefined) {
      sets.push('Calendar = @calendar');
      inputs.push({ name: 'calendar', type: sql.VarChar(10), value: dto.calendar });
    }
    if (dto.type !== undefined) {
      sets.push('Type = @type');
      inputs.push({ name: 'type', type: sql.VarChar(30), value: dto.type });
    }
    if (dto.isBU !== undefined) {
      sets.push('IsBU = @isBU');
      inputs.push({ name: 'isBU', type: sql.Bit, value: dto.isBU ? 1 : 0 });
    }
    if (dto.isActive !== undefined) {
      sets.push('IsActive = @active');
      inputs.push({ name: 'active', type: sql.Bit, value: dto.isActive ? 1 : 0 });
    }
    if (dto.source !== undefined) {
      sets.push('Source = @source');
      inputs.push({ name: 'source', type: sql.NVarChar(500), value: dto.source || null });
    }

    if (sets.length > 0) {
      await this.db.query(`UPDATE Institutions SET ${sets.join(', ')} WHERE Id = @id`, inputs);
    }
    return this.findById(id);
  }

  /** Soft delete — never hard-deletes, Courses/Transcripts/etc. reference Institutions(Id). */
  async deactivate(id: number) {
    await this.findById(id);
    await this.db.query(`UPDATE Institutions SET IsActive = 0 WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    return { message: 'University deactivated' };
  }

  async exportCsv(): Promise<string> {
    const rows = await this.findAll();
    return toCsv(rows, EXPORT_COLUMNS);
  }

  /** Upserts by Code. Returns a small summary of what happened. */
  async importCsv(text: string) {
    const rows = parseCsvRows(text);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const code = row.code || row.Code;
      const name = row.name || row.Name;
      if (!code || !name) {
        errors.push(`Skipped row (missing code/name): ${JSON.stringify(row)}`);
        continue;
      }
      const existing = await this.findByCode(code);
      const dto: CreateUniversityDto = {
        code,
        name,
        calendar: row.calendar || row.Calendar || undefined,
        type: row.type || row.Type || undefined,
        isBU: /^(true|1)$/i.test(row.isBU || row.IsBU || ''),
        source: row.source || row.Source || undefined,
        isActive: (row.isActive ?? row.IsActive) === undefined || (row.isActive ?? row.IsActive) === ''
          ? undefined
          : /^(true|1)$/i.test(row.isActive || row.IsActive),
      };
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
