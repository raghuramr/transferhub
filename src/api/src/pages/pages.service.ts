import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import { UpsertPageDto } from './dto/upsert-page.dto';

const VALID_BLOCK_TYPES = [
  'heading',
  'richtext',
  'notice',
  'cards',
  'cta',
  'divider',
  'image',
];

function mapRow(row: any) {
  return {
    id: row.Id,
    slug: row.Slug,
    title: row.Title,
    blocks: JSON.parse(row.Blocks),
    published: !!row.Published,
    showInNav: !!row.ShowInNav,
    navLabel: row.NavLabel,
    navOrder: row.NavOrder,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

@Injectable()
export class PagesService {
  constructor(private db: DatabaseService) {}

  /** Structural validation of the blocks JSON — kept intentionally light. */
  private validateBlocks(blocks: Record<string, any>[]) {
    if (!Array.isArray(blocks)) {
      throw new BadRequestException('blocks must be an array');
    }
    for (const block of blocks) {
      if (!block.id || typeof block.id !== 'string') {
        throw new BadRequestException('Every block needs a string "id"');
      }
      if (!VALID_BLOCK_TYPES.includes(block.type)) {
        throw new BadRequestException(
          `Unknown block type "${block.type}". Valid types: ${VALID_BLOCK_TYPES.join(', ')}`,
        );
      }
    }
  }

  async findAll() {
    const res = await this.db.query<any>(
      `SELECT Id, Slug, Title, Blocks, Published, ShowInNav, NavLabel, NavOrder, CreatedAt, UpdatedAt
       FROM Pages ORDER BY NavOrder, Title`,
    );
    return res.recordset.map(mapRow);
  }

  /** Pages shown in the authenticated nav (published + showInNav). */
  async findNavPages() {
    const res = await this.db.query<any>(
      `SELECT Id, Slug, Title, Blocks, Published, ShowInNav, NavLabel, NavOrder, CreatedAt, UpdatedAt
       FROM Pages WHERE Published = 1 AND ShowInNav = 1 ORDER BY NavOrder, Title`,
    );
    return res.recordset.map(mapRow);
  }

  async findById(id: number) {
    const res = await this.db.query<any>(
      `SELECT Id, Slug, Title, Blocks, Published, ShowInNav, NavLabel, NavOrder, CreatedAt, UpdatedAt
       FROM Pages WHERE Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Page not found');
    return mapRow(res.recordset[0]);
  }

  /** Public-facing lookup — only returns the page if it is published. */
  async findPublishedBySlug(slug: string) {
    const res = await this.db.query<any>(
      `SELECT Id, Slug, Title, Blocks, Published, ShowInNav, NavLabel, NavOrder, CreatedAt, UpdatedAt
       FROM Pages WHERE Slug = @slug AND Published = 1`,
      [{ name: 'slug', type: sql.VarChar(150), value: slug }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Page not found');
    return mapRow(res.recordset[0]);
  }

  async create(dto: UpsertPageDto, userId: string) {
    this.validateBlocks(dto.blocks);

    const existing = await this.db.query<any>(
      `SELECT Id FROM Pages WHERE Slug = @slug`,
      [{ name: 'slug', type: sql.VarChar(150), value: dto.slug }],
    );
    if (existing.recordset[0]) throw new ConflictException('A page with this slug already exists');

    const res = await this.db.query<any>(
      `INSERT INTO Pages (Slug, Title, Blocks, Published, ShowInNav, NavLabel, NavOrder, CreatedBy, UpdatedBy)
       OUTPUT inserted.Id
       VALUES (@slug, @title, @blocks, @published, @showInNav, @navLabel, @navOrder, @userId, @userId)`,
      [
        { name: 'slug', type: sql.VarChar(150), value: dto.slug },
        { name: 'title', type: sql.NVarChar(200), value: dto.title },
        { name: 'blocks', type: sql.NVarChar(sql.MAX), value: JSON.stringify(dto.blocks ?? []) },
        { name: 'published', type: sql.Bit, value: dto.published ? 1 : 0 },
        { name: 'showInNav', type: sql.Bit, value: dto.showInNav ? 1 : 0 },
        { name: 'navLabel', type: sql.NVarChar(100), value: dto.navLabel ?? null },
        { name: 'navOrder', type: sql.Int, value: dto.navOrder ?? 0 },
        { name: 'userId', type: sql.UniqueIdentifier, value: userId },
      ],
    );
    return this.findById(res.recordset[0].Id);
  }

  async update(id: number, dto: UpsertPageDto, userId: string) {
    await this.findById(id); // 404s if missing
    this.validateBlocks(dto.blocks);

    const dupe = await this.db.query<any>(
      `SELECT Id FROM Pages WHERE Slug = @slug AND Id <> @id`,
      [
        { name: 'slug', type: sql.VarChar(150), value: dto.slug },
        { name: 'id', type: sql.Int, value: id },
      ],
    );
    if (dupe.recordset[0]) throw new ConflictException('Another page already uses this slug');

    await this.db.query(
      `UPDATE Pages SET
          Slug = @slug, Title = @title, Blocks = @blocks,
          Published = @published, ShowInNav = @showInNav,
          NavLabel = @navLabel, NavOrder = @navOrder,
          UpdatedBy = @userId, UpdatedAt = SYSUTCDATETIME()
       WHERE Id = @id`,
      [
        { name: 'slug', type: sql.VarChar(150), value: dto.slug },
        { name: 'title', type: sql.NVarChar(200), value: dto.title },
        { name: 'blocks', type: sql.NVarChar(sql.MAX), value: JSON.stringify(dto.blocks ?? []) },
        { name: 'published', type: sql.Bit, value: dto.published ? 1 : 0 },
        { name: 'showInNav', type: sql.Bit, value: dto.showInNav ? 1 : 0 },
        { name: 'navLabel', type: sql.NVarChar(100), value: dto.navLabel ?? null },
        { name: 'navOrder', type: sql.Int, value: dto.navOrder ?? 0 },
        { name: 'userId', type: sql.UniqueIdentifier, value: userId },
        { name: 'id', type: sql.Int, value: id },
      ],
    );
    return this.findById(id);
  }

  async remove(id: number) {
    await this.findById(id);
    await this.db.query(`DELETE FROM Pages WHERE Id = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    return { message: 'Page deleted' };
  }
}
