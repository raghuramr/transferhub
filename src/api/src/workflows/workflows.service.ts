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
    if (sourceId) {
      const src = await this.getStages(sourceId);
      for (const s of src) {
        const st = await this.db.query<{ Id: number }>(
          `INSERT INTO WorkflowStages (WorkflowId, StageOrder, StageKey, Name, Description, StageType, AgentTask, SlaDays, IsEnabled, CanBypass, RequiresComment)
           OUTPUT inserted.Id VALUES (@w, @o, @k, @n, @d, @t, @a, @sla, @en, @cb, @rc)`,
          this.stageInputs(newId, s.stageOrder, s.stageKey, s),
        );
        for (const a of s.approvers) await this.insertApprover(st.recordset[0].Id, a);
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
    return this.get(newId);
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

  async staffUsers(): Promise<StaffUser[]> {
    const res = await this.db.query<{ Id: string; Email: string; Name: string; Role: string }>(
      `SELECT u.Id, u.Email, u.FirstName + ' ' + u.LastName AS Name, r.Name AS Role
       FROM Users u JOIN Roles r ON r.Id = u.RoleId
       WHERE u.IsActive = 1 AND r.Name IN ('faculty','admin','super_admin') ORDER BY u.FirstName, u.LastName`,
    );
    return res.recordset.map((r) => ({ id: r.Id, email: r.Email, name: r.Name, role: r.Role }));
  }

  documentTypes() {
    return this.db.query(`SELECT DocTypeKey AS docTypeKey, Label AS label, Description AS description, PerCourse AS perCourse FROM DocumentTypes ORDER BY SortOrder`).then((r) => r.recordset);
  }

  // ── approver groups ─────────────────────────────────────────

  async listGroups() {
    const groups = await this.db.query(
      `SELECT g.Id AS id, g.Name AS name, g.Description AS description, g.InstitutionId AS institutionId, g.IsActive AS isActive
       FROM ApproverGroups g ORDER BY g.Name`,
    );
    const members = await this.db.query(
      `SELECT m.GroupId, u.Id AS userId, u.FirstName + ' ' + u.LastName AS name, u.Email AS email
       FROM ApproverGroupMembers m JOIN Users u ON u.Id = m.UserId ORDER BY u.FirstName`,
    );
    return groups.recordset.map((g) => ({
      ...g,
      members: members.recordset.filter((m) => m.GroupId === g.id).map((m) => ({ userId: m.userId, name: m.name, email: m.email })),
    }));
  }

  async saveGroup(id: number | null, dto: SaveGroupDto) {
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
    await this.db.query(`DELETE FROM ApproverGroupMembers WHERE GroupId = ${Number(groupId)}`);
    for (const uid of dto.memberUserIds) {
      await this.db.query(`INSERT INTO ApproverGroupMembers (GroupId, UserId) VALUES (${Number(groupId)}, @u)`, [
        { name: 'u', type: sql.UniqueIdentifier, value: uid },
      ]);
    }
    return (await this.listGroups()).find((g) => g.id === groupId);
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
