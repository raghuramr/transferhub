import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, type QueryInput } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { ENTITY_ORDER, ImportService, type EntityType } from './import.service';
import type { PartnerContext } from './partners.service';

type Raw = Record<string, unknown>;
export const MAX_ROWS_PER_SUBMISSION = 5000;
export const MAX_ROWS_PER_IMPORT_CALL = 2000;

interface BatchRow {
  Id: number;
  Ref: string;
  PartnerId: number | null;
  Source: string;
  Status: string;
  SubmitterNote: string | null;
  SubmittedAt: Date;
  SubmittedIp: string | null;
  ReviewedAt: Date | null;
  ReviewerNote: string | null;
  ReportSentAt: Date | null;
  UniversityName: string | null;
  UniversityCode: string | null;
  ContactName: string | null;
  ContactEmail: string | null;
  ReviewerName: string | null;
}

interface RowRecord {
  Id: number;
  BatchId: number;
  EntityType: EntityType;
  RowNo: number;
  Payload: string;
  ValidationStatus: 'valid' | 'warning' | 'error';
  Messages: string | null;
  PlannedAction: 'create' | 'update' | 'skip';
  RowStatus: 'pending' | 'rejected' | 'created' | 'updated' | 'failed';
  OutcomeMessage: string | null;
  DecidedAt: Date | null;
}

export interface SubmissionBody {
  note?: string;
  universities?: Raw[];
  programs?: Raw[];
  courses?: Raw[];
}

