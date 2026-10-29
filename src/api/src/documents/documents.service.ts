import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { UploadsService } from '../uploads/uploads.service';
import { SchemaService } from '../policy/schema.service';
import { isScopedStaffRole, ScopeService } from '../policy/scope.service';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import { AnthropicDocumentReader, DocumentReader, PAUSED_REASON, PausedDocumentReader } from './document-reader';
import { RulesDocumentReader, RULES_REASON } from './rules-document-reader';
import { AzureDocumentIntelligenceReader } from './azure-document-reader';
import { RequestsService } from '../requests/requests.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { DOC_TYPES, DOC_TYPE_KEYS, ExtractedData, needsReview, normalizeExtraction, sameInstitution, toPrefill } from './document-types';

interface Viewer {
  id: string;
  role: string;
}

interface IntakeRow {
  Id: string;
  UserId: string;
  UploadId: string;
  OriginalFileName: string;
  MimeType: string | null;
  Status: string;
  DocType: string | null;
  Confidence: number | null;
  Summary: string | null;
  ExtractedJson: string | null;
  Model: string | null;
  Error: string | null;
  CreatedAt: Date;
  ReadAt: Date | null;
  ConfirmedAt: Date | null;
}

const STAFF_ROLES = ['admin', 'super_admin', 'faculty'];
const COLUMNS = `Id, UserId, UploadId, OriginalFileName, MimeType, Status, DocType, Confidence, Summary, ExtractedJson, Model, Error, CreatedAt, ReadAt, ConfirmedAt`;
const MAX_PER_UPLOAD = 5;

function parseJson(text: string | null): ExtractedData | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as ExtractedData;
  } catch {
    return null;
  }
}

