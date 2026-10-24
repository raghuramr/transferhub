import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService, QueryInput } from '../database/database.service';
import * as sql from 'mssql';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { UpdateAgencyDto } from './dto/update-agency.dto';
import { parseCsvRows, toCsv } from '../common/csv.util';

interface AgencyRow {
  Id: number;
  Name: string;
  ContactEmail: string | null;
  ContactPhone: string | null;
  Country: string | null;
  IsActive: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

function mapAgency(row: AgencyRow) {
  return {
    id: row.Id,
    name: row.Name,
    contactEmail: row.ContactEmail,
    contactPhone: row.ContactPhone,
    country: row.Country,
    isActive: !!row.IsActive,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

const EXPORT_COLUMNS = ['id', 'name', 'contactEmail', 'contactPhone', 'country', 'isActive'];

@Injectable()
export class AgenciesService {
  constructor(private db: DatabaseService) {}

  async findAll(filters: { search?: string; isActive?: boolean } = {}) {
    let where = '1=1';
    const inputs: QueryInput[] = [];
    if (filters.search) {
      where += ' AND (Name LIKE @q OR ContactEmail LIKE @q OR Country LIKE @q)';
      inputs.push({ name: 'q', type: sql.NVarChar(200), value: `%${filters.search}%` });
    }
    if (filters.isActive !== undefined) {
      where += ' AND IsActive = @active';
      inputs.push({ name: 'active', type: sql.Bit, value: filters.isActive ? 1 : 0 });
    }

    const res = await this.db.query<AgencyRow>(
      `SELECT Id, Name, ContactEmail, ContactPhone, Country, IsActive, CreatedAt, UpdatedAt
       FROM Agencies WHERE ${where} ORDER BY Name`,
      inputs,
    );
    return res.recordset.map(mapAgency);
  }

  async findById(id: number) {
    const res = await this.db.query<AgencyRow>(
      `SELECT Id, Name, ContactEmail, ContactPhone, Country, IsActive, CreatedAt, UpdatedAt
       FROM Agencies WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Agency not found');
    return mapAgency(res.recordset[0]);
  }

  async findByName(name: string) {
    const res = await this.db.query<AgencyRow>(
      `SELECT Id, Name, ContactEmail, ContactPhone, Country, IsActive, CreatedAt, UpdatedAt
       FROM Agencies WHERE Name = @name`,
      [{ name: 'name', type: sql.NVarChar(200), value: name }],
    );
    return res.recordset[0] ? mapAgency(res.recordset[0]) : null;
  }

  async create(dto: CreateAgencyDto) {
    const existing = await this.findByName(dto.name);
    if (existing) throw new ConflictException('An agency with this name already exists');

    const res = await this.db.query<{ Id: number }>(
      `INSERT INTO Agencies (Name, ContactEmail, ContactPhone, Country, IsActive)
       OUTPUT inserted.Id
       VALUES (@name, @email, @phone, @country, @active)`,
      [
        { name: 'name', type: sql.NVarChar(200), value: dto.name },
        { name: 'email', type: sql.NVarChar(254), value: dto.contactEmail || null },
        { name: 'phone', type: sql.NVarChar(50), value: dto.contactPhone || null },
        { name: 'country', type: sql.NVarChar(100), value: dto.country || null },
        { name: 'active', type: sql.Bit, value: dto.isActive !== false ? 1 : 0 },
      ],
    );
    return this.findById(res.recordset[0].Id);
  }

  async update(id: number, dto: UpdateAgencyDto) {
    await this.findById(id);
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const inputs: QueryInput[] = [{ name: 'id', type: sql.Int, value: id }];

    if (dto.name !== undefined) {
      sets.push('Name = @name');
      inputs.push({ name: 'name', type: sql.NVarChar(200), value: dto.name });
    }
    if (dto.contactEmail !== undefined) {
      sets.push('ContactEmail = @email');
      inputs.push({ name: 'email', type: sql.NVarChar(254), value: dto.contactEmail || null });
    }
    if (dto.contactPhone !== undefined) {
      sets.push('ContactPhone = @phone');
      inputs.push({ name: 'phone', type: sql.NVarChar(50), value: dto.contactPhone || null });
    }
    if (dto.country !== undefined) {
      sets.push('Country = @country');
      inputs.push({ name: 'country', type: sql.NVarChar(100), value: dto.country || null });
    }
    if (dto.isActive !== undefined) {
      sets.push('IsActive = @active');
      inputs.push({ name: 'active', type: sql.Bit, value: dto.isActive ? 1 : 0 });
    }

    await this.db.query(`UPDATE Agencies SET ${sets.join(', ')} WHERE Id = @id`, inputs);
    return this.findById(id);
  }

  /** Soft delete — Users.AgencyId references Agencies(Id). */
  async deactivate(id: number) {
    await this.findById(id);
    await this.db.query(`UPDATE Agencies SET IsActive = 0, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    return { message: 'Agency deactivated' };
  }

  async exportCsv(): Promise<string> {
    const rows = await this.findAll();
    return toCsv(rows, EXPORT_COLUMNS);
  }

  /** Upserts by Name (Agencies has no Code column — Name is unique). */
  async importCsv(text: string) {
    const rows = parseCsvRows(text);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const name = row.name || row.Name;
      if (!name) {
        errors.push(`Skipped row (missing name): ${JSON.stringify(row)}`);
        continue;
      }
      const isActiveRaw = row.isActive ?? row.IsActive;
      const dto: CreateAgencyDto = {
        name,
        contactEmail: row.contactEmail || row.ContactEmail || undefined,
        contactPhone: row.contactPhone || row.ContactPhone || undefined,
        country: row.country || row.Country || undefined,
        isActive: isActiveRaw === undefined || isActiveRaw === '' ? undefined : /^(true|1)$/i.test(isActiveRaw),
      };

      const existing = await this.findByName(name);
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
