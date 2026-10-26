import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { UploadsService } from '../uploads/uploads.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { SchemaService } from '../policy/schema.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { RequestsService, type Viewer } from './requests.service';
import type { CreateAppealDto, DecideAppealDto } from './dto/appeals.dto';

const STAFF = ['faculty', 'admin', 'super_admin'];
const DECIDED_LANES = new Set(['applied', 'not_eligible', 'elective_only']);

/**
 * Per-course appeals, modelled on BU's Transfer Credit Appeal Form: the student proposes a BU
 * equivalent with a mandatory reason and the syllabus; a department decides equivalent / elective /
 * no credit / denied, names the requirement it satisfies, and signs. Coursework from outside the US
 * is excluded (handled by International Admissions).
 */
@Injectable()
export class AppealsService {
  private readonly logger = new Logger(AppealsService.name);

  constructor(
    private db: DatabaseService,
    private email: EmailService,
    private uploads: UploadsService,
    private workflows: WorkflowsService,
    private schema: SchemaService,
    private engine: WorkflowEngineService,
    private requests: RequestsService,
  ) {}

  private async ready() {
    if (!(await this.schema.policyReady())) throw new BadRequestException('Appeals need database migration 015, which is not applied yet.');
  }

  async create(transcriptId: string, courseId: string, viewer: Viewer, dto: CreateAppealDto) {
    await this.ready();
    if (viewer.role !== 'student' && viewer.role !== 'agency') throw new ForbiddenException('Appeals are submitted by the student.');
    const owner = await this.requests.assertCanView(transcriptId, viewer);

    const c = await this.db.query<{
      CourseCode: string; CourseTitle: string; Lane: string; IsOutsideUS: boolean; EvalStatus: string | null; EvaluationKind: string;
    }>(
      `SELECT tc.CourseCode, tc.CourseTitle, tc.Lane, tc.IsOutsideUS, e.Status AS EvalStatus, t.EvaluationKind
       FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId
       LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
       WHERE tc.Id = @c AND tc.TranscriptId = @t`,
      [
        { name: 'c', type: sql.UniqueIdentifier, value: courseId },
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
      ],
    );
    const course = c.recordset[0];
    if (!course) throw new NotFoundException('Course not found on this request');
    if (course.EvaluationKind === 'preview') throw new BadRequestException('Appeals open once your official evaluation is done (after admission).');
    if (course.IsOutsideUS) {
      throw new BadRequestException('Coursework completed outside the US is appealed through the Office of International Undergraduate Admissions (intadvis@bu.edu).');
    }
    const decided = DECIDED_LANES.has(course.Lane) || course.EvalStatus === 'decided' || course.EvalStatus === 'posted';
    if (!decided) throw new BadRequestException('This course has not been decided yet, so there is nothing to appeal.');
    const open = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM CourseAppeals WHERE TranscriptCourseId = @c AND Status = 'submitted'`, [
      { name: 'c', type: sql.UniqueIdentifier, value: courseId },
    ]);
    if (open.recordset[0].N > 0) throw new BadRequestException('There is already an open appeal for this course.');

    if (dto.proposedBUCourseId) {
      const p = await this.db.query<{ Id: number }>(`SELECT Id FROM Courses WHERE Id = @i`, [{ name: 'i', type: sql.Int, value: dto.proposedBUCourseId }]);
      if (!p.recordset[0]) throw new BadRequestException('Proposed BU course not found');
    }
    if (!dto.proposedBUCourseId && !dto.proposedEquivalent?.trim()) {
      throw new BadRequestException('Say which BU course you think this is equivalent to.');
    }
    if (dto.syllabusUploadId) await this.uploads.getForAuthenticatedUser(dto.syllabusUploadId, { id: viewer.id, role: viewer.role });

    const ins = await this.db.query<{ Id: number }>(
      `INSERT INTO CourseAppeals (TranscriptCourseId, TranscriptId, StudentUserId, SubmittedByUserId, ProposedBUCourseId, ProposedEquivalent, Reason, SyllabusUploadId)
       OUTPUT inserted.Id
       VALUES (@c, @t, @s, @by, @p, @pe, @r, @up)`,
      [
        { name: 'c', type: sql.UniqueIdentifier, value: courseId },
        { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
        { name: 's', type: sql.UniqueIdentifier, value: owner.StudentUserId },
        { name: 'by', type: sql.UniqueIdentifier, value: viewer.id },
        { name: 'p', type: sql.Int, value: dto.proposedBUCourseId ?? null },
        { name: 'pe', type: sql.NVarChar(200), value: dto.proposedEquivalent?.trim() || null },
        { name: 'r', type: sql.NVarChar(sql.MAX), value: dto.reason.trim() },
        { name: 'up', type: sql.UniqueIdentifier, value: dto.syllabusUploadId ?? null },
      ],
    );
    await this.engine.addNote(transcriptId, null, 'student', 'system', null, null,
      `Appeal submitted for ${course.CourseCode}. The department reviews it and you will be notified of the decision.`);
    void this.notifyStaff(course.CourseCode, course.CourseTitle).catch((e) => this.logger.warn(`Appeal email failed: ${(e as Error).message}`));
    return { id: ins.recordset[0].Id, message: 'Appeal submitted' };
  }

  private async notifyStaff(code: string, title: string) {
    const people = new Map<string, { email: string; name: string }>();
    for (const p of await this.workflows.admins()) people.set(p.email.toLowerCase(), p);
    const fac = await this.db.query<{ Email: string; Name: string }>(
      `SELECT u.Email, u.FirstName + ' ' + u.LastName AS Name
       FROM ApproverGroupMembers m JOIN ApproverGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.Name = 'Faculty Reviewers'
       JOIN Users u ON u.Id = m.UserId AND u.IsActive = 1`,
    ).catch(() => ({ recordset: [] as { Email: string; Name: string }[] }));
    for (const f of fac.recordset) people.set(f.Email.toLowerCase(), { email: f.Email, name: f.Name });
    for (const p of people.values()) {
      await this.email.sendWorkflowNotice({
        to: p.email,
        subject: `Transfer credit appeal: ${code}`,
        heading: 'A student appealed a transfer credit decision',
        greetingName: p.name.split(' ')[0],
        intro: `a student asked for ${code} (${title}) to be re-evaluated. The reason, proposed BU equivalent and syllabus are attached to the appeal.`,
        ctaLabel: 'Open appeals',
        ctaPath: `/appeals`,
      });
    }
  }

  private readonly SELECT = `
    SELECT a.Id AS id, a.TranscriptId AS transcriptId, a.TranscriptCourseId AS courseId, a.Status AS status, a.Outcome AS outcome,
           a.Reason AS reason, a.ProposedEquivalent AS proposedEquivalent, a.SyllabusUploadId AS syllabusUploadId,
           pc.Id AS proposedCourseId, pc.Code AS proposedCode, pc.Title AS proposedTitle,
           dc.Code AS decidedCode, dc.Title AS decidedTitle, a.AwardedCredits AS awardedCredits,
           a.SatisfiesRequirement AS satisfiesRequirement, a.DenialReason AS denialReason, a.DepartmentName AS departmentName,
           a.DepartmentComments AS comments, a.SignedName AS signedName, a.DecidedAt AS decidedAt, a.CreatedAt AS createdAt,
           tc.CourseCode AS courseCode, tc.CourseTitle AS courseTitle, tc.OriginalCredits AS credits, tc.Grade AS grade,
           tc.TermSeason AS termSeason, tc.TermYear AS termYear, tc.Lane AS lane,
           e.Outcome AS currentOutcome, cur.Code AS currentCode, e.AwardedCredits AS currentCredits,
           i.Name AS institutionName, i.Calendar AS calendar, u.FirstName + ' ' + u.LastName AS studentName, sp.BUStudentId AS buid,
           au.Name AS studentSchool, t.TargetInstitutionId AS targetInstitutionId
    FROM CourseAppeals a
    JOIN TranscriptCourses tc ON tc.Id = a.TranscriptCourseId
    JOIN Transcripts t ON t.Id = a.TranscriptId
    JOIN Institutions i ON i.Id = t.InstitutionId
    JOIN Users u ON u.Id = a.StudentUserId
    LEFT JOIN StudentProfiles sp ON sp.UserId = a.StudentUserId
    LEFT JOIN AcademicUnits au ON au.Id = sp.IntendedAcademicUnitId
    LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
    LEFT JOIN Courses cur ON cur.Id = e.DecidedBUCourseId
    LEFT JOIN Courses pc ON pc.Id = a.ProposedBUCourseId
    LEFT JOIN Courses dc ON dc.Id = a.DecidedBUCourseId`;

  async listForStaff(viewer: Viewer, status: string) {
    if (!STAFF.includes(viewer.role)) throw new ForbiddenException();
    if (!(await this.schema.policyReady())) return [];
    const where = status === 'decided' ? `WHERE a.Status = 'decided'` : status === 'all' ? '' : `WHERE a.Status = 'submitted'`;
    const r = await this.db.query(`${this.SELECT} ${where} ORDER BY a.CreatedAt DESC`);
    return r.recordset;
  }

  async forTranscript(transcriptId: string, viewer: Viewer) {
    await this.requests.assertCanView(transcriptId, viewer);
    if (!(await this.schema.policyReady())) return [];
    const r = await this.db.query(`${this.SELECT} WHERE a.TranscriptId = @t ORDER BY a.CreatedAt DESC`, [
      { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
    ]);
    // Students see the outcome and department comments, not reviewer identities beyond the signed department.
    return r.recordset;
  }

  async decide(appealId: number, viewer: Viewer, dto: DecideAppealDto) {
    await this.ready();
    if (!STAFF.includes(viewer.role)) throw new ForbiddenException();
    const r = await this.db.query<{ TranscriptId: string; TranscriptCourseId: string; Status: string; WorkflowStatus: string | null; CourseCode: string }>(
      `SELECT a.TranscriptId, a.TranscriptCourseId, a.Status, t.WorkflowStatus, tc.CourseCode
       FROM CourseAppeals a JOIN Transcripts t ON t.Id = a.TranscriptId JOIN TranscriptCourses tc ON tc.Id = a.TranscriptCourseId
       WHERE a.Id = @id`,
      [{ name: 'id', type: sql.Int, value: appealId }],
    );
    const a = r.recordset[0];
    if (!a) throw new NotFoundException('Appeal not found');
    if (a.Status !== 'submitted') throw new BadRequestException('This appeal has already been decided.');
    if (dto.outcome === 'equivalent' && !dto.buCourseId) throw new BadRequestException('Choose the BU course equivalent.');
    if (dto.outcome === 'denied' && !dto.denialReason?.trim()) throw new BadRequestException('Give the reason for denying the appeal.');

    let credits = dto.awardedCredits ?? null;
    if (dto.buCourseId) {
      const bc = await this.db.query<{ Credits: number }>(`SELECT Credits FROM Courses WHERE Id = @i`, [{ name: 'i', type: sql.Int, value: dto.buCourseId }]);
      if (!bc.recordset[0]) throw new BadRequestException('BU course not found');
      if (credits == null && dto.outcome !== 'no_credit') credits = Number(bc.recordset[0].Credits);
    }
    if (dto.outcome === 'no_credit') credits = 0;

    if (dto.outcome !== 'denied') {
      // Make sure there is an evaluation to carry the new decision.
      await this.db.query(
        `IF NOT EXISTS (SELECT 1 FROM Evaluations WHERE TranscriptCourseId = @c)
           INSERT INTO Evaluations (TranscriptCourseId, Status) VALUES (@c, 'queued')`,
        [{ name: 'c', type: sql.UniqueIdentifier, value: a.TranscriptCourseId }],
      );
      const ev = await this.db.query<{ Id: string }>(`SELECT TOP 1 Id FROM Evaluations WHERE TranscriptCourseId = @c`, [
        { name: 'c', type: sql.UniqueIdentifier, value: a.TranscriptCourseId },
      ]);
      const evalId = ev.recordset[0].Id;
      const note = `Appeal decision (${dto.departmentName}, signed ${dto.signedName})${dto.comments ? `: ${dto.comments}` : ''}`;
      if (dto.buCourseId) {
        await this.db.execute('sp_RecordDecision', [
          { name: 'EvaluationId', type: sql.UniqueIdentifier, value: evalId },
          { name: 'DecidedBy', type: sql.UniqueIdentifier, value: viewer.id },
          { name: 'Outcome', type: sql.VarChar(20), value: dto.outcome },
          { name: 'BUCourseId', type: sql.Int, value: dto.buCourseId },
          { name: 'AwardedCredits', type: sql.Decimal(5, 2), value: credits },
          { name: 'EvaluatorNotes', type: sql.NVarChar(sql.MAX), value: note },
        ]);
      } else {
        // Elective / no credit without a specific BU course: record the decision without creating an equivalency.
        await this.db.query(
          `UPDATE Evaluations SET Outcome = @o, DecidedBUCourseId = NULL, AwardedCredits = @cr, EvaluatorNotes = @n,
                  DecidedAt = SYSUTCDATETIME(), DecidedBy = @u, Status = 'decided', UpdatedAt = SYSUTCDATETIME()
           WHERE Id = @e;
           UPDATE TranscriptCourses SET Status = 'decided', UpdatedAt = SYSUTCDATETIME() WHERE Id = @c;`,
          [
            { name: 'o', type: sql.VarChar(20), value: dto.outcome },
            { name: 'cr', type: sql.Decimal(5, 2), value: credits },
            { name: 'n', type: sql.NVarChar(sql.MAX), value: note },
            { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
            { name: 'e', type: sql.UniqueIdentifier, value: evalId },
            { name: 'c', type: sql.UniqueIdentifier, value: a.TranscriptCourseId },
          ],
        );
      }
      // If the request was already completed, the new decision is posted straight away.
      if (a.WorkflowStatus === 'approved' || a.WorkflowStatus === 'bypassed') {
        await this.db.query(
          `UPDATE Evaluations SET Status = 'posted', PostedAt = SYSUTCDATETIME(), PostedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE Id = @e;
           UPDATE TranscriptCourses SET Status = 'posted' WHERE Id = @c;`,
          [
            { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
            { name: 'e', type: sql.UniqueIdentifier, value: evalId },
            { name: 'c', type: sql.UniqueIdentifier, value: a.TranscriptCourseId },
          ],
        );
      }
    }

    await this.db.query(
      `UPDATE CourseAppeals SET Status = 'decided', Outcome = @o, DecidedBUCourseId = @b, AwardedCredits = @cr, SatisfiesRequirement = @sr,
              DenialReason = @dr, DepartmentName = @dn, DepartmentComments = @dc, SignedName = @sn, DecidedBy = @u, DecidedAt = SYSUTCDATETIME()
       WHERE Id = @id`,
      [
        { name: 'o', type: sql.VarChar(12), value: dto.outcome },
        { name: 'b', type: sql.Int, value: dto.buCourseId ?? null },
        { name: 'cr', type: sql.Decimal(5, 2), value: dto.outcome === 'denied' ? null : credits },
        { name: 'sr', type: sql.NVarChar(300), value: dto.satisfiesRequirement?.trim() || null },
        { name: 'dr', type: sql.NVarChar(1000), value: dto.denialReason?.trim() || null },
        { name: 'dn', type: sql.NVarChar(150), value: dto.departmentName.trim() },
        { name: 'dc', type: sql.NVarChar(sql.MAX), value: dto.comments?.trim() || null },
        { name: 'sn', type: sql.NVarChar(150), value: dto.signedName.trim() },
        { name: 'u', type: sql.UniqueIdentifier, value: viewer.id },
        { name: 'id', type: sql.Int, value: appealId },
      ],
    );

    const label = { equivalent: 'granted a BU equivalent', elective: 'granted as elective credit', no_credit: 'decided as no credit', denied: 'denied' }[dto.outcome];
    await this.engine.addNote(a.TranscriptId, null, 'student', 'decision', viewer.id, viewer.role,
      `Appeal for ${a.CourseCode} ${label}${dto.outcome === 'denied' && dto.denialReason ? `: ${dto.denialReason.trim()}` : ''}.${dto.comments ? ` Department comments: ${dto.comments.trim()}` : ''}`);
    void this.emailStudent(a.TranscriptId, a.CourseCode, label, dto).catch((e) => this.logger.warn(`Appeal email failed: ${(e as Error).message}`));
    return { message: `Appeal ${label}` };
  }

  private async emailStudent(transcriptId: string, code: string, label: string, dto: DecideAppealDto) {
    const r = await this.db.query<{ Email: string; FirstName: string }>(
      `SELECT u.Email, u.FirstName FROM Transcripts t JOIN Users u ON u.Id = t.StudentUserId WHERE t.Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const u = r.recordset[0];
    if (!u) return;
    const details = [{ label: 'Decision', value: label }, { label: 'Department', value: dto.departmentName }];
    if (dto.satisfiesRequirement) details.push({ label: 'Satisfies', value: dto.satisfiesRequirement });
    await this.email.sendWorkflowNotice({
      to: u.Email,
      subject: `Your appeal for ${code} has been decided`,
      heading: 'Your transfer credit appeal',
      greetingName: u.FirstName,
      intro: `your appeal for ${code} was ${label}.`,
      details,
      quote: dto.denialReason || dto.comments ? { label: dto.denialReason ? 'Reason' : 'Department comments', text: (dto.denialReason || dto.comments)! } : undefined,
      ctaLabel: 'View your request',
      ctaPath: `/student/transcript/${transcriptId}`,
    });
  }
}
