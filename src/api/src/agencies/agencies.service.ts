import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DatabaseService, QueryInput } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
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
  LogoUrl?: string | null;
  HeroImageUrl?: string | null;
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
    logoUrl: row.LogoUrl ?? null,
    heroImageUrl: row.HeroImageUrl ?? null,
  };
}

const EXPORT_COLUMNS = ['id', 'name', 'contactEmail', 'contactPhone', 'country', 'isActive'];

@Injectable()
export class AgenciesService {
  constructor(private db: DatabaseService, private schema: SchemaService) {}

  /** Branding columns exist only once migration 030 is applied. */
  private async imgCols(): Promise<string> {
    return (await this.schema.has('Agencies', 'LogoUrl')) ? ', LogoUrl, HeroImageUrl' : '';
  }

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
      `SELECT Id, Name, ContactEmail, ContactPhone, Country, IsActive, CreatedAt, UpdatedAt${await this.imgCols()}
       FROM Agencies WHERE ${where} ORDER BY Name`,
      inputs,
    );
    return res.recordset.map(mapAgency);
  }

  async findById(id: number) {
    const res = await this.db.query<AgencyRow>(
      `SELECT Id, Name, ContactEmail, ContactPhone, Country, IsActive, CreatedAt, UpdatedAt${await this.imgCols()}
       FROM Agencies WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Agency not found');
    return mapAgency(res.recordset[0]);
  }

  async findByName(name: string) {
    const res = await this.db.query<AgencyRow>(
      `SELECT Id, Name, ContactEmail, ContactPhone, Country, IsActive, CreatedAt, UpdatedAt${await this.imgCols()}
       FROM Agencies WHERE Name = @name`,
      [{ name: 'name', type: sql.NVarChar(200), value: name }],
    );
    return res.recordset[0] ? mapAgency(res.recordset[0]) : null;
  }

  /** Contact e-mail identifies the agency, so two agencies may not share one (case-insensitive). */
  private async assertEmailFree(email: string | undefined | null, exceptId?: number) {
    const e = (email ?? '').trim();
    if (!e) return;
    const r = await this.db.query<{ Id: number; Name: string }>(
      `SELECT TOP 1 Id, Name FROM Agencies WHERE LOWER(ContactEmail) = LOWER(@e) AND (@ex IS NULL OR Id <> @ex)`,
      [
        { name: 'e', type: sql.NVarChar(254), value: e },
        { name: 'ex', type: sql.Int, value: exceptId ?? null },
      ],
    );
    if (r.recordset[0]) throw new ConflictException(`The contact email ${e} is already used by the agency "${r.recordset[0].Name}"`);
  }

  async create(dto: CreateAgencyDto) {
    const existing = await this.findByName(dto.name);
    if (existing) throw new ConflictException('An agency with this name already exists');
    await this.assertEmailFree(dto.contactEmail);

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
    if (dto.logoUrl || dto.heroImageUrl) await this.setImages(res.recordset[0].Id, dto);
    return this.findById(res.recordset[0].Id);
  }

  /** Saves logo / banner when migration 030 is applied (silently ignored before that). */
  private async setImages(id: number, dto: { logoUrl?: string; heroImageUrl?: string }) {
    if (!(await this.schema.has('Agencies', 'LogoUrl'))) return;
    const sets: string[] = [];
    const inputs: QueryInput[] = [{ name: 'id', type: sql.Int, value: id }];
    if (dto.logoUrl !== undefined) { sets.push('LogoUrl = @logo'); inputs.push({ name: 'logo', type: sql.NVarChar(500), value: dto.logoUrl || null }); }
    if (dto.heroImageUrl !== undefined) { sets.push('HeroImageUrl = @hero'); inputs.push({ name: 'hero', type: sql.NVarChar(500), value: dto.heroImageUrl || null }); }
    if (sets.length) await this.db.query(`UPDATE Agencies SET ${sets.join(', ')} WHERE Id = @id`, inputs);
  }

  async update(id: number, dto: UpdateAgencyDto) {
    const current = await this.findById(id);
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const inputs: QueryInput[] = [{ name: 'id', type: sql.Int, value: id }];

    const newName = dto.name?.trim();
    if (dto.name !== undefined && !newName) throw new BadRequestException('Agency name cannot be empty');
    if (newName && newName !== current.name) {
      const clash = await this.findByName(newName);
      if (clash && clash.id !== id) throw new ConflictException('An agency with this name already exists');
    }
    if (dto.contactEmail && dto.contactEmail.toLowerCase() !== (current.contactEmail ?? '').toLowerCase()) {
      await this.assertEmailFree(dto.contactEmail, id);
    }

    if (dto.name !== undefined) {
      sets.push('Name = @name');
      inputs.push({ name: 'name', type: sql.NVarChar(200), value: newName });
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
    await this.setImages(id, dto);
    // Agency users carry the name as free text too; keep it in step so nothing is left pointing at the old name.
    if (newName && newName !== current.name) {
      await this.db.query(`UPDATE Users SET AgencyName = @name WHERE AgencyId = @id OR AgencyName = @old`, [
        { name: 'name', type: sql.NVarChar(200), value: newName },
        { name: 'id', type: sql.Int, value: id },
        { name: 'old', type: sql.NVarChar(200), value: current.name },
      ]);
    }
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
