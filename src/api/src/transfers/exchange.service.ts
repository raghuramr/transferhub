import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { EventBus } from '../events/event-bus.service';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { Party, ScopeService } from '../policy/scope.service';
import { UploadsService } from '../uploads/uploads.service';
import { EmailService } from '../common/email.service';
import { templates } from '../common/email-templates';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowEngineService } from '../requests/workflow-engine.service';
import { RequestsService, Viewer } from '../requests/requests.service';
import { RolePermissionsCacheService } from '../auth/role-permissions-cache.service';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import {
  BUCKET_LABEL, PARTY_REMINDER_HOURS, PARTY_SHORT, cleanDueDate, defaultTitle, isParty, partyName, pickParty, reminderBlocked, statusBucket, validateAsk,
} from './exchange.logic';

export interface TransferRow {
  id: string;
  studentUserId: string;
  submittedById: string;
  sourceId: number | null;
  targetId: number | null;
  sourceName: string | null;
  targetName: string | null;
  studentName: string;
  studentFirstName: string;
  studentEmail: string;
  workflowStatus: string | null;
  status: string;
  receivedAt: Date;
}

interface DocReqRow {
  Id: number; TranscriptId: string; RequestedByParty: Party; RequestedFromParty: Party; RequestedByUserId: string;
  RequestedByInstitutionId: number | null; RequestedFromInstitutionId: number | null; DocTypeKey: string | null; DocTypeLabel: string | null;
  Title: string; Message: string | null; DueDate: Date | null; Status: string; FulfilledUploadId: string | null; FulfilledAt: Date | null;
  ResolutionNote: string | null; CreatedAt: Date; ByUserName: string | null;
}

type Op = 'view' | 'create' | 'edit';

/**
 * The collaboration between the student, the SOURCE university (University 1) and the TARGET university
 * (University 2) on one transfer: document requests, uploads into the student's folder, and
 * party-to-party reminders. Visibility follows RequestsService.assertCanView (scoped admins see
 * incoming + outgoing); who may speak for which side comes from ScopeService.partiesFor.
 */
