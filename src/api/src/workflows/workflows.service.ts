import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { CreateWorkflowDto, SaveGroupDto, SaveWorkflowDto } from './dto/workflow.dto';

export interface StageApprover {
  id: number;
  approverType: 'role' | 'group' | 'user';
  roleName: string | null;
  groupId: number | null;
  groupName: string | null;
  userId: string | null;
  userName: string | null;
}

export interface WorkflowStageDef {
  id: number;
  stageOrder: number;
  stageKey: string;
  name: string;
  description: string | null;
  stageType: 'system' | 'review' | 'approval';
  agentTask: 'none' | 'intake' | 'match' | 'finalize';
  slaDays: number | null;
  isEnabled: boolean;
  canBypass: boolean;
  requiresComment: boolean;
  autoApprove: boolean;
  autoApproveMinConfidence: number | null;
  approvers: StageApprover[];
}

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || 'stage';
}

@Injectable()
export class WorkflowsService {
  constructor(private db: DatabaseService) {}

  async list() {
    const res = await this.db.query(
      `SELECT w.Id AS id, w.InstitutionId AS institutionId, i.Name AS institutionName, w.Name AS name,
              w.Description AS description, w.AllowBypass AS allowBypass, w.IsActive AS isActive,
              (SELECT COUNT(*) FROM WorkflowStages s WHERE s.WorkflowId = w.Id) AS stageCount,
              (SELECT COUNT(*) FROM Transcripts t WHERE t.WorkflowId = w.Id AND t.WorkflowStatus = 'active') AS activeRequests
       FROM WorkflowDefinitions w LEFT JOIN Institutions i ON i.Id = w.InstitutionId
       ORDER BY CASE WHEN w.InstitutionId IS NULL THEN 0 ELSE 1 END, i.Name`,
    );
    return res.recordset;
  }

