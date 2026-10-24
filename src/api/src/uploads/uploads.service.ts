import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { UploadedFileLike } from '../common/uploaded-file.interface';

// Keep private student/agency documents OUT of any web-servable public
// root — they're served only through the authenticated GET /uploads/:id
// endpoint below. Public uploads (university logos/hero images) go in a
// separate folder and are served unauthenticated via GET /uploads/public/:id.
// See CLAUDE.md "Uploads subsystem" for the full writeup.
const STORAGE_ROOT = path.join(process.cwd(), 'storage');
const PRIVATE_ROOT = path.join(STORAGE_ROOT, 'uploads');
const PUBLIC_ROOT = path.join(STORAGE_ROOT, 'public-uploads');

const STAFF_ROLES = ['admin', 'super_admin', 'faculty'];

interface UploadRow {
  Id: string;
  OwnerUserId: string;
  Role: string;
  EntityType: string;
  EntityId: string | null;
  OriginalFileName: string;
  StoredPath: string;
  MimeType: string | null;
  SizeBytes: number;
  IsPublic: boolean;
  CreatedAt: Date;
}

function mapUpload(row: UploadRow) {
  return {
    id: row.Id,
    ownerUserId: row.OwnerUserId,
    role: row.Role,
    entityType: row.EntityType,
    entityId: row.EntityId,
    originalFileName: row.OriginalFileName,
    mimeType: row.MimeType,
    sizeBytes: row.SizeBytes,
    isPublic: !!row.IsPublic,
    createdAt: row.CreatedAt,
  };
}

/** Strips path separators etc. so a crafted filename can't escape its folder. */
function safeFileName(name: string): string {
  const base = path.basename(name || 'file');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
}

@Injectable()
export class UploadsService {
  constructor(private db: DatabaseService) {}

  async save(
    file: UploadedFileLike,
    opts: { ownerUserId: string; role: string; entityType: string; entityId?: string; isPublic: boolean },
  ) {
    const id = uuidv4();
    const originalFileName = safeFileName(file.originalname);
    let storedPath: string;
    let url: string;

    if (opts.isPublic) {
      const fileName = `${id}-${originalFileName}`;
      storedPath = path.join(PUBLIC_ROOT, fileName);
      url = `/uploads/public/${id}`;
    } else {
      const entitySegment = safeFileName(opts.entityId || id);
      const dir = path.join(
        PRIVATE_ROOT,
        safeFileName(opts.role),
        safeFileName(opts.ownerUserId),
        safeFileName(opts.entityType),
        entitySegment,
      );
      storedPath = path.join(dir, originalFileName);
      url = `/uploads/${id}`;
    }

    fs.mkdirSync(path.dirname(storedPath), { recursive: true });
    fs.writeFileSync(storedPath, file.buffer);

    await this.db.query(
      `INSERT INTO Uploads (Id, OwnerUserId, Role, EntityType, EntityId, OriginalFileName, StoredPath, MimeType, SizeBytes, IsPublic)
       VALUES (@id, @ownerUserId, @role, @entityType, @entityId, @originalFileName, @storedPath, @mimeType, @sizeBytes, @isPublic)`,
      [
        { name: 'id', type: sql.UniqueIdentifier, value: id },
        { name: 'ownerUserId', type: sql.UniqueIdentifier, value: opts.ownerUserId },
        { name: 'role', type: sql.NVarChar(30), value: opts.role },
        { name: 'entityType', type: sql.NVarChar(50), value: opts.entityType },
        { name: 'entityId', type: sql.NVarChar(100), value: opts.entityId ?? null },
        { name: 'originalFileName', type: sql.NVarChar(300), value: originalFileName },
        { name: 'storedPath', type: sql.NVarChar(500), value: storedPath },
        { name: 'mimeType', type: sql.NVarChar(100), value: file.mimetype ?? null },
        { name: 'sizeBytes', type: sql.BigInt, value: file.size ?? file.buffer.length },
        { name: 'isPublic', type: sql.Bit, value: opts.isPublic ? 1 : 0 },
      ],
    );

    return { id, url };
  }

  private async findById(id: string) {
    const res = await this.db.query<UploadRow>(
      `SELECT Id, OwnerUserId, Role, EntityType, EntityId, OriginalFileName, StoredPath, MimeType, SizeBytes, IsPublic, CreatedAt
       FROM Uploads WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Upload not found');
    return res.recordset[0];
  }

  /** Authenticated fetch — owner or admin/super_admin/faculty only. */
  async getForAuthenticatedUser(id: string, requester: { id: string; role: string }) {
    const row = await this.findById(id);
    const isOwner = String(row.OwnerUserId) === String(requester.id);
    const isStaff = STAFF_ROLES.includes(requester.role);
    if (!isOwner && !isStaff) throw new ForbiddenException('You do not have access to this file');
    return { meta: mapUpload(row), path: row.StoredPath, mimeType: row.MimeType, fileName: row.OriginalFileName };
  }

  /** Unauthenticated fetch — only ever returns rows flagged IsPublic. */
  async getPublic(id: string) {
    const row = await this.findById(id);
    if (!row.IsPublic) throw new NotFoundException('Upload not found');
    return { meta: mapUpload(row), path: row.StoredPath, mimeType: row.MimeType, fileName: row.OriginalFileName };
  }
}
