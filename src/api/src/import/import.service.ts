import { Injectable, BadRequestException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import type { ImportPayloadDto } from './dto/import-payload.dto';

interface UniversityItem {
  code: string;
  name: string;
  type?: string;
  country?: string;
  state?: string;
  city?: string;
  website?: string;
}

interface ProgramItem {
  name: string;
  code: string;
  universityCode: string;
  description?: string;
}

interface TopicItem {
  title: string;
  description?: string;
  referenceLinks?: { label: string; url: string }[];
}

interface CourseItem {
  code: string;
  name: string;
  credits: number;
  universityCode: string;
  programCode?: string;
  description?: string;
  topics?: TopicItem[];
}

@Injectable()
export class ImportService {
  constructor(private db: DatabaseService) {}

  async preview(dto: ImportPayloadDto) {
    if (dto.type === 'universities') {
      return this.previewUniversities(dto.data as UniversityItem[]);
    } else if (dto.type === 'programs') {
      return this.previewPrograms(dto.data as ProgramItem[]);
    } else if (dto.type === 'courses') {
      return this.previewCourses(dto.data as CourseItem[]);
    }
    throw new BadRequestException('Unknown import type');
  }

  async execute(dto: ImportPayloadDto) {
    if (dto.type === 'universities') {
      return this.importUniversities(dto.data as UniversityItem[]);
    } else if (dto.type === 'programs') {
      return this.importPrograms(dto.data as ProgramItem[]);
    } else if (dto.type === 'courses') {
      return this.importCourses(dto.data as CourseItem[]);
    }
    throw new BadRequestException('Unknown import type');
  }

  private async previewUniversities(items: UniversityItem[]) {
    const results = [];
    for (const item of items) {
      if (!item.code || !item.name) {
        results.push({ item, action: 'skip', reason: 'Missing required fields: code, name' });
        continue;
      }
      const existing = await this.db.query<{ Id: number }>(
        `SELECT Id FROM Institutions WHERE Code = @code`,
        [{ name: 'code', type: sql.NVarChar(20), value: item.code }],
      );
      results.push({
        item,
        action: existing.recordset[0] ? 'update' : 'create',
        existingId: existing.recordset[0]?.Id,
      });
    }
    return { type: 'universities', preview: results };
  }

  private async importUniversities(items: UniversityItem[]) {
    let created = 0, updated = 0;
    const errors: string[] = [];

    for (const item of items) {
      if (!item.code || !item.name) {
        errors.push(`Skipped: missing code or name for item ${JSON.stringify(item)}`);
        continue;
      }
      try {
        const existing = await this.db.query<{ Id: number }>(
          `SELECT Id FROM Institutions WHERE Code = @code`,
          [{ name: 'code', type: sql.NVarChar(20), value: item.code }],
        );
        if (existing.recordset[0]) {
          await this.db.query(
            `UPDATE Institutions SET Name = @name, Country = @country, UpdatedAt = SYSUTCDATETIME()
             WHERE Code = @code`,
            [
              { name: 'name', type: sql.NVarChar(200), value: item.name },
              { name: 'country', type: sql.NVarChar(100), value: item.country || null },
              { name: 'code', type: sql.NVarChar(20), value: item.code },
            ],
          );
          updated++;
        } else {
          await this.db.query(
            `INSERT INTO Institutions (Code, Name, Country, IsBU)
             VALUES (@code, @name, @country, 0)`,
            [
              { name: 'code', type: sql.NVarChar(20), value: item.code },
              { name: 'name', type: sql.NVarChar(200), value: item.name },
              { name: 'country', type: sql.NVarChar(100), value: item.country || null },
            ],
          );
          created++;
        }
      } catch (e) {
        errors.push(`Error processing ${item.code}: ${(e as Error).message}`);
      }
    }
    return { type: 'universities', created, updated, errors };
  }

  private async previewPrograms(items: ProgramItem[]) {
    const results = [];
    for (const item of items) {
      if (!item.code || !item.name || !item.universityCode) {
        results.push({ item, action: 'skip', reason: 'Missing required fields: code, name, universityCode' });
        continue;
      }
      const inst = await this.db.query<{ Id: number }>(
        `SELECT Id FROM Institutions WHERE Code = @code`,
        [{ name: 'code', type: sql.NVarChar(20), value: item.universityCode }],
      );
      if (!inst.recordset[0]) {
        results.push({ item, action: 'skip', reason: `University "${item.universityCode}" not found` });
        continue;
      }
      const existing = await this.db.query<{ Id: number }>(
        `SELECT Id FROM Programs WHERE Code = @code AND InstitutionId = @instId`,
        [
          { name: 'code', type: sql.NVarChar(20), value: item.code },
          { name: 'instId', type: sql.Int, value: inst.recordset[0].Id },
        ],
      );
      results.push({
        item,
        action: existing.recordset[0] ? 'update' : 'create',
        universityId: inst.recordset[0].Id,
        existingId: existing.recordset[0]?.Id,
      });
    }
    return { type: 'programs', preview: results };
  }

  private async importPrograms(items: ProgramItem[]) {
    let created = 0, updated = 0;
    const errors: string[] = [];

    for (const item of items) {
      if (!item.code || !item.name || !item.universityCode) {
        errors.push(`Skipped: missing required fields for ${JSON.stringify(item)}`);
        continue;
      }
      try {
        const inst = await this.db.query<{ Id: number }>(
          `SELECT Id FROM Institutions WHERE Code = @code`,
          [{ name: 'code', type: sql.NVarChar(20), value: item.universityCode }],
        );
        if (!inst.recordset[0]) {
          errors.push(`University "${item.universityCode}" not found — skipped program "${item.code}"`);
          continue;
        }
        const instId = inst.recordset[0].Id;
        const existing = await this.db.query<{ Id: number }>(
          `SELECT Id FROM Programs WHERE Code = @code AND InstitutionId = @instId`,
          [
            { name: 'code', type: sql.NVarChar(20), value: item.code },
            { name: 'instId', type: sql.Int, value: instId },
          ],
        );
        if (existing.recordset[0]) {
          await this.db.query(
            `UPDATE Programs SET Name = @name, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`,
            [
              { name: 'name', type: sql.NVarChar(200), value: item.name },
              { name: 'id', type: sql.Int, value: existing.recordset[0].Id },
            ],
          );
          updated++;
        } else {
          await this.db.query(
            `INSERT INTO Programs (Name, Code, InstitutionId, IsActive)
             VALUES (@name, @code, @instId, 1)`,
            [
              { name: 'name', type: sql.NVarChar(200), value: item.name },
              { name: 'code', type: sql.NVarChar(20), value: item.code },
              { name: 'instId', type: sql.Int, value: instId },
            ],
          );
          created++;
        }
      } catch (e) {
        errors.push(`Error processing program ${item.code}: ${(e as Error).message}`);
      }
    }
    return { type: 'programs', created, updated, errors };
  }

  private async previewCourses(items: CourseItem[]) {
    const results = [];
    for (const item of items) {
      if (!item.code || !item.name || !item.universityCode) {
        results.push({ item, action: 'skip', reason: 'Missing required fields: code, name, universityCode' });
        continue;
      }
      const inst = await this.db.query<{ Id: number }>(
        `SELECT Id FROM Institutions WHERE Code = @code`,
        [{ name: 'code', type: sql.NVarChar(20), value: item.universityCode }],
      );
      if (!inst.recordset[0]) {
        results.push({ item, action: 'skip', reason: `University "${item.universityCode}" not found` });
        continue;
      }
      const existing = await this.db.query<{ Id: number }>(
        `SELECT Id FROM Courses WHERE Code = @code AND InstitutionId = @instId`,
        [
          { name: 'code', type: sql.NVarChar(20), value: item.code },
          { name: 'instId', type: sql.Int, value: inst.recordset[0].Id },
        ],
      );
      results.push({
        item,
        action: existing.recordset[0] ? 'update' : 'create',
        universityId: inst.recordset[0].Id,
        topicsCount: item.topics?.length ?? 0,
        existingId: existing.recordset[0]?.Id,
      });
    }
    return { type: 'courses', preview: results };
  }

  private async importCourses(items: CourseItem[]) {
    let created = 0, updated = 0, topicsAdded = 0;
    const errors: string[] = [];

    for (const item of items) {
      if (!item.code || !item.name || !item.universityCode) {
        errors.push(`Skipped: missing required fields for ${JSON.stringify(item)}`);
        continue;
      }
      try {
        const inst = await this.db.query<{ Id: number }>(
          `SELECT Id FROM Institutions WHERE Code = @code`,
          [{ name: 'code', type: sql.NVarChar(20), value: item.universityCode }],
        );
        if (!inst.recordset[0]) {
          errors.push(`University "${item.universityCode}" not found — skipped course "${item.code}"`);
          continue;
        }
        const instId = inst.recordset[0].Id;

        let programId: number | null = null;
        if (item.programCode) {
          const prog = await this.db.query<{ Id: number }>(
            `SELECT Id FROM Programs WHERE Code = @code AND InstitutionId = @instId`,
            [
              { name: 'code', type: sql.NVarChar(20), value: item.programCode },
              { name: 'instId', type: sql.Int, value: instId },
            ],
          );
          programId = prog.recordset[0]?.Id ?? null;
        }

        const existing = await this.db.query<{ Id: number }>(
          `SELECT Id FROM Courses WHERE Code = @code AND InstitutionId = @instId`,
          [
            { name: 'code', type: sql.NVarChar(20), value: item.code },
            { name: 'instId', type: sql.Int, value: instId },
          ],
        );

        let courseId: number;
        if (existing.recordset[0]) {
          courseId = existing.recordset[0].Id;
          await this.db.query(
            `UPDATE Courses SET Title = @title, Credits = @credits, Description = @desc WHERE Id = @id`,
            [
              { name: 'title', type: sql.NVarChar(300), value: item.name },
              { name: 'credits', type: sql.Decimal(5, 2), value: item.credits },
              { name: 'desc', type: sql.NVarChar(sql.MAX), value: item.description || null },
              { name: 'id', type: sql.Int, value: courseId },
            ],
          );
          updated++;
        } else {
          const res = await this.db.query<{ Id: number }>(
            `INSERT INTO Courses (Code, Title, Credits, InstitutionId, ProgramId, Description, IsBU, IsActive)
             OUTPUT inserted.Id
             VALUES (@code, @title, @credits, @instId, @progId, @desc, 0, 1)`,
            [
              { name: 'code', type: sql.NVarChar(20), value: item.code },
              { name: 'title', type: sql.NVarChar(300), value: item.name },
              { name: 'credits', type: sql.Decimal(5, 2), value: item.credits },
              { name: 'instId', type: sql.Int, value: instId },
              { name: 'progId', type: sql.Int, value: programId },
              { name: 'desc', type: sql.NVarChar(sql.MAX), value: item.description || null },
            ],
          );
          courseId = res.recordset[0].Id;
          created++;
        }

        // Import topics if provided
        if (item.topics?.length) {
          for (const topic of item.topics) {
            if (!topic.title) continue;
            const existingTopic = await this.db.query<{ Id: number }>(
              `SELECT Id FROM CourseTopics WHERE CourseId = @cId AND Title = @title`,
              [
                { name: 'cId', type: sql.Int, value: courseId },
                { name: 'title', type: sql.NVarChar(300), value: topic.title },
              ],
            );
            if (!existingTopic.recordset[0]) {
              const refLinks = topic.referenceLinks
                ? JSON.stringify(topic.referenceLinks)
                : null;
              await this.db.query(
                `INSERT INTO CourseTopics (CourseId, Title, Description, ReferenceLinksJson)
                 VALUES (@cId, @title, @desc, @refs)`,
                [
                  { name: 'cId', type: sql.Int, value: courseId },
                  { name: 'title', type: sql.NVarChar(300), value: topic.title },
                  { name: 'desc', type: sql.NVarChar(sql.MAX), value: topic.description || null },
                  { name: 'refs', type: sql.NVarChar(sql.MAX), value: refLinks },
                ],
              );
              topicsAdded++;
            }
          }
        }
      } catch (e) {
        errors.push(`Error processing course ${item.code}: ${(e as Error).message}`);
      }
    }
    return { type: 'courses', created, updated, topicsAdded, errors };
  }
}
