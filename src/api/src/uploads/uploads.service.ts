import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import { BlobStorageService, type StorageProvider } from './blob-storage.service';
import { SchemaService } from '../policy/schema.service';

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
  StorageProvider?: string | null;
  ContainerName?: string | null;
  DocumentType?: string | null;
}

function mapUpload(row: UploadRow) {
  return {
    id: row.Id,
    ownerUserId: row.OwnerUserId,
    role: row.Role,
    entityType: row.EntityType,
    entityId: row.EntityId,
    documentType: row.DocumentType ?? row.EntityType,
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
  constructor(
    private db: DatabaseService,
    private storage: BlobStorageService,
    private schema: SchemaService,
  ) {}

  /**
   * Private files live in the private container under one folder per user:
   *   {role}/{userId}/{entityType}/{entityId}/{uuid}-{filename}
   * Public files (logos / hero images) go in the public container.
   * The Uploads row (provider, container, blob name, document type, mime,
   * size) is the source of truth - never the storage path alone.
   */
  async save(
    file: UploadedFileLike,
    opts: { ownerUserId: string; role: string; entityType: string; entityId?: string; isPublic: boolean; documentType?: string },
  ) {
    const id = uuidv4();
    const originalFileName = safeFileName(file.originalname);
    const provider: StorageProvider = this.storage.provider;
    const hasNewColumns = await this.schema.has('Uploads', 'StorageProvider');
    if (provider === 'blob' && !hasNewColumns) {
      throw new ServiceUnavailableException('File storage migration (016) has not been applied yet');
    }

    const container = opts.isPublic ? this.storage.publicContainer : this.storage.privateContainer;
    const blobName = opts.isPublic
      ? `${id}-${originalFileName}`
      : [
          safeFileName(opts.role),
          safeFileName(opts.ownerUserId),
          safeFileName(opts.entityType),
          safeFileName(opts.entityId || '_'),
          `${id}-${originalFileName}`,
        ].join('/');

    await this.storage.put(container, blobName, file.buffer, file.mimetype);

    const documentType = safeFileName(opts.documentType || opts.entityType).slice(0, 50);
    const inputs = [
      { name: 'id', type: sql.UniqueIdentifier, value: id },
      { name: 'ownerUserId', type: sql.UniqueIdentifier, value: opts.ownerUserId },
      { name: 'role', type: sql.NVarChar(30), value: opts.role },
      { name: 'entityType', type: sql.NVarChar(50), value: opts.entityType },
      { name: 'entityId', type: sql.NVarChar(100), value: opts.entityId ?? null },
      { name: 'originalFileName', type: sql.NVarChar(300), value: originalFileName },
      { name: 'storedPath', type: sql.NVarChar(500), value: blobName },
      { name: 'mimeType', type: sql.NVarChar(100), value: file.mimetype ?? null },
      { name: 'sizeBytes', type: sql.BigInt, value: file.size ?? file.buffer.length },
      { name: 'isPublic', type: sql.Bit, value: opts.isPublic ? 1 : 0 },
    ];
    if (hasNewColumns) {
      await this.db.query(
        `INSERT INTO Uploads (Id, OwnerUserId, Role, EntityType, EntityId, OriginalFileName, StoredPath, MimeType, SizeBytes, IsPublic, StorageProvider, ContainerName, DocumentType)
         VALUES (@id, @ownerUserId, @role, @entityType, @entityId, @originalFileName, @storedPath, @mimeType, @sizeBytes, @isPublic, @provider, @container, @documentType)`,
        [
          ...inputs,
          { name: 'provider', type: sql.NVarChar(10), value: provider },
          { name: 'container', type: sql.NVarChar(100), value: container },
          { name: 'documentType', type: sql.NVarChar(50), value: documentType },
        ],
      );
    } else {
      await this.db.query(
        `INSERT INTO Uploads (Id, OwnerUserId, Role, EntityType, EntityId, OriginalFileName, StoredPath, MimeType, SizeBytes, IsPublic)
         VALUES (@id, @ownerUserId, @role, @entityType, @entityId, @originalFileName, @storedPath, @mimeType, @sizeBytes, @isPublic)`,
        inputs,
      );
    }

    return { id, url: opts.isPublic ? `/uploads/public/${id}` : `/uploads/${id}`, documentType };
  }

  private async findById(id: string) {
    const extra = (await this.schema.has('Uploads', 'StorageProvider'))
      ? ', StorageProvider, ContainerName, DocumentType'
      : '';
    const res = await this.db.query<UploadRow>(
      `SELECT Id, OwnerUserId, Role, EntityType, EntityId, OriginalFileName, StoredPath, MimeType, SizeBytes, IsPublic, CreatedAt${extra}
       FROM Uploads WHERE Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
    );
    if (!res.recordset[0]) throw new NotFoundException('Upload not found');
    return res.recordset[0];
  }

  private resolve(row: UploadRow) {
    return {
      meta: mapUpload(row),
      provider: (row.StorageProvider === 'blob' ? 'blob' : 'local') as StorageProvider,
      container: row.ContainerName || (row.IsPublic ? this.storage.publicContainer : this.storage.privateContainer),
      blobName: row.StoredPath,
      mimeType: row.MimeType,
      fileName: row.OriginalFileName,
    };
  }

  /** Authenticated fetch - owner or admin/super_admin/faculty only. */
  async getForAuthenticatedUser(id: string, requester: { id: string; role: string }) {
    const row = await this.findById(id);
    const isOwner = String(row.OwnerUserId) === String(requester.id);
    const isStaff = STAFF_ROLES.includes(requester.role);
    if (!isOwner && !isStaff) throw new ForbiddenException('You do not have access to this file');
    return this.resolve(row);
  }

  /** Unauthenticated fetch - only ever returns rows flagged IsPublic. */
  async getPublic(id: string) {
    const row = await this.findById(id);
    if (!row.IsPublic) throw new NotFoundException('Upload not found');
    return this.resolve(row);
  }

  openStream(r: { provider: StorageProvider; container: string; blobName: string }) {
    return this.storage.get(r.provider, r.container, r.blobName);
  }

  /** A user's own documents (or any user's, for staff) - newest first. */
  async listForUser(userId: string, requester: { id: string; role: string }, entityType?: string) {
    if (String(userId) !== String(requester.id) && !STAFF_ROLES.includes(requester.role)) {
      throw new ForbiddenException('You do not have access to these files');
    }
    const extra = (await this.schema.has('Uploads', 'StorageProvider')) ? ', DocumentType' : '';
    const res = await this.db.query<UploadRow>(
      `SELECT Id, OwnerUserId, Role, EntityType, EntityId, OriginalFileName, StoredPath, MimeType, SizeBytes, IsPublic, CreatedAt${extra}
       FROM Uploads WHERE OwnerUserId = @userId AND IsPublic = 0 ${entityType ? 'AND EntityType = @entityType' : ''}
       ORDER BY CreatedAt DESC`,
      [
        { name: 'userId', type: sql.UniqueIdentifier, value: userId },
        ...(entityType ? [{ name: 'entityType', type: sql.NVarChar(50), value: entityType }] : []),
      ],
    );
    return res.recordset.map(mapUpload);
  }
}