  async get(id: number) {
    const wf = await this.db.query(
      `SELECT w.Id AS id, w.InstitutionId AS institutionId, i.Name AS institutionName, w.Name AS name,
              w.Description AS description, w.AllowBypass AS allowBypass, w.IsActive AS isActive
       FROM WorkflowDefinitions w LEFT JOIN Institutions i ON i.Id = w.InstitutionId WHERE w.Id = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    if (!wf.recordset[0]) throw new NotFoundException('Workflow not found');
    const docs = await this.db.query(
      `SELECT d.DocTypeKey AS docTypeKey, d.Label AS label, d.Description AS description, d.PerCourse AS perCourse,
              CAST(ISNULL(r.IsRequired, 0) AS BIT) AS isRequired, CAST(CASE WHEN r.DocTypeKey IS NULL THEN 0 ELSE 1 END AS BIT) AS offered
       FROM DocumentTypes d
       LEFT JOIN WorkflowRequiredDocs r ON r.DocTypeKey = d.DocTypeKey AND r.WorkflowId = @id
       ORDER BY d.SortOrder`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    return { ...wf.recordset[0], stages: await this.getStages(id), documents: docs.recordset };
  }

  async getStages(workflowId: number): Promise<WorkflowStageDef[]> {
    const stages = await this.db.query(
      `SELECT Id, StageOrder, StageKey, Name, Description, StageType, AgentTask, SlaDays, IsEnabled, CanBypass, RequiresComment
       FROM WorkflowStages WHERE WorkflowId = @id ORDER BY StageOrder`,
      [{ name: 'id', type: sql.Int, value: workflowId }],
    );
    const approvers = await this.db.query(
      `SELECT a.Id, a.StageId, a.ApproverType, a.RoleName, a.GroupId, g.Name AS GroupName, a.UserId,
              u.FirstName + ' ' + u.LastName AS UserName
       FROM WorkflowStageApprovers a
       JOIN WorkflowStages s ON s.Id = a.StageId
       LEFT JOIN ApproverGroups g ON g.Id = a.GroupId
       LEFT JOIN Users u ON u.Id = a.UserId
       WHERE s.WorkflowId = @id ORDER BY a.Id`,
      [{ name: 'id', type: sql.Int, value: workflowId }],
    );
    const auto = await this.automationFor(workflowId);
    return stages.recordset.map((s) => ({
      id: s.Id,
      stageOrder: s.StageOrder,
      stageKey: s.StageKey,
      name: s.Name,
      description: s.Description,
      stageType: s.StageType,
      agentTask: s.AgentTask,
      slaDays: s.SlaDays,
      isEnabled: !!s.IsEnabled,
      canBypass: !!s.CanBypass,
      requiresComment: !!s.RequiresComment,
      autoApprove: auto.get(s.Id)?.autoApprove ?? false,
      autoApproveMinConfidence: auto.get(s.Id)?.min ?? null,
      approvers: approvers.recordset
        .filter((a) => a.StageId === s.Id)
        .map((a) => ({
          id: a.Id,
          approverType: a.ApproverType,
          roleName: a.RoleName,
          groupId: a.GroupId,
          groupName: a.GroupName,
          userId: a.UserId,
          userName: a.UserName,
        })),
    }));
  }


  /** Auto-approve settings live in migration 014's columns; until it is applied they read as "off". */
  private async automationFor(workflowId: number): Promise<Map<number, { autoApprove: boolean; min: number | null }>> {
    const map = new Map<number, { autoApprove: boolean; min: number | null }>();
    try {
      const r = await this.db.query<{ Id: number; AutoApprove: boolean; AutoApproveMinConfidence: number | null }>(
        `SELECT Id, AutoApprove, AutoApproveMinConfidence FROM WorkflowStages WHERE WorkflowId = @id`,
        [{ name: 'id', type: sql.Int, value: workflowId }],
      );
      for (const row of r.recordset) {
        map.set(row.Id, { autoApprove: !!row.AutoApprove, min: row.AutoApproveMinConfidence == null ? null : Number(row.AutoApproveMinConfidence) });
      }
    } catch {
      // migration 014 not applied yet
    }
    return map;
  }

  private async saveAutomation(stageId: number, s: { autoApprove?: boolean; autoApproveMinConfidence?: number | null; stageType?: string }) {
    const on = !!s.autoApprove && s.stageType !== 'system';
    try {
      await this.db.query(`UPDATE WorkflowStages SET AutoApprove = @a, AutoApproveMinConfidence = @m WHERE Id = @id`, [
        { name: 'a', type: sql.Bit, value: on ? 1 : 0 },
        { name: 'm', type: sql.Decimal(4, 3), value: on ? (s.autoApproveMinConfidence ?? null) : null },
        { name: 'id', type: sql.Int, value: stageId },
      ]);
    } catch (e) {
      if (on) throw new BadRequestException('Auto-approve needs database migration 014. Apply it, then save again.');
    }
  }


  /** Where requests spend their time: per-stage turnaround, backlog and lateness over the last `days`. */
  async insights(days: number, fromDate?: string, toDate?: string) {
    const d = Math.min(Math.max(Math.floor(days) || 90, 1), 730);
    // A custom range (yyyy-mm-dd, inclusive) wins over `days`; the window is [from, to + 1 day).
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const from = fromDate && iso.test(fromDate) && !Number.isNaN(+new Date(fromDate)) ? new Date(`${fromDate}T00:00:00Z`) : null;
    const to = toDate && iso.test(toDate) && !Number.isNaN(+new Date(toDate)) ? new Date(`${toDate}T00:00:00Z`) : null;
    const start = from ?? new Date(Date.now() - d * 86_400_000);
    const end = new Date((to ?? new Date()).getTime() + (to ? 86_400_000 : 0));
    if (from && to && +from > +to) throw new BadRequestException('The start date must be on or before the end date.');
    const inputs = [{ name: 'from', type: sql.DateTime2, value: start }, { name: 'to', type: sql.DateTime2, value: to ? end : new Date(Date.now() + 86_400_000) }];
    const stages = await this.db.query(
      `SELECT ts.StageKey AS stageKey, MIN(ts.StageOrder) AS stageOrder, MAX(ts.StageName) AS name, MAX(ts.StageType) AS stageType,
              SUM(CASE WHEN ts.Status IN ('approved','bypassed','rejected') AND ts.CompletedAt IS NOT NULL THEN 1 ELSE 0 END) AS completed,
              AVG(CASE WHEN ts.Status IN ('approved','bypassed','rejected') AND ts.ActivatedAt IS NOT NULL AND ts.CompletedAt IS NOT NULL
                       THEN CAST(DATEDIFF(MINUTE, ts.ActivatedAt, ts.CompletedAt) AS FLOAT) END) / 60.0 AS avgHours,
              SUM(CASE WHEN ts.Status = 'active' THEN 1 ELSE 0 END) AS activeNow,
              SUM(CASE WHEN ts.Status = 'active' AND ts.DueAt < SYSUTCDATETIME() THEN 1 ELSE 0 END) AS overdueNow,
              SUM(CASE WHEN ts.CompletedAt IS NOT NULL AND ts.DueAt IS NOT NULL AND ts.CompletedAt > ts.DueAt THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN ts.Status = 'bypassed' THEN 1 ELSE 0 END) AS skipped
       FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
       WHERE t.ReceivedAt >= @from AND t.ReceivedAt < @to AND ts.StageType <> 'system'
       GROUP BY ts.StageKey ORDER BY MIN(ts.StageOrder)`,
      inputs,
    );
    const totals = await this.db.query(
      `SELECT COUNT(*) AS requests,
              SUM(CASE WHEN WorkflowStatus = 'active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN WorkflowStatus = 'approved' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN WorkflowStatus = 'rejected' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN WorkflowStatus = 'bypassed' THEN 1 ELSE 0 END) AS bypassed,
              AVG(CASE WHEN WorkflowStatus IN ('approved','bypassed') AND ProcessedAt IS NOT NULL
                       THEN CAST(DATEDIFF(MINUTE, ReceivedAt, ProcessedAt) AS FLOAT) END) / 1440.0 AS avgDaysToComplete
       FROM Transcripts WHERE WorkflowId IS NOT NULL AND ReceivedAt >= @from AND ReceivedAt < @to`,
      inputs,
    );
    let autoApproved = 0;
    try {
      const a = await this.db.query<{ N: number }>(
        `SELECT COUNT(*) AS N FROM TranscriptStages ts JOIN Transcripts t ON t.Id = ts.TranscriptId
         WHERE ts.AutoApproved = 1 AND t.ReceivedAt >= @from AND t.ReceivedAt < @to`,
        inputs,
      );
      autoApproved = a.recordset[0].N;
    } catch {
      // migration 014 not applied
    }
    const t = totals.recordset[0] ?? {};
    return {
      days: d,
      from: start.toISOString().slice(0, 10),
      to: new Date(+end - 86_400_000).toISOString().slice(0, 10),
      totals: {
        requests: t.requests ?? 0,
        active: t.active ?? 0,
        approved: t.approved ?? 0,
        rejected: t.rejected ?? 0,
        bypassed: t.bypassed ?? 0,
        autoApprovedStages: autoApproved,
        avgDaysToComplete: t.avgDaysToComplete == null ? null : Number(t.avgDaysToComplete),
      },
      stages: stages.recordset.map((s) => ({ ...s, avgHours: s.avgHours == null ? null : Number(s.avgHours) })),
    };
  }

  /** The university's own active workflow, else the global default. */
  async resolveForInstitution(institutionId: number | null): Promise<{ id: number; allowBypass: boolean } | null> {
    const res = await this.db.query<{ Id: number; AllowBypass: boolean }>(
      `SELECT TOP 1 Id, AllowBypass FROM WorkflowDefinitions
       WHERE IsActive = 1 AND (InstitutionId = @inst OR InstitutionId IS NULL)
       ORDER BY CASE WHEN InstitutionId IS NULL THEN 1 ELSE 0 END`,
      [{ name: 'inst', type: sql.Int, value: institutionId }],
    );
    const r = res.recordset[0];
    return r ? { id: r.Id, allowBypass: !!r.AllowBypass } : null;
  }

  async create(dto: CreateWorkflowDto) {
    const exists = await this.db.query(`SELECT Id FROM WorkflowDefinitions WHERE InstitutionId = @i`, [
      { name: 'i', type: sql.Int, value: dto.institutionId },
    ]);
    if (exists.recordset[0]) throw new BadRequestException('This university already has a workflow — edit it instead.');

    const sourceId =
      dto.copyFromWorkflowId ??
      (await this.db.query<{ Id: number }>(`SELECT Id FROM WorkflowDefinitions WHERE InstitutionId IS NULL`)).recordset[0]?.Id;
    const created = await this.db.query<{ Id: number }>(
      `INSERT INTO WorkflowDefinitions (InstitutionId, Name) OUTPUT inserted.Id VALUES (@i, @n)`,
      [
        { name: 'i', type: sql.Int, value: dto.institutionId },
        { name: 'n', type: sql.NVarChar(150), value: dto.name },
      ],
    );
    const newId = created.recordset[0].Id;
    const createdGroups: { id: number; name: string }[] = [];
    if (sourceId) {
      const src = await this.getStages(sourceId);
      // A university gets its OWN approver groups: every group on the copied stages is cloned for this university
      // (same purpose, no members yet), so the university's staff are added to its own groups and never to another's.
      const uni = (await this.db.query<{ Code: string }>(`SELECT Code FROM Institutions WHERE Id = @i`, [{ name: 'i', type: sql.Int, value: dto.institutionId }])).recordset[0];
      const groupMap = new Map<number, number>();
      const groupFor = async (groupId: number): Promise<number> => {
        if (groupMap.has(groupId)) return groupMap.get(groupId)!;
        const g = (await this.db.query<{ Name: string; Description: string | null; InstitutionId: number | null }>(
          `SELECT Name, Description, InstitutionId FROM ApproverGroups WHERE Id = @g`, [{ name: 'g', type: sql.Int, value: groupId }])).recordset[0];
        if (!g || g.InstitutionId === dto.institutionId) { groupMap.set(groupId, groupId); return groupId; }
        const base = g.Name.replace(/^[A-Z0-9]{2,20} - /, '');
        const name = `${uni?.Code ?? 'UNI'} - ${base}`.slice(0, 150);
        const existing = (await this.db.query<{ Id: number }>(`SELECT Id FROM ApproverGroups WHERE Name = @n`, [{ name: 'n', type: sql.NVarChar(150), value: name }])).recordset[0];
        let id = existing?.Id;
        if (!id) {
          id = (await this.db.query<{ Id: number }>(
            `INSERT INTO ApproverGroups (Name, Description, InstitutionId, IsActive) OUTPUT inserted.Id VALUES (@n, @d, @i, 1)`,
            [{ name: 'n', type: sql.NVarChar(150), value: name }, { name: 'd', type: sql.NVarChar(500), value: g.Description }, { name: 'i', type: sql.Int, value: dto.institutionId }],
          )).recordset[0].Id;
          createdGroups.push({ id, name });
        }
        groupMap.set(groupId, id);
        return id;
      };
      for (const s of src) {
        const st = await this.db.query<{ Id: number }>(
          `INSERT INTO WorkflowStages (WorkflowId, StageOrder, StageKey, Name, Description, StageType, AgentTask, SlaDays, IsEnabled, CanBypass, RequiresComment)
           OUTPUT inserted.Id VALUES (@w, @o, @k, @n, @d, @t, @a, @sla, @en, @cb, @rc)`,
          this.stageInputs(newId, s.stageOrder, s.stageKey, s),
        );
        for (const a of s.approvers) {
          const groupId = a.approverType === 'group' && a.groupId ? await groupFor(a.groupId) : a.groupId;
          await this.insertApprover(st.recordset[0].Id, { ...a, groupId });
        }
        if (s.autoApprove) await this.saveAutomation(st.recordset[0].Id, s);
      }
      await this.db.query(
        `INSERT INTO WorkflowRequiredDocs (WorkflowId, DocTypeKey, IsRequired)
         SELECT @n, DocTypeKey, IsRequired FROM WorkflowRequiredDocs WHERE WorkflowId = @s`,
        [
          { name: 'n', type: sql.Int, value: newId },
          { name: 's', type: sql.Int, value: sourceId },
        ],
      );
    }
    return { ...(await this.get(newId)), createdGroups };
  }

  private stageInputs(
    workflowId: number,
    order: number,
    key: string,
    s: { name: string; description?: string | null; stageType: string; agentTask: string; slaDays?: number | null; isEnabled: boolean; canBypass: boolean; requiresComment: boolean },
  ) {
    return [
      { name: 'w', type: sql.Int, value: workflowId },
      { name: 'o', type: sql.Int, value: order },
      { name: 'k', type: sql.VarChar(40), value: key },
      { name: 'n', type: sql.NVarChar(120), value: s.name },
      { name: 'd', type: sql.NVarChar(500), value: s.description ?? null },
      { name: 't', type: sql.VarChar(12), value: s.stageType },
      { name: 'a', type: sql.VarChar(12), value: s.agentTask },
      { name: 'sla', type: sql.Int, value: s.slaDays ?? null },
      { name: 'en', type: sql.Bit, value: s.isEnabled ? 1 : 0 },
      { name: 'cb', type: sql.Bit, value: s.canBypass ? 1 : 0 },
      { name: 'rc', type: sql.Bit, value: s.requiresComment ? 1 : 0 },
    ];
  }

  private async insertApprover(
    stageId: number,
    a: { approverType: string; roleName?: string | null; groupId?: number | null; userId?: string | null },
  ) {
    if (a.approverType === 'role' && !a.roleName) throw new BadRequestException('A role approver needs a role.');
    if (a.approverType === 'group' && !a.groupId) throw new BadRequestException('A group approver needs a group.');
    if (a.approverType === 'user' && !a.userId) throw new BadRequestException('A user approver needs a user.');
    await this.db.query(
      `INSERT INTO WorkflowStageApprovers (StageId, ApproverType, RoleName, GroupId, UserId) VALUES (@s, @t, @r, @g, @u)`,
      [
        { name: 's', type: sql.Int, value: stageId },
        { name: 't', type: sql.VarChar(8), value: a.approverType },
        { name: 'r', type: sql.VarChar(20), value: a.approverType === 'role' ? a.roleName : null },
        { name: 'g', type: sql.Int, value: a.approverType === 'group' ? a.groupId : null },
        { name: 'u', type: sql.UniqueIdentifier, value: a.approverType === 'user' ? a.userId : null },
      ],
    );
  }

  /**
   * Full save from the designer. Stages are matched by id so in-flight
   * requests keep pointing at the same stage; stages missing from the
   * payload are deleted (their per-request history is kept, see
   * TranscriptStages.WorkflowStageId ON DELETE SET NULL).
   */
  async save(id: number, dto: SaveWorkflowDto) {
    await this.get(id);
    if (!dto.stages.some((s) => s.isEnabled)) throw new BadRequestException('Enable at least one stage.');
    await this.db.query(
      `UPDATE WorkflowDefinitions SET Name=@n, Description=@d, AllowBypass=@b, IsActive=@a, UpdatedAt=SYSUTCDATETIME() WHERE Id=@id`,
      [
        { name: 'n', type: sql.NVarChar(150), value: dto.name },
        { name: 'd', type: sql.NVarChar(500), value: dto.description ?? null },
        { name: 'b', type: sql.Bit, value: dto.allowBypass ? 1 : 0 },
        { name: 'a', type: sql.Bit, value: dto.isActive ? 1 : 0 },
        { name: 'id', type: sql.Int, value: id },
      ],
    );

    const existing = await this.db.query<{ Id: number; StageKey: string }>(
      `SELECT Id, StageKey FROM WorkflowStages WHERE WorkflowId = @id`,
      [{ name: 'id', type: sql.Int, value: id }],
    );
    const existingById = new Map(existing.recordset.map((r) => [r.Id, r.StageKey]));
    const usedKeys = new Set(existing.recordset.map((r) => r.StageKey));
    const keptIds: number[] = [];

    for (let i = 0; i < dto.stages.length; i++) {
      const s = dto.stages[i];
      let stageId: number;
      if (s.id && existingById.has(s.id)) {
        stageId = s.id;
        await this.db.query(
          `UPDATE WorkflowStages SET StageOrder=@o, Name=@n, Description=@d, StageType=@t, AgentTask=@a, SlaDays=@sla,
             IsEnabled=@en, CanBypass=@cb, RequiresComment=@rc WHERE Id = ${stageId}`,
          this.stageInputs(id, i + 1, existingById.get(s.id)!, s),
        );
      } else {
        let key = slug(s.name);
        for (let n = 2; usedKeys.has(key); n++) key = `${slug(s.name).slice(0, 32)}_${n}`;
        usedKeys.add(key);
        const ins = await this.db.query<{ Id: number }>(
          `INSERT INTO WorkflowStages (WorkflowId, StageOrder, StageKey, Name, Description, StageType, AgentTask, SlaDays, IsEnabled, CanBypass, RequiresComment)
           OUTPUT inserted.Id VALUES (@w, @o, @k, @n, @d, @t, @a, @sla, @en, @cb, @rc)`,
          this.stageInputs(id, i + 1, key, s),
        );
        stageId = ins.recordset[0].Id;
      }
      keptIds.push(stageId);
      await this.saveAutomation(stageId, s);
      await this.db.query(`DELETE FROM WorkflowStageApprovers WHERE StageId = @s`, [{ name: 's', type: sql.Int, value: stageId }]);
      for (const a of s.approvers) await this.insertApprover(stageId, a);
    }

    for (const r of existing.recordset) {
      if (!keptIds.includes(r.Id)) {
        await this.db.query(`DELETE FROM WorkflowStages WHERE Id = @s`, [{ name: 's', type: sql.Int, value: r.Id }]);
      }
    }

    if (dto.requiredDocs) {
      await this.db.query(`DELETE FROM WorkflowRequiredDocs WHERE WorkflowId = @id`, [{ name: 'id', type: sql.Int, value: id }]);
      for (const d of dto.requiredDocs) {
        await this.db.query(
          `INSERT INTO WorkflowRequiredDocs (WorkflowId, DocTypeKey, IsRequired) VALUES (@w, @k, @r)`,
          [
            { name: 'w', type: sql.Int, value: id },
            { name: 'k', type: sql.VarChar(40), value: d.docTypeKey },
            { name: 'r', type: sql.Bit, value: d.isRequired ? 1 : 0 },
          ],
        );
      }
    }
    return this.get(id);
  }

  /** The global default can't be deleted; a university workflow with history is deactivated instead. */
  async remove(id: number) {
    const wf = await this.get(id);
    if (wf.institutionId == null) throw new BadRequestException('The global default workflow cannot be deleted.');
    const used = await this.db.query(`SELECT TOP 1 1 AS x FROM Transcripts WHERE WorkflowId = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    if (used.recordset[0]) {
      await this.db.query(`UPDATE WorkflowDefinitions SET IsActive = 0 WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
      return { message: 'Workflow has request history, so it was deactivated instead of deleted.' };
    }
    await this.db.query(`DELETE FROM WorkflowDefinitions WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    return { message: 'Workflow deleted' };
  }

  // ── approver resolution ─────────────────────────────────────

  /** Everyone who can act on a workflow stage: its role, group and named-user approvers. */
  async resolveApprovers(workflowStageId: number | null): Promise<StaffUser[]> {
    if (!workflowStageId) return [];
    const res = await this.db.query<{ Id: string; Email: string; Name: string; Role: string }>(
      `SELECT DISTINCT u.Id, u.Email, u.FirstName + ' ' + u.LastName AS Name, r.Name AS Role
       FROM Users u JOIN Roles r ON r.Id = u.RoleId
       WHERE u.IsActive = 1 AND (
         EXISTS (SELECT 1 FROM WorkflowStageApprovers a WHERE a.StageId = @s AND a.ApproverType = 'role' AND a.RoleName = r.Name)
         OR EXISTS (SELECT 1 FROM WorkflowStageApprovers a JOIN ApproverGroupMembers m ON m.GroupId = a.GroupId
                    JOIN ApproverGroups g ON g.Id = a.GroupId AND g.IsActive = 1
                    WHERE a.StageId = @s AND a.ApproverType = 'group' AND m.UserId = u.Id)
         OR EXISTS (SELECT 1 FROM WorkflowStageApprovers a WHERE a.StageId = @s AND a.ApproverType = 'user' AND a.UserId = u.Id))`,
      [{ name: 's', type: sql.Int, value: workflowStageId }],
    );
    return res.recordset.map((r) => ({ id: r.Id, email: r.Email, name: r.Name, role: r.Role }));
  }

  async isApprover(userId: string, workflowStageId: number | null): Promise<boolean> {
    return (await this.resolveApprovers(workflowStageId)).some((u) => String(u.id).toLowerCase() === userId.toLowerCase());
  }

  async admins(): Promise<StaffUser[]> {
    const res = await this.db.query<{ Id: string; Email: string; Name: string; Role: string }>(
      `SELECT u.Id, u.Email, u.FirstName + ' ' + u.LastName AS Name, r.Name AS Role
       FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE u.IsActive = 1 AND r.Name IN ('admin','super_admin')`,
    );
    return res.recordset.map((r) => ({ id: r.Id, email: r.Email, name: r.Name, role: r.Role }));
  }

  /** Staff to pick as approvers. Super admins are not shown to (or pickable by) plain admins. */
  async staffUsers(viewerRole?: string): Promise<StaffUser[]> {
    const roles = viewerRole === 'admin' ? `'faculty','admin'` : `'faculty','admin','super_admin'`;
    const res = await this.db.query<{ Id: string; Email: string; Name: string; Role: string }>(
      `SELECT u.Id, u.Email, u.FirstName + ' ' + u.LastName AS Name, r.Name AS Role
       FROM Users u JOIN Roles r ON r.Id = u.RoleId
       WHERE u.IsActive = 1 AND r.Name IN (${roles}) ORDER BY u.FirstName, u.LastName`,
    );
    return res.recordset.map((r) => ({ id: r.Id, email: r.Email, name: r.Name, role: r.Role }));
  }

  documentTypes() {
    return this.db.query(`SELECT DocTypeKey AS docTypeKey, Label AS label, Description AS description, PerCourse AS perCourse FROM DocumentTypes ORDER BY SortOrder`).then((r) => r.recordset);
  }

  // ── approver groups ─────────────────────────────────────────

  async listGroups(viewerRole?: string) {
    const groups = await this.db.query(
      `SELECT g.Id AS id, g.Name AS name, g.Description AS description, g.InstitutionId AS institutionId, g.IsActive AS isActive
       FROM ApproverGroups g ORDER BY g.Name`,
    );
    const members = await this.db.query(
      `SELECT m.GroupId, u.Id AS userId, u.FirstName + ' ' + u.LastName AS name, u.Email AS email
       FROM ApproverGroupMembers m JOIN Users u ON u.Id = m.UserId JOIN Roles r ON r.Id = u.RoleId
       ${viewerRole === 'admin' ? `WHERE r.Name <> 'super_admin'` : ''} ORDER BY u.FirstName`,
    );
    return groups.recordset.map((g) => ({
      ...g,
      members: members.recordset.filter((m) => m.GroupId === g.id).map((m) => ({ userId: m.userId, name: m.name, email: m.email })),
    }));
  }

  async saveGroup(id: number | null, dto: SaveGroupDto, viewerRole?: string) {
    let groupId = id;
    const inputs = [
      { name: 'n', type: sql.NVarChar(150), value: dto.name },
      { name: 'd', type: sql.NVarChar(500), value: dto.description ?? null },
      { name: 'i', type: sql.Int, value: dto.institutionId ?? null },
      { name: 'a', type: sql.Bit, value: dto.isActive ? 1 : 0 },
    ];
    if (groupId) {
      const upd = await this.db.query(
        `UPDATE ApproverGroups SET Name=@n, Description=@d, InstitutionId=@i, IsActive=@a WHERE Id = ${Number(groupId)}`,
        inputs,
      );
      if (!upd.rowsAffected[0]) throw new NotFoundException('Group not found');
    } else {
      const ins = await this.db.query<{ Id: number }>(
        `INSERT INTO ApproverGroups (Name, Description, InstitutionId, IsActive) OUTPUT inserted.Id VALUES (@n, @d, @i, @a)`,
        inputs,
      );
      groupId = ins.recordset[0].Id;
    }
    // Plain admins cannot see super admins, so their save must neither remove nor add them.
    const hidden = viewerRole === 'admin';
    await this.db.query(
      `DELETE m FROM ApproverGroupMembers m JOIN Users u ON u.Id = m.UserId JOIN Roles r ON r.Id = u.RoleId
       WHERE m.GroupId = ${Number(groupId)}${hidden ? ` AND r.Name <> 'super_admin'` : ''}`,
    );
    let memberIds = dto.memberUserIds;
    if (hidden && memberIds.length) {
      const supers = await this.db.query<{ Id: string }>(`SELECT u.Id FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE r.Name = 'super_admin'`);
      const blocked = new Set(supers.recordset.map((r) => String(r.Id).toLowerCase()));
      memberIds = memberIds.filter((u) => !blocked.has(String(u).toLowerCase()));
    }
    for (const uid of memberIds) {
      await this.db.query(`INSERT INTO ApproverGroupMembers (GroupId, UserId) VALUES (${Number(groupId)}, @u)`, [
        { name: 'u', type: sql.UniqueIdentifier, value: uid },
      ]);
    }
    return (await this.listGroups(viewerRole)).find((g) => g.id === groupId);
  }

  async removeGroup(id: number) {
    const used = await this.db.query(`SELECT TOP 1 1 AS x FROM WorkflowStageApprovers WHERE GroupId = @id`, [
      { name: 'id', type: sql.Int, value: id },
    ]);
    if (used.recordset[0]) {
      await this.db.query(`UPDATE ApproverGroups SET IsActive = 0 WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
      return { message: 'Group is used by a workflow stage, so it was deactivated instead of deleted.' };
    }
    await this.db.query(`DELETE FROM ApproverGroups WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
    return { message: 'Group deleted' };
  }
}
