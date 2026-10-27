import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';

export type PurgeEntity = 'universities' | 'programs' | 'courses' | 'topics';
export const PURGE_ENTITIES: PurgeEntity[] = ['universities', 'programs', 'courses', 'topics'];

export interface PurgeLine { label: string; count: number; hint?: string }
export interface PurgeImpact {
  entity: PurgeEntity;
  id: number;
  label: string;
  canDelete: boolean;
  willDelete: PurgeLine[];
  willDetach: PurgeLine[];
  blockers: PurgeLine[];
}

/** One kind of row that points at the thing being deleted. */
interface Ref {
  label: string;
  table: string;
  /** Every column the WHERE clause mentions (used to skip refs on databases where a migration is not applied). */
  cols: string[];
  where: string;
  /** block = refuse while rows exist; delete = remove them with it; nullify = keep them but clear `setCol`. */
  mode: 'block' | 'delete' | 'nullify';
  setCol?: string;
  hint?: string;
}

interface Plan {
  refs: Ref[];
  /** Extra preconditions that are not simple row counts. */
  extraBlockers: PurgeLine[];
  /** Rows of the entities themselves that will be removed, in dependency order (children first). */
  removals: { label: string; table: string; where: string }[];
}

/**
 * Super-admin permanent delete for universities, programs, courses and topics.
 *
 * Safe by construction: the delete is refused while real history points at the data (transcripts,
 * evaluations, equivalency mappings, appeals, ...), derived/link rows go with it, and informational
 * links are detached. The same rule table drives the preview and the delete, in one transaction.
 */
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(private db: DatabaseService, private schema: SchemaService) {}

  // ── rule tables ──────────────────────────────────────────

  /** Rows that reference courses selected by `sel` (a SELECT of course ids). */
  private courseRefs(sel: string): Ref[] {
    const inSel = (c: string) => `${c} IN (${sel})`;
    return [
      { label: 'equivalency mappings', table: 'Equivalencies', cols: ['ExternalCourseId', 'BUCourseId'], mode: 'block',
        where: `${inSel('ExternalCourseId')} OR ${inSel('BUCourseId')}`, hint: 'Remove or end-date them under Equivalencies first.' },
      { label: 'courses on student transcript requests', table: 'TranscriptCourses', cols: ['ExternalCourseId'], mode: 'block',
        where: inSel('ExternalCourseId'), hint: 'Students have submitted these courses. Deactivate instead.' },
      { label: 'evaluations', table: 'Evaluations', cols: ['AISuggestedCourseId', 'DecidedBUCourseId'], mode: 'block',
        where: `${inSel('AISuggestedCourseId')} OR ${inSel('DecidedBUCourseId')}`, hint: 'Decisions were recorded against these courses.' },
      { label: 'appeals', table: 'CourseAppeals', cols: ['ProposedBUCourseId', 'DecidedBUCourseId'], mode: 'block',
        where: `${inSel('ProposedBUCourseId')} OR ${inSel('DecidedBUCourseId')}` },
      { label: 'multi-course decisions', table: 'EvaluationCourseMappings', cols: ['BUCourseId'], mode: 'block', where: inSel('BUCourseId') },
      { label: 'AI match suggestions', table: 'AIMatchCandidates', cols: ['BUCourseId'], mode: 'delete', where: inSel('BUCourseId') },
      { label: 'verification requests', table: 'CourseVerificationRequests', cols: ['CourseId'], mode: 'delete', where: inSel('CourseId') },
      { label: 'program links', table: 'ProgramCourses', cols: ['CourseId'], mode: 'delete', where: inSel('CourseId') },
      { label: 'topics', table: 'CourseTopics', cols: ['CourseId'], mode: 'delete', where: inSel('CourseId') },
    ];
  }

  /** Rows that reference programs selected by `sel`. */
  private programRefs(sel: string): Ref[] {
    const inSel = (c: string) => `${c} IN (${sel})`;
    return [
      { label: 'programme rules', table: 'ProgramRules', cols: ['ProgramId'], mode: 'block', where: inSel('ProgramId'),
        hint: 'Delete the rules under Workflows > Programme rules first.' },
      { label: 'courses that listed it as their primary program', table: 'Courses', cols: ['ProgramId'], mode: 'nullify', setCol: 'ProgramId', where: inSel('ProgramId') },
      { label: 'student profiles that targeted it', table: 'StudentProfiles', cols: ['TargetProgramId'], mode: 'nullify', setCol: 'TargetProgramId', where: inSel('TargetProgramId') },
      { label: 'program-course links', table: 'ProgramCourses', cols: ['ProgramId'], mode: 'delete', where: inSel('ProgramId') },
      { label: 'program-university links', table: 'ProgramUniversities', cols: ['ProgramId'], mode: 'delete', where: inSel('ProgramId') },
    ];
  }

  private async plan(entity: PurgeEntity, cascade: boolean, id: number): Promise<Plan> {
    switch (entity) {
      case 'topics':
        return {
          refs: [{ label: 'per-university topic switches', table: 'UniversityTopicStatus', cols: ['TopicId'], mode: 'delete', where: 'TopicId = @id' }],
          extraBlockers: [],
          removals: [{ label: 'topics', table: 'CourseTopics', where: 'Id = @id' }],
        };
      case 'courses':
        return {
          refs: this.courseRefs('SELECT @id'),
          extraBlockers: [],
          removals: [{ label: 'courses', table: 'Courses', where: 'Id = @id' }],
        };
      case 'programs':
        return {
          refs: this.programRefs('SELECT @id'),
          extraBlockers: [],
          removals: [{ label: 'programs', table: 'Programs', where: 'Id = @id' }],
        };
      case 'universities': {
        const inst = 'InstitutionId = @id';
        const refs: Ref[] = [
          { label: 'transcript requests', table: 'Transcripts', cols: ['InstitutionId', 'TargetInstitutionId'], mode: 'block',
            where: 'InstitutionId = @id OR TargetInstitutionId = @id', hint: 'Students have requests from or to this university. Deactivate instead.' },
          { label: 'students who chose it as their target', table: 'StudentProfiles', cols: ['TargetInstitutionId'], mode: 'block',
            where: 'TargetInstitutionId = @id', hint: 'Ask the students to pick another target, or deactivate.' },
          { label: 'student education history rows', table: 'StudentEducation', cols: ['InstitutionId'], mode: 'block', where: inst },
          { label: 'document requests between universities', table: 'DocumentRequests', cols: ['RequestedByInstitutionId', 'RequestedFromInstitutionId'], mode: 'block',
            where: 'RequestedByInstitutionId = @id OR RequestedFromInstitutionId = @id' },
          { label: 'approver groups', table: 'ApproverGroups', cols: ['InstitutionId'], mode: 'block', where: inst, hint: 'Remove them under Workflows first.' },
          { label: 'workflows', table: 'WorkflowDefinitions', cols: ['InstitutionId'], mode: 'block', where: inst, hint: 'Remove them under Workflows first.' },
          { label: 'AI settings overrides', table: 'AiSettings', cols: ['InstitutionId'], mode: 'block', where: inst, hint: 'Remove the override in AI Controls first.' },
          { label: 'transfer rules', table: 'TransferPolicies', cols: ['InstitutionId'], mode: 'block', where: inst, hint: 'Configured under Workflows > Transfer rules.' },
          { label: 'programme rules', table: 'ProgramRules', cols: ['InstitutionId'], mode: 'block', where: inst },
          { label: 'exam credit rules', table: 'ExamCreditRules', cols: ['InstitutionId'], mode: 'block', where: inst },
          { label: 'institutions (schools) that become unmapped', table: 'AcademicUnits', cols: ['InstitutionId'], mode: 'nullify', setCol: 'InstitutionId', where: inst },
          { label: 'user visibility scopes', table: 'UserScopeUniversities', cols: ['InstitutionId'], mode: 'delete', where: inst },
          { label: 'program-university links', table: 'ProgramUniversities', cols: ['InstitutionId'], mode: 'delete', where: inst },
          { label: 'per-university topic switches', table: 'UniversityTopicStatus', cols: ['InstitutionId'], mode: 'delete', where: inst },
        ];
        const extra: PurgeLine[] = [];
        const removals: Plan['removals'] = [];

        const owned = {
          programs: await this.countFor('Programs', ['InstitutionId'], inst, id),
          courses: await this.countFor('Courses', ['InstitutionId'], inst, id),
        };
        if (cascade) {
          const progSel = 'SELECT Id FROM Programs WHERE InstitutionId = @id';
          const courseSel = 'SELECT Id FROM Courses WHERE InstitutionId = @id';
          refs.push(...this.courseRefs(courseSel), ...this.programRefs(progSel));
          // Programs this university owns but other universities also offer must not vanish from under them.
          if (await this.schema.has('ProgramUniversities', 'ProgramId')) {
            const shared = await this.countFor('ProgramUniversities', ['ProgramId', 'InstitutionId'], `ProgramId IN (${progSel}) AND InstitutionId <> @id`, id);
            if (shared) extra.push({ label: 'program offerings at other universities', count: shared, hint: 'A program it owns is also offered elsewhere. Remove those links or change the owner first.' });
          }
          removals.push(
            { label: 'courses', table: 'Courses', where: inst },
            { label: 'programs', table: 'Programs', where: inst },
          );
        } else if (owned.programs || owned.courses) {
          extra.push({
            label: `${owned.programs} program(s) and ${owned.courses} course(s) belong to it`,
            count: owned.programs + owned.courses,
            hint: 'Tick "also delete its programs, courses and topics" to remove them together.',
          });
        }
        removals.push({ label: 'universities', table: 'Institutions', where: 'Id = @id' });
        return { refs, extraBlockers: extra, removals };
      }
      default:
        throw new BadRequestException('Unknown entity');
    }
  }

  // ── helpers ──────────────────────────────────────────────

  /** COUNT of rows matching `where`, with @id bound. Returns 0 when the table or a column does not exist yet. */
  private async countFor(table: string, cols: string[], where: string, id: number): Promise<number> {
    for (const c of cols) if (!(await this.schema.has(table, c))) return 0;
    const r = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM ${table} WHERE ${where}`, [{ name: 'id', type: sql.Int, value: id }]);
    return Number(r.recordset[0]?.N ?? 0);
  }

  private async labelOf(entity: PurgeEntity, id: number): Promise<string> {
    const q: Record<PurgeEntity, string> = {
      universities: `SELECT Code + ' - ' + Name AS L, IsBU FROM Institutions WHERE Id = @id`,
      programs: `SELECT Name + ISNULL(' (' + Degree + ')', '') AS L, CAST(0 AS BIT) AS IsBU FROM Programs WHERE Id = @id`,
      courses: `SELECT Code + ' - ' + Title AS L, CAST(0 AS BIT) AS IsBU FROM Courses WHERE Id = @id`,
      topics: `SELECT Title AS L, CAST(0 AS BIT) AS IsBU FROM CourseTopics WHERE Id = @id`,
    };
    const r = await this.db.query<{ L: string }>(q[entity], [{ name: 'id', type: sql.Int, value: id }]);
    if (!r.recordset[0]) throw new NotFoundException('Not found');
    return r.recordset[0].L;
  }

  // ── public API ───────────────────────────────────────────

  async impact(entity: PurgeEntity, id: number, cascade = false): Promise<PurgeImpact> {
    this.assertEntity(entity);
    const label = await this.labelOf(entity, id);
    const plan = await this.plan(entity, cascade && entity === 'universities', id);

    const willDelete: PurgeLine[] = [];
    const willDetach: PurgeLine[] = [];
    const blockers: PurgeLine[] = [...plan.extraBlockers];

    if (entity === 'universities') {
      const r = await this.db.query<{ IsBU: boolean }>(`SELECT IsBU FROM Institutions WHERE Id = @id`, [{ name: 'id', type: sql.Int, value: id }]);
      if (r.recordset[0]?.IsBU) blockers.push({ label: 'this is the home (BU) university', count: 1, hint: 'It cannot be deleted.' });
    }

    for (const ref of plan.refs) {
      const n = await this.countFor(ref.table, ref.cols, ref.where, id);
      if (!n) continue;
      const line: PurgeLine = { label: ref.label, count: n, ...(ref.hint ? { hint: ref.hint } : {}) };
      if (ref.mode === 'block') blockers.push(line);
      else if (ref.mode === 'delete') willDelete.push(line);
      else willDetach.push(line);
    }
    for (const rm of plan.removals) {
      const n = await this.countFor(rm.table, ['Id'], rm.where, id);
      // The thing itself is always listed first, children after it.
      willDelete.unshift({ label: rm.label, count: n });
    }
    // Put the headline item(s) first in a stable order: university/program/course/topic rows, then children.
    willDelete.sort((a, b) => Number(isHeadline(b.label)) - Number(isHeadline(a.label)));
    return { entity, id, label, canDelete: blockers.length === 0, willDelete, willDetach, blockers };
  }

  async remove(entity: PurgeEntity, id: number, cascade: boolean, by: { id: string; email: string; role: string }, ip?: string) {
    const preview = await this.impact(entity, id, cascade);
    if (!preview.canDelete) {
      throw new ConflictException(
        `Cannot delete "${preview.label}": ${preview.blockers.map((b) => `${b.count} ${b.label}`).join('; ')}. Deactivate it instead, or remove those first.`,
      );
    }
    const plan = await this.plan(entity, cascade && entity === 'universities', id);
    const deleted: PurgeLine[] = [];

    try {
      await this.db.transaction(async (run) => {
        const bind = [{ name: 'id', type: sql.Int, value: id }];
        // 1) detach informational links
        for (const ref of plan.refs.filter((r) => r.mode === 'nullify')) {
          if (!(await this.hasCols(ref.table, ref.cols))) continue;
          await run(`UPDATE ${ref.table} SET ${ref.setCol} = NULL WHERE ${ref.where}`, bind);
        }
        // 2) delete link / derived rows
        for (const ref of plan.refs.filter((r) => r.mode === 'delete')) {
          if (!(await this.hasCols(ref.table, ref.cols))) continue;
          const r = await run(`DELETE FROM ${ref.table} WHERE ${ref.where}`, bind);
          const n = r.rowsAffected.reduce((a, b) => a + b, 0);
          if (n) deleted.push({ label: ref.label, count: n });
        }
        // 3) the entities themselves, children first
        for (const rm of plan.removals) {
          const r = await run(`DELETE FROM ${rm.table} WHERE ${rm.where}`, bind);
          deleted.unshift({ label: rm.label, count: r.rowsAffected.reduce((a, b) => a + b, 0) });
        }
      });
    } catch (err) {
      const e = err as { number?: number; message?: string };
      if (e.number === 547) {
        // A foreign key we did not know about still points at this data: nothing was deleted (rolled back).
        this.logger.warn(`Purge of ${entity}/${id} blocked by a foreign key: ${e.message}`);
        throw new ConflictException(`Cannot delete "${preview.label}": other records still reference it. Deactivate it instead. (${(e.message ?? '').slice(0, 160)})`);
      }
      throw err;
    }

    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, OldValue, NewValue, IpAddress)
         VALUES (@uid, @email, @role, 'DATA_PURGED', @et, @eid, @old, @new, @ip)`,
        [
          { name: 'uid', type: sql.UniqueIdentifier, value: by.id },
          { name: 'email', type: sql.NVarChar(254), value: by.email },
          { name: 'role', type: sql.VarChar(20), value: by.role },
          { name: 'et', type: sql.NVarChar(50), value: entity },
          { name: 'eid', type: sql.NVarChar(100), value: String(id) },
          { name: 'old', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ label: preview.label, cascade }) },
          { name: 'new', type: sql.NVarChar(sql.MAX), value: JSON.stringify({ deleted, detached: preview.willDetach }) },
          { name: 'ip', type: sql.NVarChar(45), value: ip ? ip.slice(0, 45) : null },
        ],
      );
    } catch {
      // auditing must never undo the delete
    }
    return { ok: true, deleted };
  }

  private async hasCols(table: string, cols: string[]) {
    for (const c of cols) if (!(await this.schema.has(table, c))) return false;
    return true;
  }

  private assertEntity(e: string): asserts e is PurgeEntity {
    if (!PURGE_ENTITIES.includes(e as PurgeEntity)) throw new BadRequestException('Unknown entity');
  }
}

const isHeadline = (label: string) => ['universities', 'programs', 'courses', 'topics'].includes(label);