const parseJson = <T,>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(private db: DatabaseService, private imports: ImportService, private email: EmailService) {}

  // ── receiving ─────────────────────────────────────────────────

  /**
   * Stores a submission as a pending batch. Rows are validated and stored
   * exactly as received; nothing touches the live catalogue.
   */
  async receive(body: SubmissionBody, partner: PartnerContext | null, ip: string | null) {
    const flat: { type: EntityType; payload: Raw }[] = [];
    for (const type of ENTITY_ORDER) {
      const list = body[type];
      if (list === undefined) continue;
      if (!Array.isArray(list)) throw new BadRequestException(`"${type}" must be a list`);
      for (const item of list) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException(`Every entry in "${type}" must be an object`);
        flat.push({ type, payload: item as Raw });
      }
    }
    if (!flat.length) throw new BadRequestException('Nothing to import: send at least one of universities, programs or courses.');
    if (flat.length > MAX_ROWS_PER_SUBMISSION) {
      throw new BadRequestException(`At most ${MAX_ROWS_PER_SUBMISSION} rows per submission (got ${flat.length}). Split it into several submissions.`);
    }

    const lookups = this.imports.newLookups();
    const pending = this.imports.pendingRefs(flat);
    const checked = [];
    for (const row of flat) {
      checked.push({ ...row, check: await this.imports.checkRow(row.type, row.payload, lookups, { scopeCode: partner?.universityCode, pending }) });
    }

    const batch = await this.db.query<{ Id: number; Ref: string }>(
      `INSERT INTO ImportBatches (PartnerId, Source, SubmitterNote, SubmittedIp)
       OUTPUT inserted.Id, inserted.Ref
       VALUES (@p, @s, @n, @ip)`,
      [
        { name: 'p', type: sql.Int, value: partner?.partnerId ?? null },
        { name: 's', type: sql.VarChar(10), value: partner ? 'api' : 'manual' },
        { name: 'n', type: sql.NVarChar(1000), value: body.note?.toString().slice(0, 1000) || null },
        { name: 'ip', type: sql.VarChar(64), value: ip?.slice(0, 64) ?? null },
      ],
    );
    const batchId = batch.recordset[0].Id;
    const ref = batch.recordset[0].Ref;

    const perType: Record<EntityType, number> = { universities: 0, programs: 0, courses: 0 };
    const CHUNK = 200;
    for (let i = 0; i < checked.length; i += CHUNK) {
      const slice = checked.slice(i, i + CHUNK);
      const inputs: QueryInput[] = [{ name: 'b', type: sql.Int, value: batchId }];
      const values = slice.map((r, j) => {
        perType[r.type]++;
        const n = i + j;
        inputs.push(
          { name: `t${j}`, type: sql.VarChar(12), value: r.type },
          { name: `n${j}`, type: sql.Int, value: n + 1 },
          { name: `p${j}`, type: sql.NVarChar(sql.MAX), value: JSON.stringify(r.payload) },
          { name: `v${j}`, type: sql.VarChar(8), value: r.check.status },
          { name: `m${j}`, type: sql.NVarChar(sql.MAX), value: r.check.messages.length ? JSON.stringify(r.check.messages) : null },
          { name: `a${j}`, type: sql.VarChar(8), value: r.check.action },
        );
        return `(@b, @t${j}, @n${j}, @p${j}, @v${j}, @m${j}, @a${j})`;
      });
      await this.db.query(
        `INSERT INTO ImportBatchRows (BatchId, EntityType, RowNo, Payload, ValidationStatus, Messages, PlannedAction) VALUES ${values.join(', ')}`,
        inputs,
      );
    }

    const validation = {
      valid: checked.filter((r) => r.check.status === 'valid').length,
      warnings: checked.filter((r) => r.check.status === 'warning').length,
      errors: checked.filter((r) => r.check.status === 'error').length,
    };
    void this.notifyReceived(ref, partner, perType, validation, body.note).catch((e) => this.logger.warn(`Submission emails failed: ${(e as Error).message}`));
    return { reference: ref, batchId, status: 'pending', received: perType, validation };
  }

  private async notifyReceived(
    ref: string,
    partner: PartnerContext | null,
    perType: Record<EntityType, number>,
    v: { valid: number; warnings: number; errors: number },
    note?: string,
  ) {
    const total = perType.universities + perType.programs + perType.courses;
    const summary = `${perType.universities} universities, ${perType.programs} programs, ${perType.courses} courses`;
    if (partner) {
      await this.email.sendRichNotice({
        to: partner.contactEmail,
        subject: `TransferHub received your submission ${ref}`,
        heading: 'We received your data',
        greetingName: partner.contactName.split(' ')[0],
        intro: `thank you - submission ${ref} (${total} rows) is now waiting for review by a TransferHub administrator. Nothing is added until it is approved; we will email you a report when it has been processed.`,
        details: [
          { label: 'Reference', value: ref },
          { label: 'Contents', value: summary },
          { label: 'Automatic checks', value: `${v.valid} clean, ${v.warnings} with warnings, ${v.errors} with errors (errors need a fix before they can be imported)` },
        ],
      });
    }
    const admins = await this.db.query<{ Email: string; FirstName: string }>(
      `SELECT u.Email, u.FirstName FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE r.Name = 'super_admin' AND u.IsActive = 1`,
    );
    for (const a of admins.recordset) {
      await this.email.sendRichNotice({
        to: a.Email,
        subject: `New data submission ${ref}${partner ? ` from ${partner.universityName}` : ''}`,
        heading: 'A data submission is waiting for review',
        greetingName: a.FirstName,
        intro: `${partner ? `${partner.universityName} (${partner.contactName}, ${partner.contactEmail}) sent` : 'A staff member staged'} ${total} rows for review.`,
        details: [
          { label: 'Reference', value: ref },
          { label: 'Contents', value: summary },
          { label: 'Checks', value: `${v.valid} clean, ${v.warnings} warnings, ${v.errors} errors` },
        ],
        quote: note ? { label: 'Note from sender', text: note } : undefined,
        ctaLabel: 'Review submission',
        ctaPath: '/superadmin/settings/import',
      });
    }
  }

  // ── reading ───────────────────────────────────────────────────

  private readonly BATCH_SELECT = `
    SELECT b.Id, b.Ref, b.PartnerId, b.Source, b.Status, b.SubmitterNote, b.SubmittedAt, b.SubmittedIp, b.ReviewedAt, b.ReviewerNote, b.ReportSentAt,
           p.UniversityName, p.UniversityCode, p.ContactName, p.ContactEmail,
           CASE WHEN u.Id IS NULL THEN NULL ELSE u.FirstName + ' ' + u.LastName END AS ReviewerName
    FROM ImportBatches b
    LEFT JOIN DataPartners p ON p.Id = b.PartnerId
    LEFT JOIN Users u ON u.Id = b.ReviewedBy`;

  private mapBatch(b: BatchRow, counts?: Record<string, number>) {
    return {
      id: b.Id,
      reference: b.Ref,
      source: b.Source,
      status: b.Status,
      note: b.SubmitterNote,
      submittedAt: b.SubmittedAt,
      submittedIp: b.SubmittedIp,
      reviewedAt: b.ReviewedAt,
      reviewedBy: b.ReviewerName,
      reviewerNote: b.ReviewerNote,
      reportSentAt: b.ReportSentAt,
      partner: b.PartnerId
        ? { id: b.PartnerId, universityName: b.UniversityName, universityCode: b.UniversityCode, contactName: b.ContactName, contactEmail: b.ContactEmail }
        : null,
      counts: counts ?? {},
    };
  }

  private async countsFor(batchIds?: number[]) {
    const where = batchIds ? `WHERE BatchId IN (${batchIds.map((n) => Number(n)).join(',') || 'NULL'})` : '';
    const r = await this.db.query<{ BatchId: number; Total: number; Pending: number; Rejected: number; Created: number; Updated: number; Failed: number; Errors: number; Warnings: number }>(
      `SELECT BatchId, COUNT(*) AS Total,
              SUM(CASE WHEN RowStatus = 'pending' THEN 1 ELSE 0 END) AS Pending,
              SUM(CASE WHEN RowStatus = 'rejected' THEN 1 ELSE 0 END) AS Rejected,
              SUM(CASE WHEN RowStatus = 'created' THEN 1 ELSE 0 END) AS Created,
              SUM(CASE WHEN RowStatus = 'updated' THEN 1 ELSE 0 END) AS Updated,
              SUM(CASE WHEN RowStatus = 'failed' THEN 1 ELSE 0 END) AS Failed,
              SUM(CASE WHEN ValidationStatus = 'error' AND RowStatus IN ('pending','failed') THEN 1 ELSE 0 END) AS Errors,
              SUM(CASE WHEN ValidationStatus = 'warning' AND RowStatus = 'pending' THEN 1 ELSE 0 END) AS Warnings
       FROM ImportBatchRows ${where} GROUP BY BatchId`,
    );
    const map = new Map<number, Record<string, number>>();
    for (const c of r.recordset) {
      map.set(c.BatchId, {
        total: c.Total, pending: c.Pending, rejected: c.Rejected, created: c.Created, updated: c.Updated,
        failed: c.Failed, errors: c.Errors, warnings: c.Warnings,
      });
    }
    return map;
  }

  async list(filter: { status?: string; partnerId?: number }) {
    const where: string[] = [];
    const inputs: QueryInput[] = [];
    if (filter.status === 'open') where.push(`b.Status IN ('pending','partial')`);
    else if (filter.status) {
      where.push('b.Status = @st');
      inputs.push({ name: 'st', type: sql.VarChar(10), value: filter.status });
    }
    if (filter.partnerId) {
      where.push('b.PartnerId = @pid');
      inputs.push({ name: 'pid', type: sql.Int, value: filter.partnerId });
    }
    const r = await this.db.query<BatchRow>(
      `${this.BATCH_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.SubmittedAt DESC`,
      inputs,
    );
    const counts = await this.countsFor(r.recordset.map((b) => b.Id));
    return r.recordset.map((b) => this.mapBatch(b, counts.get(b.Id)));
  }

  private async loadBatch(id: number) {
    const r = await this.db.query<BatchRow>(`${this.BATCH_SELECT} WHERE b.Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    if (!r.recordset[0]) throw new NotFoundException('Submission not found');
    return r.recordset[0];
  }

  private mapRow(r: RowRecord) {
    const payload = parseJson<Raw>(r.Payload, {});
    return {
      id: r.Id,
      rowNo: r.RowNo,
      entityType: r.EntityType,
      label: this.imports.describeRow(r.EntityType, payload),
      payload,
      validation: r.ValidationStatus,
      messages: parseJson<string[]>(r.Messages, []),
      plannedAction: r.PlannedAction,
      status: r.RowStatus,
      outcomeMessage: r.OutcomeMessage,
      decidedAt: r.DecidedAt,
    };
  }

  async get(id: number) {
    const b = await this.loadBatch(id);
    const rows = await this.db.query<RowRecord>(`SELECT * FROM ImportBatchRows WHERE BatchId = @id ORDER BY RowNo`, [{ name: 'id', type: sql.Int, value: id }]);
    const counts = await this.countsFor([id]);
    return { ...this.mapBatch(b, counts.get(id)), rows: rows.recordset.map((r) => this.mapRow(r)) };
  }

  /** What a partner may see about their own submissions (never other partners'). */
  async listForPartner(partnerId: number) {
    const all = await this.list({ partnerId });
    return all.map((b) => ({ reference: b.reference, status: b.status, submittedAt: b.submittedAt, reviewedAt: b.reviewedAt, counts: b.counts }));
  }

  async getForPartner(partnerId: number, ref: string) {
    const found = await this.db.query<{ Id: number }>(`SELECT Id FROM ImportBatches WHERE Ref = @r AND PartnerId = @p`, [
      { name: 'r', type: sql.VarChar(20), value: ref },
      { name: 'p', type: sql.Int, value: partnerId },
    ]);
    if (!found.recordset[0]) throw new NotFoundException('Submission not found');
    const full = await this.get(found.recordset[0].Id);
    return {
      reference: full.reference,
      status: full.status,
      submittedAt: full.submittedAt,
      reviewedAt: full.reviewedAt,
      counts: full.counts,
      message: full.reviewerNote,
      rows: full.rows.map((r) => ({ rowNo: r.rowNo, type: r.entityType, item: r.label, status: r.status, message: r.outcomeMessage ?? r.messages.join('; ') })),
    };
  }

  // ── reviewing ─────────────────────────────────────────────────

  private async refreshStatus(batchId: number) {
    const c = (await this.countsFor([batchId])).get(batchId);
    if (!c) return;
    const processed = c.created + c.updated + c.failed;
    let status: string;
    if (c.total > 0 && c.rejected === c.total) status = 'rejected';
    else if (c.pending > 0) status = processed > 0 || c.rejected > 0 ? 'partial' : 'pending';
    else status = 'imported';
    await this.db.query(`UPDATE ImportBatches SET Status = @s WHERE Id = @id`, [
      { name: 's', type: sql.VarChar(10), value: status },
      { name: 'id', type: sql.Int, value: batchId },
    ]);
  }

  private async selectedRows(batchId: number, rowIds: number[], statuses: string[]) {
    const ids = [...new Set(rowIds.map(Number).filter((n) => Number.isInteger(n)))];
    if (!ids.length) throw new BadRequestException('Select at least one row.');
    const r = await this.db.query<RowRecord>(
      `SELECT * FROM ImportBatchRows WHERE BatchId = @b AND Id IN (${ids.join(',')}) AND RowStatus IN (${statuses.map((s) => `'${s}'`).join(',')}) ORDER BY RowNo`,
      [{ name: 'b', type: sql.Int, value: batchId }],
    );
    return r.recordset;
  }

  async rejectRows(batchId: number, rowIds: number[], note: string | undefined, userId: string) {
    await this.loadBatch(batchId);
    const rows = await this.selectedRows(batchId, rowIds, ['pending', 'failed']);
    if (!rows.length) throw new BadRequestException('None of the selected rows can be rejected (already imported or rejected).');
    await this.db.query(
      `UPDATE ImportBatchRows SET RowStatus = 'rejected', OutcomeMessage = @m, DecidedBy = @u, DecidedAt = SYSUTCDATETIME()
       WHERE Id IN (${rows.map((r) => r.Id).join(',')})`,
      [
        { name: 'm', type: sql.NVarChar(1000), value: note?.trim() || 'Not accepted by the reviewer' },
        { name: 'u', type: sql.UniqueIdentifier, value: userId },
      ],
    );
    await this.refreshStatus(batchId);
    return { rejected: rows.length };
  }

  async restoreRows(batchId: number, rowIds: number[]) {
    await this.loadBatch(batchId);
    const rows = await this.selectedRows(batchId, rowIds, ['rejected', 'failed']);
    if (!rows.length) throw new BadRequestException('None of the selected rows are rejected or failed.');
    await this.db.query(
      `UPDATE ImportBatchRows SET RowStatus = 'pending', OutcomeMessage = NULL, DecidedBy = NULL, DecidedAt = NULL WHERE Id IN (${rows.map((r) => r.Id).join(',')})`,
    );
    await this.refreshStatus(batchId);
    return { restored: rows.length };
  }

  /** Lets the reviewer fix a typo instead of bouncing the whole submission. Revalidates the row. */
  async editRow(batchId: number, rowId: number, payload: Raw) {
    const b = await this.loadBatch(batchId);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestException('payload must be an object');
    const r = (await this.selectedRows(batchId, [rowId], ['pending', 'failed', 'rejected']))[0];
    if (!r) throw new BadRequestException('Only rows that have not been imported can be edited.');
    const lookups = this.imports.newLookups();
    const all = await this.db.query<RowRecord>(`SELECT EntityType, Payload FROM ImportBatchRows WHERE BatchId = @b AND Id <> @r`, [
      { name: 'b', type: sql.Int, value: batchId },
      { name: 'r', type: sql.Int, value: rowId },
    ]);
    const pending = this.imports.pendingRefs([
      ...all.recordset.map((x) => ({ type: x.EntityType, payload: parseJson<Raw>(x.Payload, {}) })),
      { type: r.EntityType, payload },
    ]);
    const check = await this.imports.checkRow(r.EntityType, payload, lookups, { scopeCode: b.UniversityCode ?? undefined, pending });
    await this.db.query(
      `UPDATE ImportBatchRows SET Payload = @p, ValidationStatus = @v, Messages = @m, PlannedAction = @a,
              RowStatus = 'pending', OutcomeMessage = NULL, DecidedBy = NULL, DecidedAt = NULL WHERE Id = @id`,
      [
        { name: 'p', type: sql.NVarChar(sql.MAX), value: JSON.stringify(payload) },
        { name: 'v', type: sql.VarChar(8), value: check.status },
        { name: 'm', type: sql.NVarChar(sql.MAX), value: check.messages.length ? JSON.stringify(check.messages) : null },
        { name: 'a', type: sql.VarChar(8), value: check.action },
        { name: 'id', type: sql.Int, value: rowId },
      ],
    );
    await this.refreshStatus(batchId);
    return { validation: check.status, messages: check.messages, plannedAction: check.action };
  }

  /** Imports exactly the selected rows (universities first, then programs, then courses). */
  async importRows(batchId: number, rowIds: number[], opts: { sendReport?: boolean; note?: string }, userId: string) {
    const b = await this.loadBatch(batchId);
    if (rowIds.length > MAX_ROWS_PER_IMPORT_CALL) {
      throw new BadRequestException(`Import at most ${MAX_ROWS_PER_IMPORT_CALL} rows per request; send the rest in another request.`);
    }
    const rows = await this.selectedRows(batchId, rowIds, ['pending', 'failed']);
    if (!rows.length) throw new BadRequestException('None of the selected rows can be imported (already imported or rejected).');

    // Rows are applied universities -> programs -> courses, so each row finds what it depends on already in the database.
    const sorted = [...rows].sort((a, c) => ENTITY_ORDER.indexOf(a.EntityType) - ENTITY_ORDER.indexOf(c.EntityType) || a.RowNo - c.RowNo);
    const lookups = this.imports.newLookups();
    const scope = b.UniversityCode ?? undefined;
    const tally = { created: 0, updated: 0, failed: 0, blocked: 0 };

    for (const row of sorted) {
      const payload = parseJson<Raw>(row.Payload, {});
      let status: RowRecord['RowStatus'];
      let message: string;
      try {
        const check = await this.imports.checkRow(row.EntityType, payload, lookups, { scopeCode: scope });
        if (check.status === 'error') {
          status = 'failed';
          message = check.messages.join('; ');
          tally.blocked++;
        } else {
          const res = await this.imports.applyRow(row.EntityType, payload, lookups, scope);
          status = res.outcome;
          message = res.message;
          tally[res.outcome]++;
        }
      } catch (e) {
        status = 'failed';
        message = (e as Error).message.slice(0, 900);
        tally.failed++;
      }
      await this.db.query(
        `UPDATE ImportBatchRows SET RowStatus = @s, OutcomeMessage = @m, DecidedBy = @u, DecidedAt = SYSUTCDATETIME() WHERE Id = @id`,
        [
          { name: 's', type: sql.VarChar(10), value: status },
          { name: 'm', type: sql.NVarChar(1000), value: message },
          { name: 'u', type: sql.UniqueIdentifier, value: userId },
          { name: 'id', type: sql.Int, value: row.Id },
        ],
      );
    }

    await this.db.query(`UPDATE ImportBatches SET ReviewedBy = @u, ReviewedAt = SYSUTCDATETIME(), ReviewerNote = COALESCE(@n, ReviewerNote) WHERE Id = @id`, [
      { name: 'u', type: sql.UniqueIdentifier, value: userId },
      { name: 'n', type: sql.NVarChar(1000), value: opts.note?.trim() || null },
      { name: 'id', type: sql.Int, value: batchId },
    ]);
    await this.refreshStatus(batchId);

    let reportSent = false;
    if (opts.sendReport !== false && b.PartnerId) reportSent = await this.sendReport(batchId, opts.note);
    return { ...tally, reportSent };
  }

  /** Reject everything still pending in one go (with a reason the partner will read). */
  async rejectBatch(batchId: number, note: string, userId: string, sendReport = true) {
    const b = await this.loadBatch(batchId);
    if (!note || note.trim().length < 3) throw new BadRequestException('Give the sender a reason.');
    await this.db.query(
      `UPDATE ImportBatchRows SET RowStatus = 'rejected', OutcomeMessage = @m, DecidedBy = @u, DecidedAt = SYSUTCDATETIME()
       WHERE BatchId = @b AND RowStatus IN ('pending','failed')`,
      [
        { name: 'm', type: sql.NVarChar(1000), value: note.trim() },
        { name: 'u', type: sql.UniqueIdentifier, value: userId },
        { name: 'b', type: sql.Int, value: batchId },
      ],
    );
    await this.db.query(`UPDATE ImportBatches SET ReviewedBy = @u, ReviewedAt = SYSUTCDATETIME(), ReviewerNote = @n WHERE Id = @id`, [
      { name: 'u', type: sql.UniqueIdentifier, value: userId },
      { name: 'n', type: sql.NVarChar(1000), value: note.trim() },
      { name: 'id', type: sql.Int, value: batchId },
    ]);
    await this.refreshStatus(batchId);
    const reportSent = sendReport && b.PartnerId ? await this.sendReport(batchId, note) : false;
    return { reportSent };
  }

  // ── the report back to the sender ─────────────────────────────

  async sendReport(batchId: number, note?: string): Promise<boolean> {
    const b = await this.loadBatch(batchId);
    if (!b.PartnerId || !b.ContactEmail) throw new BadRequestException('This submission has no partner contact to email.');
    const rows = (await this.db.query<RowRecord>(`SELECT * FROM ImportBatchRows WHERE BatchId = @b ORDER BY RowNo`, [{ name: 'b', type: sql.Int, value: batchId }])).recordset;
    const c = (await this.countsFor([batchId])).get(batchId);
    const label: Record<string, string> = { created: 'Added', updated: 'Updated', failed: 'Failed', rejected: 'Not accepted', pending: 'Still waiting' };
    const MAX = 300;
    const shown = rows.slice(0, MAX);
    const quoteText = (note ?? b.ReviewerNote ?? '').trim();

    await this.email.sendRichNotice({
      to: b.ContactEmail,
      subject: `TransferHub report for submission ${b.Ref}`,
      heading: `Report for submission ${b.Ref}`,
      greetingName: (b.ContactName ?? 'there').split(' ')[0],
      intro: 'your data submission has been reviewed. Here is what happened to each item.',
      details: [
        { label: 'Reference', value: b.Ref },
        { label: 'Added / updated', value: `${c?.created ?? 0} added, ${c?.updated ?? 0} updated` },
        { label: 'Not imported', value: `${c?.rejected ?? 0} not accepted, ${c?.failed ?? 0} failed, ${c?.pending ?? 0} still waiting` },
      ],
      quote: quoteText ? { label: 'Message from the reviewer', text: quoteText } : undefined,
      table: {
        headers: ['#', 'Type', 'Item', 'Result', 'Details'],
        rows: shown.map((r) => [
          String(r.RowNo),
          r.EntityType === 'universities' ? 'University' : r.EntityType === 'programs' ? 'Program' : 'Course',
          this.imports.describeRow(r.EntityType, parseJson<Raw>(r.Payload, {})),
          label[r.RowStatus] ?? r.RowStatus,
          r.OutcomeMessage ?? parseJson<string[]>(r.Messages, []).join('; '),
        ]),
        footnote: rows.length > MAX ? `Showing the first ${MAX} of ${rows.length} items. Fetch the full list from the API: GET /api/public/v1/submissions/${b.Ref}` : undefined,
      },
    });
    await this.db.query(`UPDATE ImportBatches SET ReportSentAt = SYSUTCDATETIME() WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: batchId }]);
    return this.email.isConfigured;
  }

  /** Staff-created staging: same pipeline, no partner, so there is nobody to email. */
  async stageByStaff(body: SubmissionBody) {
    return this.receive(body, null, null);
  }

}