@Injectable()
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);
  private moduleSeeded: { ok: boolean; at: number } | null = null;

  constructor(
    private db: DatabaseService,
    private schema: SchemaService,
    private scope: ScopeService,
    private uploads: UploadsService,
    private email: EmailService,
    private workflows: WorkflowsService,
    private engine: WorkflowEngineService,
    private requests: RequestsService,
    private perms: RolePermissionsCacheService,
    @Optional() private bus?: EventBus,
  ) {}

  // ── access helpers ──────────────────────────────────────────

  async ready(): Promise<boolean> {
    return this.schema.exchangeReady();
  }

  private async assertReady() {
    if (!(await this.ready())) throw new ServiceUnavailableException('Transfer exchange migration (022) has not been applied yet');
  }

  /**
   * Staff operations follow the Roles & Permissions matrix (module `transfers`, seed 016). Before that
   * seed is applied the module does not exist, so staff are allowed rather than locked out.
   * Students/agencies are not matrix-governed here: they may only act as their own side.
   */
  async assertStaffCan(viewer: Viewer, op: Op) {
    if (viewer.role === 'student' || viewer.role === 'agency') return;
    if (await this.perms.isAllowed(viewer.role, 'transfers', op)) return;
    if (!this.moduleSeeded || Date.now() - this.moduleSeeded.at > 60_000) {
      let ok = false;
      try {
        const r = await this.db.query(`SELECT 1 AS x FROM PermissionModules WHERE [Key] = 'transfers'`);
        ok = r.recordset.length > 0;
      } catch {
        ok = false;
      }
      this.moduleSeeded = { ok, at: Date.now() };
    }
    if (!this.moduleSeeded.ok && ['faculty', 'admin', 'super_admin'].includes(viewer.role)) return;
    throw new ForbiddenException(`Role '${viewer.role}' is not permitted to '${op}' on 'transfers'`);
  }

  async load(transcriptId: string): Promise<TransferRow> {
    const r = await this.db.query(
      `SELECT t.Id AS id, t.StudentUserId AS studentUserId, t.SubmittedById AS submittedById, t.InstitutionId AS sourceId,
              COALESCE(t.TargetInstitutionId, sp.TargetInstitutionId) AS targetId,
              si.Name AS sourceName, ti.Name AS targetName,
              u.FirstName + ' ' + u.LastName AS studentName, u.FirstName AS studentFirstName, u.Email AS studentEmail,
              t.WorkflowStatus AS workflowStatus, t.Status AS status, t.ReceivedAt AS receivedAt
       FROM Transcripts t
       JOIN Users u ON u.Id = t.StudentUserId
       LEFT JOIN StudentProfiles sp ON sp.UserId = t.StudentUserId
       LEFT JOIN Institutions si ON si.Id = t.InstitutionId
       LEFT JOIN Institutions ti ON ti.Id = COALESCE(t.TargetInstitutionId, sp.TargetInstitutionId)
       WHERE t.Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const row = r.recordset[0];
    if (!row) throw new NotFoundException('Request not found');
    return row as TransferRow;
  }

  /** Loads the transfer after the usual visibility check and works out which sides the caller may speak for. */
  async context(transcriptId: string, viewer: Viewer) {
    await this.requests.assertCanView(transcriptId, viewer);
    const t = await this.load(transcriptId);
    const parties = await this.scope.partiesFor(viewer, t);
    return { t, parties };
  }

  private institutionOf(t: TransferRow, party: Party): number | null {
    return party === 'source_university' ? t.sourceId : party === 'target_university' ? t.targetId : null;
  }

  private names(t: TransferRow) {
    return { source: t.sourceName, target: t.targetName, student: t.studentName };
  }

  private async audit(viewer: Viewer, action: string, entityId: string, detail: unknown) {
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, NewValue) VALUES (@u, @e, @r, @a, 'TransferExchange', @id, @v)`,
        [
          { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
          { name: 'e', type: sql.NVarChar(254), value: viewer.email },
          { name: 'r', type: sql.VarChar(20), value: viewer.role },
          { name: 'a', type: sql.NVarChar(200), value: action },
          { name: 'id', type: sql.NVarChar(100), value: entityId },
          { name: 'v', type: sql.NVarChar(sql.MAX), value: JSON.stringify(detail) },
        ],
      );
    } catch (e) {
      this.logger.warn(`audit failed: ${(e as Error).message}`);
    }
  }

  /** People to e-mail for a side: the student, or the university's staff (scoped admin/faculty, else approvers/admins). */
  async recipients(t: TransferRow, party: Party): Promise<{ email: string; name: string }[]> {
    if (party === 'student') return [{ email: t.studentEmail, name: t.studentFirstName }];
    const instId = this.institutionOf(t, party);
    let people: { email: string; name: string }[] = [];
    if (instId != null) {
      const r = await this.db.query<{ Email: string; Name: string }>(
        `SELECT DISTINCT u.Email, u.FirstName + ' ' + u.LastName AS Name
         FROM Users u JOIN Roles r ON r.Id = u.RoleId JOIN UserScopeUniversities s ON s.UserId = u.Id
         WHERE u.IsActive = 1 AND r.Name IN ('admin','faculty') AND s.InstitutionId = @i`,
        [{ name: 'i', type: sql.Int, value: instId }],
      ).catch(() => ({ recordset: [] as { Email: string; Name: string }[] }));
      people = r.recordset.map((x) => ({ email: x.Email, name: x.Name }));
    }
    if (!people.length && party === 'target_university') {
      const st = await this.db.query<{ WorkflowStageId: number | null }>(
        `SELECT TOP 1 WorkflowStageId FROM TranscriptStages WHERE TranscriptId = @t AND Status = 'active' ORDER BY StageOrder`,
        [{ name: 't', type: sql.UniqueIdentifier, value: t.id }],
      ).catch(() => ({ recordset: [] as { WorkflowStageId: number | null }[] }));
      people = (await this.workflows.resolveApprovers(st.recordset[0]?.WorkflowStageId ?? null)).map((p) => ({ email: p.email, name: p.name }));
    }
    if (!people.length) people = (await this.workflows.admins()).map((p) => ({ email: p.email, name: p.name }));
    const seen = new Set<string>();
    return people.filter((p) => (seen.has(p.email.toLowerCase()) ? false : (seen.add(p.email.toLowerCase()), true)));
  }

  private pathFor(party: Party, transcriptId: string) {
    return party === 'student' ? `/student/transcript/${transcriptId}` : `/transfers/${transcriptId}`;
  }

  /** Student-facing audience when the student is one of the two sides, otherwise staff-only. */
  private async note(t: TransferRow, a: Party, b: Party, text: string) {
    const audience = a === 'student' || b === 'student' ? 'student' : 'internal';
    await this.engine.addNote(t.id, null, audience, 'system', null, null, text).catch(() => undefined);
  }

  // ── read ────────────────────────────────────────────────────

  async exchange(transcriptId: string, viewer: Viewer) {
    const { t, parties } = await this.context(transcriptId, viewer);
    const ready = await this.ready();
    const isStudentSide = viewer.role === 'student' || viewer.role === 'agency';
    const stage = await this.db.query<{ StageName: string }>(
      `SELECT TOP 1 StageName FROM TranscriptStages WHERE TranscriptId = @t AND Status = 'active' ORDER BY StageOrder`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    ).catch(() => ({ recordset: [] as { StageName: string }[] }));
    const bucket = statusBucket(t.workflowStatus, t.status);
    const base = {
      ready,
      transfer: {
        id: t.id,
        studentName: t.studentName,
        studentEmail: isStudentSide ? undefined : t.studentEmail,
        source: { id: t.sourceId, name: t.sourceName },
        target: { id: t.targetId, name: t.targetName },
        bucket,
        bucketLabel: BUCKET_LABEL[bucket],
        stageName: stage.recordset[0]?.StageName ?? null,
        receivedAt: t.receivedAt,
      },
      viewer: {
        parties,
        defaultParty: pickParty(parties, null),
        isStudentSide,
        readOnly: !isStudentSide && !(await this.scope.canWorkRequest(viewer, transcriptId)),
      },
      documentTypes: await this.workflows.documentTypes().catch(() => []),
    };
    if (!ready) return { ...base, requests: [], uploads: [], reminders: [], blocked: {} };

    const [reqRes, upRes, remRes] = await Promise.all([
      this.db.query<DocReqRow>(
        `SELECT d.Id, d.TranscriptId, d.RequestedByParty, d.RequestedFromParty, d.RequestedByUserId, d.RequestedByInstitutionId, d.RequestedFromInstitutionId,
                d.DocTypeKey, dt.Label AS DocTypeLabel, d.Title, d.Message, d.DueDate, d.Status, d.FulfilledUploadId, d.FulfilledAt, d.ResolutionNote, d.CreatedAt,
                u.FirstName + ' ' + u.LastName AS ByUserName
         FROM DocumentRequests d
         LEFT JOIN DocumentTypes dt ON dt.DocTypeKey = d.DocTypeKey
         LEFT JOIN Users u ON u.Id = d.RequestedByUserId
         WHERE d.TranscriptId = @t ORDER BY CASE WHEN d.Status = 'open' THEN 0 ELSE 1 END, d.CreatedAt DESC`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      ),
      this.db.query(
        `SELECT up.Id AS id, up.OriginalFileName AS fileName, up.MimeType AS mimeType, up.SizeBytes AS sizeBytes, up.DocumentType AS documentType,
                dt.Label AS documentTypeLabel, up.UploadedByParty AS party, up.UploadedByInstitutionId AS institutionId, i.Name AS institutionName,
                up.Note AS note, up.DocumentRequestId AS documentRequestId, up.CreatedAt AS createdAt, u.FirstName + ' ' + u.LastName AS uploaderName
         FROM Uploads up
         LEFT JOIN Users u ON u.Id = up.OwnerUserId
         LEFT JOIN Institutions i ON i.Id = up.UploadedByInstitutionId
         LEFT JOIN DocumentTypes dt ON dt.DocTypeKey = up.DocumentType
         WHERE up.TranscriptId = @t ORDER BY up.CreatedAt DESC`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      ),
      this.db.query(
        `SELECT r.Id AS id, r.FromParty AS fromParty, r.ToParty AS toParty, r.Message AS message, r.DocumentRequestId AS documentRequestId,
                r.RecipientCount AS recipientCount, r.Success AS emailed, r.CreatedAt AS createdAt, u.FirstName + ' ' + u.LastName AS sentBy
         FROM PartyReminders r LEFT JOIN Users u ON u.Id = r.SentByUserId
         WHERE r.TranscriptId = @t ORDER BY r.CreatedAt DESC`,
        [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
      ),
    ]);

    // Students see only what involves them (university-to-university asks and reminders stay between the universities).
    const involvesStudent = (a: string, b: string) => a === 'student' || b === 'student';
    const reqRows = isStudentSide ? reqRes.recordset.filter((r) => involvesStudent(r.RequestedByParty, r.RequestedFromParty)) : reqRes.recordset;
    const remRows = isStudentSide ? remRes.recordset.filter((r) => involvesStudent(r.fromParty, r.toParty)) : remRes.recordset;

    const now = Date.now();
    const blocked: Record<string, string> = {};
    for (const p of parties) {
      for (const to of ['student', 'source_university', 'target_university'] as Party[]) {
        if (to === p) continue;
        const last = remRes.recordset.find((r) => r.fromParty === p && r.toParty === to && r.documentRequestId == null);
        if (last && reminderBlocked(last.createdAt, now)) blocked[`${p}>${to}:`] = new Date(new Date(last.createdAt).getTime() + PARTY_REMINDER_HOURS * 3_600_000).toISOString();
      }
    }
    const requests = reqRows.map((r) => {
      const open = r.Status === 'open';
      const lastRem = remRes.recordset.find((x) => x.documentRequestId === r.Id);
      const remBlockedUntil = lastRem && reminderBlocked(lastRem.createdAt, now) ? new Date(new Date(lastRem.createdAt).getTime() + PARTY_REMINDER_HOURS * 3_600_000).toISOString() : null;
      return {
        id: r.Id,
        byParty: r.RequestedByParty,
        fromParty: r.RequestedFromParty,
        byName: r.RequestedByParty === 'student' ? t.studentName : partyName(r.RequestedByParty, this.names(t)),
        fromName: partyName(r.RequestedFromParty, this.names(t)),
        byUser: isStudentSide && r.RequestedByParty !== 'student' ? null : r.ByUserName,
        docTypeKey: r.DocTypeKey,
        docTypeLabel: r.DocTypeLabel,
        title: r.Title,
        message: r.Message,
        dueDate: r.DueDate,
        overdue: open && !!r.DueDate && new Date(r.DueDate).getTime() + 86_400_000 < now,
        status: r.Status,
        fulfilledUploadId: r.FulfilledUploadId,
        fulfilledAt: r.FulfilledAt,
        resolutionNote: r.ResolutionNote,
        createdAt: r.CreatedAt,
        canFulfil: open && parties.includes(r.RequestedFromParty),
        canDecline: open && parties.includes(r.RequestedFromParty),
        canCancel: open && parties.includes(r.RequestedByParty),
        canRemind: open && parties.includes(r.RequestedByParty) && !remBlockedUntil,
        remindBlockedUntil: open && parties.includes(r.RequestedByParty) ? remBlockedUntil : null,
      };
    });
    return {
      ...base,
      requests,
      uploads: upRes.recordset.map((u) => ({
        ...u,
        partyLabel: u.party ? PARTY_SHORT[u.party as Party] : null,
        partyName: u.party ? partyName(u.party as Party, this.names(t)) : null,
        uploaderName: isStudentSide && u.party !== 'student' ? null : u.uploaderName,
        url: `/uploads/${u.id}`,
      })),
      reminders: remRows.map((r) => ({ ...r, fromName: partyName(r.fromParty as Party, this.names(t)), toName: partyName(r.toParty as Party, this.names(t)), sentBy: isStudentSide && r.fromParty !== 'student' ? null : r.sentBy })),
      blocked,
      reminderHours: PARTY_REMINDER_HOURS,
    };
  }

  // ── document requests ───────────────────────────────────────

  async createRequest(
    transcriptId: string,
    viewer: Viewer,
    dto: { fromParty: string; party?: string; docTypeKey?: string; title?: string; message?: string; dueDate?: string },
  ) {
    await this.assertReady();
    await this.assertStaffCan(viewer, 'create');
    const { t, parties } = await this.context(transcriptId, viewer);
    const by = pickParty(parties, dto.party);
    if (!by) throw new ForbiddenException('You cannot act for any side of this transfer.');
    if (!isParty(dto.fromParty)) throw new BadRequestException('Unknown party');
    const from = dto.fromParty;
    const bad = validateAsk(parties, by, from);
    if (bad) throw new BadRequestException(bad);
    if (this.institutionOf(t, from) == null && from !== 'student') throw new BadRequestException('That university is not set on this request.');

    let label: string | null = null;
    if (dto.docTypeKey) {
      const dt = await this.db.query<{ Label: string }>(`SELECT Label FROM DocumentTypes WHERE DocTypeKey = @k`, [{ name: 'k', type: sql.VarChar(40), value: dto.docTypeKey }]);
      if (!dt.recordset[0]) throw new BadRequestException('Unknown document type');
      label = dt.recordset[0].Label;
    }
    const title = defaultTitle(label, dto.title);
    if (!dto.docTypeKey && !(dto.title ?? '').trim()) throw new BadRequestException('Say what document is needed.');

    const ins = await this.db.query<{ Id: number }>(
      `INSERT INTO DocumentRequests (TranscriptId, RequestedByParty, RequestedFromParty, RequestedByUserId, RequestedByInstitutionId, RequestedFromInstitutionId, DocTypeKey, Title, Message, DueDate)
       OUTPUT INSERTED.Id
       VALUES (@t, @by, @from, @u, @byInst, @fromInst, @k, @title, @msg, @due)`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 'by', type: sql.VarChar(20), value: by },
        { name: 'from', type: sql.VarChar(20), value: from },
        { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
        { name: 'byInst', type: sql.Int, value: this.institutionOf(t, by) },
        { name: 'fromInst', type: sql.Int, value: this.institutionOf(t, from) },
        { name: 'k', type: sql.VarChar(40), value: dto.docTypeKey ?? null },
        { name: 'title', type: sql.NVarChar(200), value: title },
        { name: 'msg', type: sql.NVarChar(1000), value: dto.message?.trim() || null },
        { name: 'due', type: sql.Date, value: cleanDueDate(dto.dueDate) },
      ],
    );
    const id = ins.recordset[0].Id;
    const byName = partyName(by, this.names(t));
    await this.note(t, by, from, `${byName} asked ${partyName(from, this.names(t))} for a document: ${title}.`);
    this.bus?.emit({ type: 'document_requested', transcriptId, text: 'A document was requested' });
    await this.audit(viewer, 'DOCUMENT_REQUEST_CREATED', transcriptId, { id, by, from, title });

    // E-mail the asked side. Delivery problems never block the request.
    try {
      for (const p of await this.recipients(t, from)) {
        await this.email.sendEmail(p.email, templates.documentRequested(this.email.context, {
          name: p.name, fromName: byName, student: t.studentName, title, message: dto.message?.trim() || null, dueDate: cleanDueDate(dto.dueDate),
          path: this.pathFor(from, t.id), transcriptId: t.id, source: t.sourceName ?? 'the sending university', target: t.targetName ?? 'the receiving university',
        }));
      }
    } catch (e) {
      this.logger.warn(`document request e-mail failed: ${(e as Error).message}`);
    }
    return this.exchange(transcriptId, viewer);
  }

  private async getRequest(transcriptId: string, id: number): Promise<DocReqRow> {
    const r = await this.db.query<DocReqRow>(
      `SELECT Id, TranscriptId, RequestedByParty, RequestedFromParty, RequestedByUserId, RequestedByInstitutionId, RequestedFromInstitutionId, DocTypeKey, Title, Message, Status
       FROM DocumentRequests WHERE Id = @id AND TranscriptId = @t`,
      [{ name: 'id', type: sql.Int, value: id }, { name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    if (!r.recordset[0]) throw new NotFoundException('Document request not found');
    return r.recordset[0];
  }

  /** The asking side withdraws (`cancel`) or the asked side refuses (`decline`). */
  async close(transcriptId: string, requestId: number, viewer: Viewer, outcome: 'cancelled' | 'declined', note?: string) {
    await this.assertReady();
    await this.assertStaffCan(viewer, 'edit');
    const { t, parties } = await this.context(transcriptId, viewer);
    const req = await this.getRequest(transcriptId, requestId);
    if (req.Status !== 'open') throw new BadRequestException('This request is already closed.');
    const actor = outcome === 'cancelled' ? req.RequestedByParty : req.RequestedFromParty;
    if (!parties.includes(actor)) {
      throw new ForbiddenException(outcome === 'cancelled' ? 'Only the side that asked can cancel this request.' : 'Only the side that was asked can decline it.');
    }
    await this.db.query(
      `UPDATE DocumentRequests SET Status = @s, ResolvedByUserId = @u, ResolutionNote = @n, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 'open'`,
      [
        { name: 's', type: sql.VarChar(12), value: outcome },
        { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
        { name: 'n', type: sql.NVarChar(500), value: note?.trim() || null },
        { name: 'id', type: sql.Int, value: requestId },
      ],
    );
    const actorName = partyName(actor, this.names(t));
    const other = actor === req.RequestedByParty ? req.RequestedFromParty : req.RequestedByParty;
    await this.note(t, req.RequestedByParty, req.RequestedFromParty, `${actorName} ${outcome === 'cancelled' ? 'withdrew' : 'declined'} the request for "${req.Title}"${note?.trim() ? `: ${note.trim()}` : '.'}`);
    await this.audit(viewer, outcome === 'cancelled' ? 'DOCUMENT_REQUEST_CANCELLED' : 'DOCUMENT_REQUEST_DECLINED', transcriptId, { id: requestId });
    await this.notifyResolved(t, other, actorName, req.Title, outcome, note);
    return this.exchange(transcriptId, viewer);
  }

  private async notifyResolved(t: TransferRow, to: Party, byName: string, title: string, outcome: 'fulfilled' | 'declined' | 'cancelled', note?: string | null) {
    try {
      for (const p of await this.recipients(t, to)) {
        await this.email.sendEmail(p.email, templates.documentResolved(this.email.context, {
          name: p.name, byName, student: t.studentName, title, outcome, note: note?.trim() || null, path: this.pathFor(to, t.id), transcriptId: t.id,
        }));
      }
    } catch (e) {
      this.logger.warn(`document request e-mail failed: ${(e as Error).message}`);
    }
  }

  // ── uploads ─────────────────────────────────────────────────

  /**
   * Stores a file against the transfer, inside the STUDENT's folder, recording who uploaded it. If it
   * answers a document request (`documentRequestId`), the request is marked fulfilled and the asker told.
   */
  async upload(
    transcriptId: string,
    viewer: Viewer,
    file: UploadedFileLike,
    opts: { party?: string; documentType?: string; note?: string; documentRequestId?: number | null },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    await this.assertReady();
    await this.assertStaffCan(viewer, 'create');
    const { t, parties } = await this.context(transcriptId, viewer);

    let req: DocReqRow | null = null;
    let party: Party | null;
    if (opts.documentRequestId) {
      req = await this.getRequest(transcriptId, opts.documentRequestId);
      if (req.Status !== 'open') throw new BadRequestException('This document request is already closed.');
      if (!parties.includes(req.RequestedFromParty)) throw new ForbiddenException('This document was requested from another side of the transfer.');
      party = req.RequestedFromParty;
    } else {
      party = pickParty(parties, opts.party);
    }
    if (!party) throw new ForbiddenException('You cannot upload to this transfer.');

    const docType = (opts.documentType || req?.DocTypeKey || 'other').trim();
    const dt = await this.db.query<{ Label: string }>(`SELECT Label FROM DocumentTypes WHERE DocTypeKey = @k`, [{ name: 'k', type: sql.VarChar(40), value: docType }]);
    if (!dt.recordset[0]) throw new BadRequestException('Unknown document type');

    const saved = await this.uploads.save(file, {
      ownerUserId: viewer.id,
      role: viewer.role,
      entityType: 'transfer',
      entityId: transcriptId,
      isPublic: false,
      documentType: docType,
      transfer: { studentUserId: t.studentUserId, transcriptId, party, institutionId: this.institutionOf(t, party), note: opts.note?.trim() || null, documentRequestId: req?.Id ?? null },
    });

    // Count it on the request's document checklist too (best effort).
    await this.db.query(
      `INSERT INTO TranscriptDocuments (TranscriptId, DocTypeKey, UploadId, FileName, Notes, CreatedBy) VALUES (@t, @k, @u, @f, @n, @by)`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 'k', type: sql.VarChar(40), value: docType },
        { name: 'u', type: sql.UniqueIdentifier, value: saved.id },
        { name: 'f', type: sql.NVarChar(300), value: file.originalname.slice(0, 300) },
        { name: 'n', type: sql.NVarChar(500), value: `Added by ${partyName(party, this.names(t))}` },
        { name: 'by', type: sql.UniqueIdentifier, value: viewer.id },
      ],
    ).catch((e) => this.logger.warn(`checklist link failed: ${(e as Error).message}`));

    const who = partyName(party, this.names(t));
    await this.engine.addNote(transcriptId, null, 'student', 'system', null, null, `${who} added a document: ${file.originalname}${req ? ` (for "${req.Title}")` : ''}.`).catch(() => undefined);
    this.bus?.emit({ type: 'document_added', transcriptId, text: 'A document was added to the request' });
    await this.audit(viewer, 'TRANSFER_DOCUMENT_UPLOADED', transcriptId, { uploadId: saved.id, party, docType, requestId: req?.Id ?? null });

    if (req) {
      await this.db.query(
        `UPDATE DocumentRequests SET Status = 'fulfilled', FulfilledUploadId = @up, FulfilledByUserId = @u, FulfilledAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 'open'`,
        [
          { name: 'up', type: sql.UniqueIdentifier, value: saved.id },
          { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
          { name: 'id', type: sql.Int, value: req.Id },
        ],
      );
      await this.notifyResolved(t, req.RequestedByParty, who, req.Title, 'fulfilled', opts.note);
    }
    return { upload: saved, exchange: await this.exchange(transcriptId, viewer) };
  }

  // ── reminders ───────────────────────────────────────────────

  /** Any side reminds any other side, about the request or one open document request. 12h per sender side, recipient side and subject. */
  async remind(transcriptId: string, viewer: Viewer, dto: { toParty: string; party?: string; documentRequestId?: number | null; message?: string }) {
    await this.assertReady();
    await this.assertStaffCan(viewer, 'create');
    const { t, parties } = await this.context(transcriptId, viewer);
    const from = pickParty(parties, dto.party);
    if (!from) throw new ForbiddenException('You cannot act for any side of this transfer.');
    if (!isParty(dto.toParty)) throw new BadRequestException('Unknown party');
    const to = dto.toParty;
    const bad = validateAsk(parties, from, to);
    if (bad) throw new BadRequestException(bad);
    if (to !== 'student' && this.institutionOf(t, to) == null) throw new BadRequestException('That university is not set on this request.');

    let req: DocReqRow | null = null;
    if (dto.documentRequestId) {
      req = await this.getRequest(transcriptId, dto.documentRequestId);
      if (req.Status !== 'open') throw new BadRequestException('This document request is already closed.');
      if (req.RequestedByParty !== from || req.RequestedFromParty !== to) {
        throw new BadRequestException('A reminder about a document request goes from the side that asked to the side that was asked.');
      }
    }

    const recent = await this.db.query<{ Last: Date }>(
      `SELECT MAX(CreatedAt) AS Last FROM PartyReminders
       WHERE TranscriptId = @t AND FromParty = @f AND ToParty = @to AND ISNULL(DocumentRequestId, 0) = @d`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 'f', type: sql.VarChar(20), value: from },
        { name: 'to', type: sql.VarChar(20), value: to },
        { name: 'd', type: sql.Int, value: req?.Id ?? 0 },
      ],
    );
    if (reminderBlocked(recent.recordset[0]?.Last, Date.now())) {
      throw new HttpException(`A reminder was already sent recently. You can send another every ${PARTY_REMINDER_HOURS} hours.`, 429);
    }

    const text = dto.message?.trim() || null;
    const fromName = from === 'student' ? `${t.studentName} (student)` : partyName(from, this.names(t));
    const subjectLine = req ? `still waiting for "${req.Title}"` : 'an update is needed';
    let sent = 0;
    let allOk = true;
    try {
      for (const p of await this.recipients(t, to)) {
        const r = await this.email.sendEmail(p.email, templates.partyReminder(this.email.context, {
          name: p.name, fromName, student: t.studentName, subjectLine, message: text, path: this.pathFor(to, t.id), transcriptId: t.id,
          source: t.sourceName ?? 'the sending university', target: t.targetName ?? 'the receiving university',
        }));
        sent++;
        if (!r?.ok) allOk = false;
      }
    } catch (e) {
      this.logger.warn(`party reminder e-mail failed: ${(e as Error).message}`);
    }

    await this.db.query(
      `INSERT INTO PartyReminders (TranscriptId, DocumentRequestId, FromParty, ToParty, SentByUserId, SentByInstitutionId, ToInstitutionId, Message, RecipientCount, Success)
       VALUES (@t, @d, @f, @to, @u, @fi, @ti, @m, @n, @ok)`,
      [
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 'd', type: sql.Int, value: req?.Id ?? null },
        { name: 'f', type: sql.VarChar(20), value: from },
        { name: 'to', type: sql.VarChar(20), value: to },
        { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
        { name: 'fi', type: sql.Int, value: this.institutionOf(t, from) },
        { name: 'ti', type: sql.Int, value: this.institutionOf(t, to) },
        { name: 'm', type: sql.NVarChar(500), value: text },
        { name: 'n', type: sql.Int, value: sent },
        { name: 'ok', type: sql.Bit, value: this.email.isConfigured && sent > 0 && allOk ? 1 : 0 },
      ],
    );
    await this.note(t, from, to, `${fromName} sent ${partyName(to, this.names(t))} a reminder: ${subjectLine}${text ? ` - ${text}` : '.'}`);
    this.bus?.emit({ type: 'reminder_sent', transcriptId, audience: 'staff', text: 'A reminder was sent' });
    await this.audit(viewer, 'PARTY_REMINDER_SENT', transcriptId, { from, to, requestId: req?.Id ?? null });
    return { sent, emailConfigured: this.email.isConfigured, exchange: await this.exchange(transcriptId, viewer) };
  }
}