function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 500);
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private db: DatabaseService,
    private uploads: UploadsService,
    private schema: SchemaService,
    private scope: ScopeService,
    private anthropic: AnthropicDocumentReader,
    private paused: PausedDocumentReader,
    private rules: RulesDocumentReader,
    private aiSettings: AiSettingsService,
    private azureDoc: AzureDocumentIntelligenceReader,
    private requests: RequestsService,
  ) {}

  /** True for any reader that uses a real model/OCR service (vs the built-in rules or paused readers). */
  private isAiReader(r: DocumentReader): boolean {
    return r === this.anthropic || r === this.azureDoc;
  }

  /**
   * Azure Document Intelligence when it is the selected document provider and configured; else Anthropic
   * when a key exists, AI is on and budget remains; else the built-in rules reader when the
   * `rulesFallbackEnabled` setting allows (missing = on); else the paused reader.
   */
  private async pickReader(): Promise<{ reader: DocumentReader; available: boolean; fallback: boolean; reason?: string }> {
    const di = await this.azureDoc.isAvailable();
    if (di.available) return { reader: this.azureDoc, available: true, fallback: false };
    const a = await this.anthropic.isAvailable();
    if (a.available) return { reader: this.anthropic, available: true, fallback: false };
    let rulesOn = true;
    try {
      const s = (await this.aiSettings.getEffective(null)) as { rulesFallbackEnabled?: boolean };
      rulesOn = s.rulesFallbackEnabled !== false;
    } catch (err) {
      this.logger.warn(`Could not read AI settings, assuming the rules fallback is on: ${shortError(err)}`);
    }
    if (rulesOn) {
      const why = (a.reason ?? PAUSED_REASON).replace(PAUSED_REASON, '').replace(/^\s*\(|\)\s*$/g, '').trim();
      return { reader: this.rules, available: true, fallback: true, reason: why ? `${RULES_REASON} (${why})` : RULES_REASON };
    }
    return { reader: this.paused, available: false, fallback: false, reason: a.reason ?? PAUSED_REASON };
  }

  async status() {
    const [pick, ready] = await Promise.all([this.pickReader(), this.ready()]);
    return {
      aiAvailable: this.isAiReader(pick.reader),
      reader: pick.reader.name,
      fallback: pick.fallback,
      reason: pick.reason ?? null,
      migrationApplied: ready,
      docTypes: DOC_TYPES,
      maxFiles: MAX_PER_UPLOAD,
    };
  }

  private async ready() {
    return this.schema.has('DocumentIntakes');
  }

  private async requireReady() {
    if (!(await this.ready())) throw new ServiceUnavailableException('AI documents need migration 020');
  }

  private map(r: IntakeRow) {
    const extracted = parseJson(r.ExtractedJson);
    return {
      id: r.Id,
      uploadId: r.UploadId,
      fileName: r.OriginalFileName,
      mimeType: r.MimeType,
      status: r.Status,
      docType: r.DocType,
      confidence: r.Confidence === null ? null : Number(r.Confidence),
      summary: r.Summary,
      extracted,
      needsReview: extracted ? needsReview(extracted) : false,
      model: r.Model,
      error: r.Error,
      createdAt: r.CreatedAt,
      readAt: r.ReadAt,
      confirmedAt: r.ConfirmedAt,
    };
  }

  private async load(id: string): Promise<IntakeRow> {
    await this.requireReady();
    const res = await this.db.query<IntakeRow>(`SELECT ${COLUMNS} FROM DocumentIntakes WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: id },
    ]);
    if (!res.recordset[0]) throw new NotFoundException('Document not found');
    return res.recordset[0];
  }

  /** Owner always; staff read-only (admins only for students inside their scope). */
  private async assertCanView(row: IntakeRow, viewer: Viewer) {
    if (String(row.UserId) === String(viewer.id)) return;
    if (!STAFF_ROLES.includes(viewer.role)) throw new ForbiddenException('You do not have access to this document');
    if (isScopedStaffRole(viewer.role) && !(await this.scope.canManageUser(viewer, row.UserId))) {
      throw new ForbiddenException('You do not have access to this document');
    }
  }

  private assertOwner(row: IntakeRow, viewer: Viewer) {
    if (String(row.UserId) !== String(viewer.id)) throw new ForbiddenException('Only the student who uploaded this can change it');
  }

  // ── upload + read ───────────────────────────────────────

  async smartUpload(files: UploadedFileLike[], viewer: Viewer) {
    await this.requireReady();
    if (!files?.length) throw new BadRequestException('No files uploaded');
    if (files.length > MAX_PER_UPLOAD) throw new BadRequestException(`Upload at most ${MAX_PER_UPLOAD} files at a time`);
    const pick = await this.pickReader();
    const out: ReturnType<DocumentsService['map']>[] = [];
    for (const file of files) {
      const saved = await this.uploads.save(file, {
        ownerUserId: viewer.id,
        role: viewer.role,
        entityType: 'smart_upload',
        documentType: 'unclassified',
        isPublic: false,
      });
      const status = pick.available ? 'uploaded' : 'skipped';
      const res = await this.db.query<IntakeRow>(
        `INSERT INTO DocumentIntakes (UserId, UploadId, OriginalFileName, MimeType, Status)
         OUTPUT INSERTED.Id, INSERTED.UserId, INSERTED.UploadId, INSERTED.OriginalFileName, INSERTED.MimeType, INSERTED.Status,
                INSERTED.DocType, INSERTED.Confidence, INSERTED.Summary, INSERTED.ExtractedJson, INSERTED.Model, INSERTED.Error,
                INSERTED.CreatedAt, INSERTED.ReadAt, INSERTED.ConfirmedAt
         VALUES (@u, @up, @n, @m, @s)`,
        [
          { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
          { name: 'up', type: sql.UniqueIdentifier, value: saved.id },
          { name: 'n', type: sql.NVarChar(300), value: (file.originalname || 'file').slice(0, 300) },
          { name: 'm', type: sql.NVarChar(100), value: file.mimetype ?? null },
          { name: 's', type: sql.VarChar(14), value: status },
        ],
      );
      const row = res.recordset[0];
      out.push(this.map(row));
      if (pick.available) {
        setImmediate(() => {
          this.process(row.Id).catch((err) => this.logger.error(`Reading ${row.Id} crashed: ${shortError(err)}`));
        });
      }
    }
    return { aiAvailable: this.isAiReader(pick.reader), reader: pick.reader.name, fallback: pick.fallback, reason: pick.reason ?? null, intakes: out };
  }

  private async readBytes(uploadId: string, userId: string): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    const r = await this.uploads.getForAuthenticatedUser(uploadId, { id: userId, role: 'student' });
    const stream = await this.uploads.openStream(r);
    if (!stream) throw new Error('The stored file could not be found');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return { bytes: Buffer.concat(chunks), mimeType: r.mimeType ?? 'application/octet-stream', fileName: r.fileName };
  }

  /** Reads one intake with the chosen reader (AI or built-in rules). Never throws - failures are stored on the row. */
  async process(id: string) {
    const res = await this.db.query<IntakeRow>(`SELECT ${COLUMNS} FROM DocumentIntakes WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: id },
    ]);
    const row = res.recordset[0];
    if (!row || row.Status === 'confirmed') return;
    const pick = await this.pickReader();
    if (!pick.available) {
      await this.setStatus(id, 'skipped', null, pick.reason ?? PAUSED_REASON);
      return;
    }
    await this.setStatus(id, 'reading');
    try {
      const file = await this.readBytes(row.UploadId, row.UserId);
      const result = await pick.reader.read({ fileName: file.fileName, mimeType: file.mimeType, bytes: file.bytes, userId: row.UserId });
      const e = result.extracted;
      await this.db.query(
        `UPDATE DocumentIntakes SET Status = @s, DocType = @t, Confidence = @c, Summary = @sum, ExtractedJson = @j, Model = @m,
                InputTokens = @i, OutputTokens = @o, Error = NULL, ReadAt = SYSUTCDATETIME() WHERE Id = @id`,
        [
          { name: 'id', type: sql.UniqueIdentifier, value: id },
          { name: 's', type: sql.VarChar(14), value: needsReview(e) ? 'needs_review' : 'read' },
          { name: 't', type: sql.VarChar(40), value: e.docType },
          { name: 'c', type: sql.Decimal(4, 3), value: e.confidence },
          { name: 'sum', type: sql.NVarChar(500), value: e.summary },
          { name: 'j', type: sql.NVarChar(sql.MAX), value: JSON.stringify(result.layout ? { ...e, layout: result.layout } : e) },
          { name: 'm', type: sql.NVarChar(100), value: result.model },
          { name: 'i', type: sql.Int, value: result.inputTokens },
          { name: 'o', type: sql.Int, value: result.outputTokens },
        ],
      );
    } catch (err) {
      this.logger.warn(`Reading ${id} failed: ${shortError(err)}`);
      if (pick.reader === this.rules) {
        // The built-in reader is a convenience: when it breaks, degrade to the manual (skipped) path, not a failed upload.
        await this.setStatus(id, 'skipped', null, `${PAUSED_REASON} (the built-in reader could not read this file)`);
      } else {
        await this.setStatus(id, 'failed', null, shortError(err));
      }
    }
  }

  private async setStatus(id: string, status: string, _unused: null = null, error: string | null = null) {
    await this.db.query(`UPDATE DocumentIntakes SET Status = @s, Error = @e WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: id },
      { name: 's', type: sql.VarChar(14), value: status },
      { name: 'e', type: sql.NVarChar(500), value: error ? error.slice(0, 500) : null },
    ]);
  }

  // ── reads ───────────────────────────────────────────────

  async list(viewer: Viewer, userId?: string) {
    await this.requireReady();
    const target = userId && userId !== viewer.id ? userId : viewer.id;
    if (target !== viewer.id) {
      if (!STAFF_ROLES.includes(viewer.role)) throw new ForbiddenException('You do not have access to these documents');
      if (isScopedStaffRole(viewer.role) && !(await this.scope.canManageUser(viewer, target))) {
        throw new ForbiddenException('You do not have access to these documents');
      }
    }
    const res = await this.db.query<IntakeRow>(
      `SELECT TOP 200 ${COLUMNS} FROM DocumentIntakes WHERE UserId = @u ORDER BY CreatedAt DESC`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: target }],
    );
    return res.recordset.map((r) => {
      const m = this.map(r);
      // Word positions can be large; only the single-document view needs them.
      if (m.extracted && m.extracted.layout) m.extracted = { ...m.extracted, layout: undefined };
      return m;
    });
  }

  async get(id: string, viewer: Viewer) {
    const row = await this.load(id);
    await this.assertCanView(row, viewer);
    return { ...this.map(row), profileCheck: await this.profileCheck(row) };
  }

  /**
   * Does what the document says line up with what the student told us? Today this compares the
   * college on a transcript with the one on their profile / education history, because a student
   * who registered as "New York University" and then uploads a Miami Dade transcript needs to be
   * told, not silently believed. Returns null when there is nothing to compare or they agree.
   */
  private async profileCheck(row: IntakeRow): Promise<{ field: string; documentValue: string; profileValue: string; message: string } | null> {
    const e = parseJson(row.ExtractedJson);
    if (!e || e.docType !== 'transcript') return null;
    const inst = (e.fields.institution ?? {}) as Record<string, unknown>;
    const docName = typeof inst.name === 'string' ? inst.name.trim() : '';
    if (!docName || /^unknown institution$/i.test(docName)) return null;

    const known: string[] = [];
    try {
      const p = await this.db.query<{ Name: string | null }>(
        `SELECT PriorInstitutionName AS Name FROM StudentProfiles WHERE UserId = @u`,
        [{ name: 'u', type: sql.UniqueIdentifier, value: row.UserId }],
      );
      if (p.recordset[0]?.Name) known.push(p.recordset[0].Name);
    } catch { /* profile column missing */ }
    try {
      const t = await this.db.query<{ Name: string }>(
        `SELECT DISTINCT i.Name FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId WHERE t.StudentUserId = @u`,
        [{ name: 'u', type: sql.UniqueIdentifier, value: row.UserId }],
      );
      for (const r of t.recordset) known.push(r.Name);
    } catch { /* ignore */ }
    if (await this.schema.has('StudentEducation')) {
      try {
        const ed = await this.db.query<{ InstitutionName: string }>(
          `SELECT InstitutionName FROM StudentEducation WHERE UserId = @u`,
          [{ name: 'u', type: sql.UniqueIdentifier, value: row.UserId }],
        );
        for (const r of ed.recordset) known.push(r.InstitutionName);
      } catch { /* ignore */ }
    }
    const names = known.map((n) => n.trim()).filter(Boolean);
    if (!names.length) return null;
    if (names.some((n) => sameInstitution(n, docName))) return null;
    return {
      field: 'institution',
      documentValue: docName,
      profileValue: names[0],
      message: `This document is from ${docName}, but your profile says ${names[0]}. Correct whichever is wrong before you confirm — the college on the document is what we will use.`,
    };
  }

  // ── student edits ───────────────────────────────────────

  async patch(id: string, viewer: Viewer, dto: { docType?: string; extracted?: Record<string, unknown> }) {
    const row = await this.load(id);
    this.assertOwner(row, viewer);
    if (row.Status === 'reading') throw new ConflictException('This document is still being read');
    const wasConfirmed = row.Status === 'confirmed';
    if (dto.docType !== undefined && !DOC_TYPE_KEYS.includes(dto.docType)) {
      throw new BadRequestException(`docType must be one of: ${DOC_TYPE_KEYS.join(', ')}`);
    }
    if (dto.docType === undefined && dto.extracted === undefined) throw new BadRequestException('Nothing to update');

    const current = parseJson(row.ExtractedJson);
    const docType = dto.docType ?? current?.docType ?? row.DocType ?? 'other';
    const retyped = !!current && current.docType !== docType;
    const base = dto.extracted ?? (retyped || !current ? {} : current.fields);
    const merged = normalizeExtraction(
      {
        docType,
        confidence: 1,
        summary: dto.extracted || retyped ? '' : current?.summary ?? '',
        fields: dto.extracted && typeof dto.extracted === 'object' && 'fields' in dto.extracted ? (dto.extracted as any).fields : base,
      },
      docType,
    );
    if (!merged) throw new BadRequestException('Could not understand the edited data');
    await this.db.query(
      `UPDATE DocumentIntakes SET Status = @st, DocType = @t, Confidence = @c, Summary = @sum, ExtractedJson = @j, Error = NULL WHERE Id = @id`,
      [
        { name: 'id', type: sql.UniqueIdentifier, value: id },
        { name: 'st', type: sql.VarChar(14), value: wasConfirmed ? 'confirmed' : 'read' },
        { name: 't', type: sql.VarChar(40), value: merged.docType },
        { name: 'c', type: sql.Decimal(4, 3), value: merged.confidence },
        { name: 'sum', type: sql.NVarChar(500), value: merged.summary },
        { name: 'j', type: sql.NVarChar(sql.MAX), value: JSON.stringify(current?.layout && !retyped ? { ...merged, layout: current.layout } : merged) },
      ],
    );
    if (wasConfirmed && (await this.schema.has('Uploads', 'DocumentType'))) {
      await this.db.query(`UPDATE Uploads SET DocumentType = @t WHERE Id = @id`, [
        { name: 'id', type: sql.UniqueIdentifier, value: row.UploadId },
        { name: 't', type: sql.NVarChar(50), value: merged.docType },
      ]);
    }
    return this.get(id, viewer);
  }

  async retry(id: string, viewer: Viewer) {
    const row = await this.load(id);
    this.assertOwner(row, viewer);
    if (row.Status === 'confirmed') throw new ConflictException('This document is already confirmed');
    if (row.Status === 'reading') throw new ConflictException('This document is already being read');
    const pick = await this.pickReader();
    if (!pick.available) {
      await this.setStatus(id, 'skipped', null, pick.reason ?? PAUSED_REASON);
      return this.get(id, viewer);
    }
    await this.setStatus(id, 'uploaded');
    setImmediate(() => {
      this.process(id).catch((err) => this.logger.error(`Reading ${id} crashed: ${shortError(err)}`));
    });
    return this.get(id, viewer);
  }

  /** Re-reads a document with the current reader. Allowed for any state except "being read"; clears confirmation. */
  async reprocess(id: string, viewer: Viewer) {
    const row = await this.load(id);
    this.assertOwner(row, viewer);
    if (row.Status === 'reading') throw new ConflictException('This document is already being read');
    const pick = await this.pickReader();
    if (!pick.available) {
      // Keep whatever was extracted before; just say why nothing ran.
      await this.setStatus(id, row.Status === 'confirmed' ? 'confirmed' : 'skipped', null, pick.reason ?? PAUSED_REASON);
      return this.get(id, viewer);
    }
    await this.db.query(`UPDATE DocumentIntakes SET Status = 'uploaded', Error = NULL, ConfirmedAt = NULL WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: id },
    ]);
    setImmediate(() => {
      this.process(id).catch((err) => this.logger.error(`Reading ${id} crashed: ${shortError(err)}`));
    });
    return this.get(id, viewer);
  }

  /**
   * Removes the intake row and, when nothing else uses the file (submitted request, syllabus, appeal,
   * exchange upload, ...), the stored file too. Otherwise only the intake goes and the file is kept.
   */
  async remove(id: string, viewer: Viewer) {
    const row = await this.load(id);
    this.assertOwner(row, viewer);
    if (row.Status === 'reading') throw new ConflictException('This document is still being read - try again in a moment');
    await this.db.query(`DELETE FROM DocumentIntakes WHERE Id = @id`, [{ name: 'id', type: sql.UniqueIdentifier, value: id }]);
    let fileDeleted = false;
    try {
      fileDeleted = await this.uploads.deleteIfUnreferenced(row.UploadId, viewer.id, ['DocumentIntakes']);
    } catch (err) {
      this.logger.warn(`Could not delete the file for ${id}: ${shortError(err)}`);
    }
    return {
      ok: true,
      fileDeleted,
      message: fileDeleted ? 'Document deleted.' : 'Removed from your documents. The file itself is kept because it is attached to a request.',
    };
  }

  private static readonly ATTACH_TYPE: Record<string, string> = {
    transcript: 'transcript',
    syllabus: 'syllabus',
    english_test: 'english_test',
    id_document: 'other',
    enrollment_letter: 'other',
    other: 'other',
  };

  /** Attaches a processed document to one of the student's own requests as a request document. */
  async attach(id: string, viewer: Viewer & Record<string, any>, dto: { transcriptId: string; docTypeKey?: string }) {
    const row = await this.load(id);
    this.assertOwner(row, viewer);
    if (viewer.role !== 'student') throw new ForbiddenException('Only students can attach their own documents');
    if (row.Status === 'uploaded' || row.Status === 'reading') throw new ConflictException('This document is still being read');
    if (!(await this.schema.has('TranscriptDocuments'))) throw new ServiceUnavailableException('Request documents are not available yet');
    const own = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Transcripts WHERE Id = @t AND StudentUserId = @u`, [
      { name: 't', type: sql.UniqueIdentifier, value: dto.transcriptId },
      { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
    ]);
    if (!own.recordset[0]?.N) throw new ForbiddenException('You can only attach documents to your own requests');
    const key = dto.docTypeKey || DocumentsService.ATTACH_TYPE[row.DocType ?? 'other'] || 'other';
    const known = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM DocumentTypes WHERE DocTypeKey = @k`, [
      { name: 'k', type: sql.VarChar(40), value: key },
    ]);
    if (!known.recordset[0]?.N) throw new BadRequestException('Unknown request document type');
    const dup = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM TranscriptDocuments WHERE TranscriptId = @t AND UploadId = @up`, [
      { name: 't', type: sql.UniqueIdentifier, value: dto.transcriptId },
      { name: 'up', type: sql.UniqueIdentifier, value: row.UploadId },
    ]);
    if (dup.recordset[0]?.N) throw new ConflictException('This document is already attached to that request');
    await this.requests.addDocument(dto.transcriptId, viewer as any, { docTypeKey: key, uploadId: row.UploadId });
    return { ok: true, transcriptId: dto.transcriptId, docTypeKey: key };
  }

  // ── confirm ─────────────────────────────────────────────

  async confirm(id: string, viewer: Viewer) {
    const row = await this.load(id);
    this.assertOwner(row, viewer);
    if (row.Status === 'reading') throw new ConflictException('This document is still being read');
    const e = parseJson(row.ExtractedJson);
    if (!e || !e.docType) throw new BadRequestException('Choose what kind of document this is before confirming');
    const applied: string[] = [];

    if (await this.schema.has('Uploads', 'DocumentType')) {
      await this.db.query(`UPDATE Uploads SET DocumentType = @t WHERE Id = @id`, [
        { name: 'id', type: sql.UniqueIdentifier, value: row.UploadId },
        { name: 't', type: sql.NVarChar(50), value: e.docType },
      ]);
      applied.push('document type saved');
    }

    if (e.docType === 'transcript' && (await this.schema.has('StudentEducation'))) {
      const p = toPrefill(e, row.UploadId);
      if (p.institutionName && p.institutionName !== 'Unknown institution') {
        const exists = await this.db.query<{ N: number }>(
          `SELECT COUNT(*) AS N FROM StudentEducation WHERE UserId = @u AND LOWER(InstitutionName) = LOWER(@n)`,
          [
            { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
            { name: 'n', type: sql.NVarChar(200), value: p.institutionName },
          ],
        );
        if (!exists.recordset[0]?.N) {
          const order = await this.db.query<{ N: number }>(`SELECT ISNULL(MAX(SortOrder), -1) + 1 AS N FROM StudentEducation WHERE UserId = @u`, [
            { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
          ]);
          const inst = (e.fields.institution ?? {}) as Record<string, unknown>;
          const country = typeof inst.country === 'string' ? inst.country : null;
          const outside = p.isOutsideUS ?? (!!country && !/^(us|usa|united states( of america)?)$/i.test(country.trim()));
          await this.db.query(
            `INSERT INTO StudentEducation (UserId, InstitutionName, City, StateRegion, Country, IsOutsideUS, FullTime, SortOrder)
             VALUES (@u, @n, @c, @s, @co, @os, 1, @o)`,
            [
              { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
              { name: 'n', type: sql.NVarChar(200), value: p.institutionName },
              { name: 'c', type: sql.NVarChar(100), value: typeof inst.city === 'string' ? inst.city.slice(0, 100) : null },
              { name: 's', type: sql.NVarChar(100), value: typeof inst.state === 'string' ? inst.state.slice(0, 100) : null },
              { name: 'co', type: sql.NVarChar(100), value: country ? country.slice(0, 100) : null },
              { name: 'os', type: sql.Bit, value: outside ? 1 : 0 },
              { name: 'o', type: sql.Int, value: order.recordset[0]?.N ?? 0 },
            ],
          );
          applied.push('institution added to your education history');
        }
      }
    }

    if (e.docType === 'english_test' && (await this.schema.policyReady())) {
      const testType = typeof e.fields.testType === 'string' ? e.fields.testType : null;
      const score = typeof e.fields.score === 'string' ? e.fields.score : null;
      if (testType || score) {
        // Only fills blanks - an existing profile value is never overwritten.
        const r = await this.db.query(
          `UPDATE StudentProfiles
              SET EnglishTestType = COALESCE(NULLIF(EnglishTestType, ''), @t),
                  EnglishTestScore = COALESCE(NULLIF(EnglishTestScore, ''), @s),
                  UpdatedAt = SYSUTCDATETIME()
            WHERE UserId = @u`,
          [
            { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
            { name: 't', type: sql.NVarChar(30), value: testType },
            { name: 's', type: sql.NVarChar(20), value: score },
          ],
        );
        if (r.rowsAffected?.[0]) applied.push('English test details filled in where blank');
      }
    }

    // Everything else the document told us about the student, into the blanks on their profile.
    applied.push(...(await this.fillProfileFromDocument(e, viewer.id)));

    await this.db.query(`UPDATE DocumentIntakes SET Status = 'confirmed', ConfirmedAt = SYSUTCDATETIME() WHERE Id = @id`, [
      { name: 'id', type: sql.UniqueIdentifier, value: id },
    ]);
    return {
      intake: await this.get(id, viewer),
      applied,
      prefill: e.docType === 'transcript' ? toPrefill(e, row.UploadId) : null,
    };
  }

  /**
   * Copies what a confirmed document says into the student's profile, but only where the profile is
   * blank - a value the student typed themselves is never overwritten. Each piece is attempted on its
   * own so one missing column (an unapplied migration) never loses the rest.
   */
  private async fillProfileFromDocument(e: ExtractedData, userId: string): Promise<string[]> {
    const done: string[] = [];
    const u = { name: 'u', type: sql.UniqueIdentifier, value: userId };
    const set = async (sql_: string, inputs: QueryInput[], label: string) => {
      try {
        const r = await this.db.query(sql_, [u, ...inputs]);
        if (r.rowsAffected?.[0]) done.push(label);
      } catch { /* column not there yet */ }
    };

    if (e.docType === 'transcript') {
      const inst = (e.fields.institution ?? {}) as Record<string, unknown>;
      const student = (e.fields.student ?? {}) as Record<string, unknown>;
      const courses = Array.isArray(e.fields.courses) ? (e.fields.courses as { credits?: number | null }[]) : [];
      const name = typeof inst.name === 'string' && !/^unknown institution$/i.test(inst.name.trim()) ? inst.name.trim().slice(0, 200) : null;
      const gpa = typeof e.fields.gpa === 'number' ? e.fields.gpa : null;
      const credits = courses.reduce((n, c) => n + (typeof c.credits === 'number' ? c.credits : 0), 0);

      if (name) {
        await set(
          `UPDATE StudentProfiles SET PriorInstitutionName = @n, UpdatedAt = SYSUTCDATETIME()
           WHERE UserId = @u AND NULLIF(PriorInstitutionName, '') IS NULL`,
          [{ name: 'n', type: sql.NVarChar(200), value: name }],
          'current college filled in',
        );
      }
      if (gpa != null) {
        await set(
          `UPDATE StudentProfiles SET GPA = @g, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @u AND GPA IS NULL`,
          [{ name: 'g', type: sql.Decimal(3, 2), value: gpa }],
          'GPA filled in',
        );
      }
      if (credits > 0) {
        await set(
          `UPDATE StudentProfiles SET CreditsCompleted = @c, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @u AND CreditsCompleted IS NULL`,
          [{ name: 'c', type: sql.Decimal(6, 2), value: Math.round(credits * 100) / 100 }],
          'credits completed filled in',
        );
        if (name && (await this.schema.has('StudentEducation'))) {
          await set(
            `UPDATE StudentEducation SET CreditsEarned = @c
             WHERE UserId = @u AND CreditsEarned IS NULL AND LOWER(InstitutionName) = LOWER(@n)`,
            [
              { name: 'c', type: sql.Decimal(6, 2), value: Math.round(credits * 100) / 100 },
              { name: 'n', type: sql.NVarChar(200), value: name },
            ],
            'credits added to your education history',
          );
        }
      }
      if (typeof student.id === 'string' && student.id.trim()) {
        await set(
          `UPDATE Users SET StudentId = @s, UpdatedAt = SYSUTCDATETIME() WHERE Id = @u AND NULLIF(StudentId, '') IS NULL`,
          [{ name: 's', type: sql.NVarChar(50), value: student.id.trim().slice(0, 50) }],
          'student id filled in',
        );
      }
    }

    if (e.docType === 'id_document') {
      const country = typeof e.fields.country === 'string' ? e.fields.country.trim().slice(0, 100) : '';
      if (country) {
        await set(
          `UPDATE Users SET CountryOfOrigin = @c, UpdatedAt = SYSUTCDATETIME() WHERE Id = @u AND NULLIF(CountryOfOrigin, '') IS NULL`,
          [{ name: 'c', type: sql.NVarChar(100), value: country }],
          'country of origin filled in',
        );
      }
    }

    if (e.docType === 'enrollment_letter') {
      const f = e.fields as Record<string, unknown>;
      const inst = typeof f.institution === 'string' ? f.institution.trim().slice(0, 200) : '';
      if (inst) {
        await set(
          `UPDATE StudentProfiles SET PriorInstitutionName = @n, UpdatedAt = SYSUTCDATETIME()
           WHERE UserId = @u AND NULLIF(PriorInstitutionName, '') IS NULL`,
          [{ name: 'n', type: sql.NVarChar(200), value: inst }],
          'current college filled in',
        );
      }
    }

    return done;
  }

  async prefill(id: string, viewer: Viewer) {
    const row = await this.load(id);
    await this.assertCanView(row, viewer);
    const e = parseJson(row.ExtractedJson);
    if (!e || e.docType !== 'transcript') throw new BadRequestException('Only transcripts can pre-fill a transfer request');
    return toPrefill(e, row.UploadId);
  }
}
