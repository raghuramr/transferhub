import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, QueryInput } from '../database/database.service';
import * as sql from 'mssql';
import { CreateCourseTopicDto, UpdateCourseTopicDto } from './dto/course-topic.dto';

interface CourseTopicRow {
  Id: number;
  CourseId: number;
  Title: string;
  Description: string | null;
  SortOrder: number;
  // Deliberately dynamic: a flexible {label, url}[] blob stored as JSON text.
  ReferenceLinksJson: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
}

function mapTopic(row: CourseTopicRow) {
  let referenceLinks: { label: string; url: string }[] = [];
  if (row.ReferenceLinksJson) {
    try {
      referenceLinks = JSON.parse(row.ReferenceLinksJson);
    } catch {
      referenceLinks = [];
    }
  }
  return {
    id: row.Id,
    courseId: row.CourseId,
    title: row.Title,
    description: row.Description,
    sortOrder: row.SortOrder,
    referenceLinks,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

@Injectable()
export class CourseTopicsService {
  constructor(private db: DatabaseService) {}

  async findByCourse(courseId: number) {
    const res = await this.db.query<CourseTopicRow>(
      `SELECT Id, CourseId, Title, Description, SortOrder, ReferenceLinksJson, CreatedAt, UpdatedAt
       FROM CourseTopics WHERE CourseId = @courseId ORDER BY SortOrder, Id`,
      [{ name: 'courseId', type: sql.Int, value: courseId }],
    );
    return res.recordset.map(mapTopic);
  }

  async findById(id: number) {
    const res = await this.db.query<CourseTopicRow>(
      `SELECT Id, CourseId, Title, Description, SortOrder, ReferenceLinksJson, CreatedAt, UpdatedAt
       FROM CourseTopics WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Course topic not found');
    return mapTopic(res.recordset[0]);
  }

  async create(courseId: number, dto: CreateCourseTopicDto, userId?: string) {
    const res = await this.db.query<{ Id: number }>(
      `INSERT INTO CourseTopics (CourseId, Title, Description, SortOrder, ReferenceLinksJson, CreatedBy, UpdatedBy)
       OUTPUT inserted.Id
       VALUES (@courseId, @title, @desc, @sortOrder, @links, @createdBy, @createdBy)`,
      [
        { name: 'courseId', type: sql.Int, value: courseId },
        { name: 'title', type: sql.NVarChar(200), value: dto.title },
        { name: 'desc', type: sql.NVarChar(sql.MAX), value: dto.description ?? null },
        { name: 'sortOrder', type: sql.Int, value: dto.sortOrder ?? 0 },
        { name: 'links', type: sql.NVarChar(sql.MAX), value: dto.referenceLinks ? JSON.stringify(dto.referenceLinks) : null },
        { name: 'createdBy', type: sql.UniqueIdentifier, value: userId ?? null },
      ],
    );
    return this.findById(res.recordset[0].Id);
  }

  async update(id: number, dto: UpdateCourseTopicDto, userId?: string) {
    await this.findById(id);
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()', 'UpdatedBy = @updatedBy'];
    const inputs: QueryInput[] = [
      { name: 'id', type: sql.Int, value: id },
      { name: 'updatedBy', type: sql.UniqueIdentifier, value: userId ?? null },
    ];

    if (dto.title !== undefined) {
      sets.push('Title = @title');
      inputs.push({ name: 'title', type: sql.NVarChar(200), value: dto.title });
    }
    if (dto.description !== undefined) {
      sets.push('Description = @desc');
      inputs.push({ name: 'desc', type: sql.NVarChar(sql.MAX), value: dto.description });
    }
    if (dto.sortOrder !== undefined) {
      sets.push('SortOrder = @sortOrder');
      inputs.push({ name: 'sortOrder', type: sql.Int, value: dto.sortOrder });
    }
    if (dto.referenceLinks !== undefined) {
      sets.push('ReferenceLinksJson = @links');
      inputs.push({ name: 'links', type: sql.NVarChar(sql.MAX), value: JSON.stringify(dto.referenceLinks) });
    }

    await this.db.query(`UPDATE CourseTopics SET ${sets.join(', ')} WHERE Id = @id`, inputs);
    return this.findById(id);
  }

  async remove(id: number) {
    await this.findById(id);
    await this.db.query(`DELETE FROM CourseTopics WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    return { message: 'Topic deleted' };
  }
}
