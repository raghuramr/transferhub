import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import { UpsertFormDto, SubmitFormDto, DecideSubmissionDto } from './dto/upsert-form.dto';

const VALID_FIELD_TYPES = [
  'text', 'textarea', 'email', 'phone', 'number', 'date',
  'select', 'radio', 'checkboxes', 'yesno',
];

function mapForm(row: any) {
  return {
    id: row.Id,
    slug: row.Slug,
    title: row.Title,
    description: row.Description,
    status: row.Status,
    schema: JSON.parse(row.Schema),
    successMessage: row.SuccessMessage,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

function mapSubmission(row: any) {
  return {
    id: row.Id,
    formId: row.FormId,
    formTitle: row.FormTitle,
    submittedByName: row.SubmittedByName,
    submittedByEmail: row.SubmittedByEmail,
    data: JSON.parse(row.Data),
    status: row.Status,
    adminNotes: row.AdminNotes,
    submittedAt: row.SubmittedAt,
    decidedAt: row.DecidedAt,
  };
}

@Injectable()
export class FormsService {
  constructor(private db: DatabaseService) {}

  private validateSchema(schema: { fields: Record<string, any>[] }) {
    if (!schema || !Array.isArray(schema.fields)) {
      throw new BadRequestException('schema.fields must be an array');
    }
    const keys = new Set<string>();
    for (const field of schema.fields) {
      if (!field.key || typeof field.key !== 'string') {
        throw new BadRequestException('Every field needs a string "key"');
      }
      if (keys.has(field.key)) {
        throw new BadRequestException(`Duplicate field key "${field.key}"`);
      }
      keys.add(field.key);
      if (!VALID_FIELD_TYPES.includes(field.type)) {
        throw new BadRequestException(
          `Unknown field type "${field.type}". Valid types: ${VALID_FIELD_TYPES.join(', ')}`,
        );
      }
      if (['select', 'radio', 'checkboxes'].includes(field.type) && !Array.isArray(field.options)) {
        throw new BadRequestException(`Field "${field.key}" of type ${field.type} needs an "options" array`);
      }
    }
  }

  async findAll(includeNonOpen: boolean) {
    const where = includeNonOpen ? '1=1' : `Status = 'open'`;
    const res = await this.db.query<any>(
      `SELECT Id, Slug, Title, Description, Status, Schema, SuccessMessage, CreatedAt, UpdatedAt
       FROM Forms WHERE ${where} ORDER BY Title`,
    );
    return res.recordset.map(mapForm);
  }

  async findById(id: number) {
    const res = await this.db.query<any>(
      `SELECT Id, Slug, Title, Description, Status, Schema, SuccessMessage, CreatedAt, UpdatedAt
       FROM Forms WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Form not found');
    return mapForm(res.recordset[0]);
  }

  /** Public-facing lookup — only returns the form if it's currently open for submissions. */
  async findOpenBySlug(slug: string) {
    const res = await this.db.query<any>(
      `SELECT Id, Slug, Title, Description, Status, Schema, SuccessMessage, CreatedAt, UpdatedAt
       FROM Forms WHERE Slug = @slug AND Status = 'open'`,
      [{ name: 'slug', type: sql.VarChar(150), value: slug }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Form not found or not currently open');
    return mapForm(res.recordset[0]);
  }

  async create(dto: UpsertFormDto, userId: string) {
    this.validateSchema(dto.schema);

    const existing = await this.db.query<any>(`SELECT Id FROM Forms WHERE Slug = @slug`, [
      { name: 'slug', type: sql.VarChar(150), value: dto.slug },
    ]);
    if (existing.recordset[0]) throw new ConflictException('A form with this slug already exists');

    const res = await this.db.query<any>(
      `INSERT INTO Forms (Slug, Title, Description, Status, Schema, SuccessMessage, CreatedBy)
       OUTPUT inserted.Id
       VALUES (@slug, @title, @desc, @status, @schema, @success, @userId)`,
      [
        { name: 'slug', type: sql.VarChar(150), value: dto.slug },
        { name: 'title', type: sql.NVarChar(200), value: dto.title },
        { name: 'desc', type: sql.NVarChar(sql.MAX), value: dto.description ?? null },
        { name: 'status', type: sql.VarChar(20), value: dto.status ?? 'draft' },
        { name: 'schema', type: sql.NVarChar(sql.MAX), value: JSON.stringify(dto.schema) },
        { name: 'success', type: sql.NVarChar(sql.MAX), value: dto.successMessage ?? null },
        { name: 'userId', type: sql.UniqueIdentifier, value: userId },
      ],
    );
    return this.findById(res.recordset[0].Id);
  }

  async update(id: number, dto: UpsertFormDto) {
    await this.findById(id);
    this.validateSchema(dto.schema);

    const dupe = await this.db.query<any>(`SELECT Id FROM Forms WHERE Slug = @slug AND Id <> @id`, [
      { name: 'slug', type: sql.VarChar(150), value: dto.slug },
      { name: 'id', type: sql.Int, value: id },
    ]);
    if (dupe.recordset[0]) throw new ConflictException('Another form already uses this slug');

    await this.db.query(
      `UPDATE Forms SET
          Slug = @slug, Title = @title, Description = @desc, Status = @status,
          Schema = @schema, SuccessMessage = @success, UpdatedAt = SYSUTCDATETIME()
       WHERE Id = @id`,
      [
        { name: 'slug', type: sql.VarChar(150), value: dto.slug },
        { name: 'title', type: sql.NVarChar(200), value: dto.title },
        { name: 'desc', type: sql.NVarChar(sql.MAX), value: dto.description ?? null },
        { name: 'status', type: sql.VarChar(20), value: dto.status ?? 'draft' },
        { name: 'schema', type: sql.NVarChar(sql.MAX), value: JSON.stringify(dto.schema) },
        { name: 'success', type: sql.NVarChar(sql.MAX), value: dto.successMessage ?? null },
        { name: 'id', type: sql.Int, value: id },
      ],
    );
    return this.findById(id);
  }

  async remove(id: number) {
    await this.findById(id);
    await this.db.query(`DELETE FROM FormSubmissions WHERE FormId = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    await this.db.query(`DELETE FROM Forms WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    return { message: 'Form deleted' };
  }

  async submit(formId: number, dto: SubmitFormDto, submittedByUserId: string) {
    const form = await this.findById(formId);
    if (form.status !== 'open') throw new BadRequestException('This form is not currently open for submissions');

    const requiredKeys = (form.schema.fields as any[]).filter((f) => f.required).map((f) => f.key);
    for (const key of requiredKeys) {
      const value = dto.data[key];
      if (value === undefined || value === null || value === '') {
        throw new BadRequestException(`Field "${key}" is required`);
      }
    }

    const res = await this.db.query<any>(
      `INSERT INTO FormSubmissions (FormId, SubmittedByUserId, Data)
       OUTPUT inserted.Id
       VALUES (@formId, @userId, @data)`,
      [
        { name: 'formId', type: sql.Int, value: formId },
        { name: 'userId', type: sql.UniqueIdentifier, value: submittedByUserId },
        { name: 'data', type: sql.NVarChar(sql.MAX), value: JSON.stringify(dto.data) },
      ],
    );

    return { id: res.recordset[0].Id, successMessage: form.successMessage };
  }

  async listSubmissions(formId: number) {
    const res = await this.db.query<any>(
      `SELECT fs.Id, fs.FormId, f.Title AS FormTitle,
              u.FirstName + ' ' + u.LastName AS SubmittedByName, u.Email AS SubmittedByEmail,
              fs.Data, fs.Status, fs.AdminNotes, fs.SubmittedAt, fs.DecidedAt
       FROM FormSubmissions fs
       JOIN Forms f ON f.Id = fs.FormId
       LEFT JOIN Users u ON u.Id = fs.SubmittedByUserId
       WHERE fs.FormId = @formId
       ORDER BY fs.SubmittedAt DESC`,
      [{ name: 'formId', type: sql.Int, value: formId }],
    );
    return res.recordset.map(mapSubmission);
  }

  async decideSubmission(submissionId: string, dto: DecideSubmissionDto, decidedBy: string) {
    const existing = await this.db.query<any>(`SELECT Id FROM FormSubmissions WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: submissionId },
    ]);
    if (!existing.recordset[0]) throw new NotFoundException('Submission not found');

    await this.db.query(
      `UPDATE FormSubmissions
       SET Status = @status, AdminNotes = @notes, DecidedBy = @by, DecidedAt = SYSUTCDATETIME()
       WHERE Id = @id`,
      [
        { name: 'status', type: sql.VarChar(20), value: dto.status },
        { name: 'notes', type: sql.NVarChar(sql.MAX), value: dto.adminNotes ?? null },
        { name: 'by', type: sql.UniqueIdentifier, value: decidedBy },
        { name: 'id', type: sql.UniqueIdentifier, value: submissionId },
      ],
    );
    return { message: 'Submission updated' };
  }
}
