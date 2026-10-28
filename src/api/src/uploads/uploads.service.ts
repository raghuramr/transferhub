import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as sql from 'mssql';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import { BlobStorageService, type StorageProvider } from './blob-storage.service';
import { SchemaService } from '../policy/schema.service';
import { ScopeService } from '../policy/scope.service';

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
  /** Migration 022: set when the file was uploaded for a transfer request (it then lives in the student's folder). */
  StudentUserId?: string | null;
  TranscriptId?: string | null;
  UploadedByParty?: string | null;
  UploadedByInstitutionId?: number | null;
  Note?: string | null;
  DocumentRequestId?: number | null;
}

/** Context of an upload made for a transfer request, by the student or by either university. */
export interface TransferUploadContext {
  studentUserId: string;
  transcriptId: string;
  party: 'student' | 'source_university' | 'target_university';
  institutionId: number | null;
  note?: string | null;
  documentRequestId?: number | null;
}

/** The storage folder of a transfer upload: inside the STUDENT's own folder, never the uploader's. */
export function transferBlobName(studentUserId: string, transcriptId: string, party: string, id: string, originalFileName: string): string {
  return ['student', safeFileName(studentUserId), 'transfer', safeFileName(transcriptId), safeFileName(party), `${id}-${safeFileName(originalFileName)}`].join('/');
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
    private scope: ScopeService,
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
    opts: { ownerUserId: string; role: string; entityType: string; entityId?: string; isPublic: boolean; documentType?: string; transfer?: TransferUploadContext },
  ) {
    const tr = opts.transfer;
    const hasTransferColumns = tr ? await this.schema.has('Uploads', 'TranscriptId') : false;
    if (tr && !hasTransferColumns) throw new ServiceUnavailableException('Transfer exchange migration (022) has not been applied yet');
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
      : tr
      ? transferBlobName(tr.studentUserId, tr.transcriptId, tr.party, id, originalFileName)
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
    if (hasNewColumns && tr) {
      await this.db.query(
        `INSERT INTO Uploads (Id, OwnerUserId, Role, EntityType, EntityId, OriginalFileName, StoredPath, MimeType, SizeBytes, IsPublic, StorageProvider, ContainerName, DocumentType,
                              StudentUserId, TranscriptId, UploadedByParty, UploadedByInstitutionId, Note, DocumentRequestId)
         VALUES (@id, @ownerUserId, @role, @entityType, @entityId, @originalFileName, @storedPath, @mimeType, @sizeBytes, @isPublic, @provider, @container, @documentType,
                 @studentUserId, @transcriptId, @party, @institutionId, @note, @documentRequestId)`,
        [
          ...inputs,
          { name: 'provider', type: sql.NVarChar(10), value: provider },
          { name: 'container', type: sql.NVarChar(100), value: container },
          { name: 'documentType', type: sql.NVarChar(50), value: documentType },
          { name: 'studentUserId', type: sql.UniqueIdentifier, value: tr.studentUserId },
          { name: 'transcriptId', type: sql.UniqueIdentifier, value: tr.transcriptId },
          { name: 'party', type: sql.VarChar(20), value: tr.party },
          { name: 'institutionId', type: sql.Int, value: tr.institutionId },
          { name: 'note', type: sql.NVarChar(500), value: tr.note?.slice(0, 500) ?? null },
          { name: 'documentRequestId', type: sql.Int, value: tr.documentRequestId ?? null },
        ],
      );
    } else if (hasNewColumns) {
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

    // Public files are loaded straight from Azure Storage when its public container allows it; otherwise via the API route.
    const direct = opts.isPublic && provider === 'blob' ? await this.storage.publicUrl(blobName).catch(() => null) : null;
    return { id, url: direct ?? (opts.isPublic ? `/uploads/public/${id}` : `/uploads/${id}`), documentType };
  }

  private async findById(id: string) {
    let extra = (await this.schema.has('Uploads', 'StorageProvider'))
      ? ', StorageProvider, ContainerName, DocumentType'
      : '';
    if (await this.schema.has('Uploads', 'TranscriptId')) extra += ', StudentUserId, TranscriptId, UploadedByParty, UploadedByInstitutionId, Note, DocumentRequestId';
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

  /**
   * Authenticated fetch - owner or admin/super_admin/faculty (legacy rows). Files uploaded for a
   * transfer request additionally open to the student whose folder they are in, and a scoped admin
   * must belong to one of the two universities on that transfer.
   */
  async getForAuthenticatedUser(id: string, requester: { id: string; role: string }) {
    const row = await this.findById(id);
    const same = (a?: string | null) => !!a && String(a).toLowerCase() === String(requester.id).toLowerCase();
    const isOwner = same(row.OwnerUserId);
    const isStaff = STAFF_ROLES.includes(requester.role);
    if (row.TranscriptId) {
      let ok = isOwner || same(row.StudentUserId) || requester.role === 'super_admin' || requester.role === 'faculty';
      if (!ok && requester.role === 'admin') ok = await this.scope.canViewTranscript(requester, row.TranscriptId);
      if (!ok && requester.role === 'agency') {
        const r = await this.db.query<{ N: number }>(
          `SELECT COUNT(*) AS N FROM Transcripts WHERE Id = @t AND SubmittedById = @u`,
          [{ name: 't', type: sql.UniqueIdentifier, value: row.TranscriptId }, { name: 'u', type: sql.UniqueIdentifier, value: requester.id }],
        );
        ok = r.recordset[0].N > 0;
      }
      if (!ok) throw new ForbiddenException('You do not have access to this file');
      return this.resolve(row);
    }
    if (!isOwner && !isStaff) throw new ForbiddenException('You do not have access to this file');
    return this.resolve(row);
  }

  /** Unauthenticated fetch - only ever returns rows flagged IsPublic. */
  async getPublic(id: string) {
    const row = await this.findById(id);
    if (!row.IsPublic) throw new NotFoundException('Upload not found');
    return this.resolve(row);
  }

  /** Looks a stored file up by its blob name / path (used where only the stored path was kept). */
  async getByStoredPath(storedPath: string) {
    const extra = (await this.schema.has('Uploads', 'StorageProvider'))
      ? ', StorageProvider, ContainerName, DocumentType'
      : '';
    const res = await this.db.query<UploadRow>(
      `SELECT TOP 1 Id, OwnerUserId, Role, EntityType, EntityId, OriginalFileName, StoredPath, MimeType, SizeBytes, IsPublic, CreatedAt${extra}
       FROM Uploads WHERE StoredPath = @p ORDER BY CreatedAt DESC`,
      [{ name: 'p', type: sql.NVarChar(500), value: storedPath }],
    );
    if (!res.recordset[0]) throw new NotFoundException('File not found');
    return this.resolve(res.recordset[0]);
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

  /**
   * Deletes a private upload (row + stored file) for its owner, but ONLY when nothing else points at it.
   * "Something else" = any foreign key into Uploads other than `ignoreTables` (found from the catalog, so new
   * features that reference uploads are protected automatically), or the upload being tied to a transfer request.
   * Returns false (and deletes nothing) when it is still in use.
   */
  async deleteIfUnreferenced(id: string, ownerUserId: string, ignoreTables: string[] = []): Promise<boolean> {
    const row = await this.findById(id);
    if (String(row.OwnerUserId).toLowerCase() !== String(ownerUserId).toLowerCase()) throw new ForbiddenException('You do not have access to this file');
    if (row.IsPublic) return false;
    if ((row as { TranscriptId?: string | null }).TranscriptId) return false;
    const fks = await this.db.query<{ T: string; C: string }>(
      `SELECT OBJECT_NAME(fkc.parent_object_id) AS T, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS C
         FROM sys.foreign_key_columns fkc WHERE fkc.referenced_object_id = OBJECT_ID('Uploads')`,
    );
    for (const fk of fks.recordset) {
      if (ignoreTables.includes(fk.T)) continue;
      const r = await this.db.query<{ N: number }>(
        `SELECT COUNT(*) AS N FROM [${fk.T.replace(/]/g, ']]')}] WHERE [${fk.C.replace(/]/g, ']]')}] = @id`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: id }],
      );
      if (r.recordset[0].N > 0) return false;
    }
    const meta = this.resolve(row);
    await this.db.query(`DELETE FROM Uploads WHERE Id = @id`, [{ name: 'id', type: sql.UniqueIdentifier, value: id }]);
    try {
      await this.storage.remove(meta.provider, meta.container, meta.blobName);
    } catch {
      /* the row is gone; an orphaned blob is harmless */
    }
    return true;
  }
}
