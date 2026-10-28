import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { ScopeService, ScopeViewer } from '../policy/scope.service';
import { TransferPolicyService } from '../policy/transfer-policy.service';
import { ProgressService } from '../progress/progress.service';
import { convertCredits } from '../progress/progress.aggregate';
import type { CatalogCourse } from '../ai/course-prefilter';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { compareUniversity, EquivalencyInput, ProgramInput, StudentCourseInput, UniversityComparison, UniversityInput } from './compare.logic';

const r2 = (n: number) => Math.round(n * 100) / 100;
const intList = (ids: number[]) => ids.map((i) => String(Math.trunc(Number(i)))).join(',');

/** Outcome of applying to one university via POST /student/apply. */
export interface ApplyOutcome {
  institutionId: number;
  institutionName: string | null;
  transcriptId: string | null;
  status: 'created' | 'skipped' | 'error';
  reason?: string;
}

export const PREVIEW_NOTE =
  'This is a preview, not a guarantee. Matches come from existing equivalencies and built-in rules; the official evaluation happens after you are admitted and the department decides.';

@Injectable()
export class StudentJourneyService {
  private readonly logger = new Logger(StudentJourneyService.name);

  constructor(
    private db: DatabaseService,
    private schema: SchemaService,
    private scope: ScopeService,
    private policy: TransferPolicyService,
    private progress: ProgressService,
    private transcripts: TranscriptsService,
  ) {}

  /** Students see themselves; staff may pass ?userId= under the same scope rules as /progress. */
  async resolveStudent(viewer: ScopeViewer, userId?: string): Promise<string> {
    if (!userId || userId === viewer.id) return viewer.id;
    if (!['admin', 'super_admin', 'faculty'].includes(viewer.role)) throw new ForbiddenException();
    if (!(await this.scope.canManageUser(viewer, userId))) throw new ForbiddenException();
    const e = await this.db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM Users WHERE Id = @u`, [{ name: 'u', type: sql.UniqueIdentifier, value: userId }]);
    if (!e.recordset[0]?.N) throw new NotFoundException('Student not found');
    return userId;
  }

  // ── universities ───────────────────────────────────────────────

  async universities() {
    const hasLogo = await this.schema.has('Institutions', 'LogoUrl');
    const r = await this.db.query<{ Id: number; Code: string; Name: string; Type: string; Logo: string | null }>(
      `SELECT Id, Code, Name, Type, ${hasLogo ? 'LogoUrl' : 'CAST(NULL AS NVARCHAR(500))'} AS Logo
       FROM Institutions WHERE IsActive = 1 AND Type IN ('university','community_college') ORDER BY Name`,
    );
    return r.recordset.map((u) => ({ id: u.Id, code: u.Code, name: u.Name, type: u.Type, logoUrl: u.Logo ?? null }));
  }

  // ── overview ("where I am now") ────────────────────────────────

  async overview(studentUserId: string) {
    const u = [{ name: 'u', type: sql.UniqueIdentifier, value: studentUserId }];

    let profile: Record<string, any> = {};
    try {
      const p = await this.db.query(
        `SELECT TargetInstitutionId, TargetProgramId, PriorInstitutionName, FieldOfStudy, ProgramArea, HighestEducationLevel
         FROM StudentProfiles WHERE UserId = @u`, u);
      profile = p.recordset[0] ?? {};
    } catch (err) {
      this.logger.warn(`overview: profile columns missing (${(err as Error).message})`);
      try {
        const p = await this.db.query(`SELECT ProgramArea FROM StudentProfiles WHERE UserId = @u`, u);
        profile = p.recordset[0] ?? {};
      } catch { /* no profile */ }
    }

    // Courses across every request, newest request first.
    const rows = await this.db.query<any>(
      `SELECT tc.Id, tc.CourseCode, tc.CourseTitle, tc.Term, tc.Grade, tc.OriginalCredits, tc.NormalisedCredits, tc.SortOrder,
              t.Id AS TranscriptId, t.InstitutionId AS SourceId, t.ReceivedAt, i.Name AS SourceName, i.Calendar
       FROM TranscriptCourses tc
       JOIN Transcripts t ON t.Id = tc.TranscriptId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE t.StudentUserId = @u AND t.Status <> 'cancelled'
       ORDER BY t.ReceivedAt DESC, tc.SortOrder, tc.CourseCode`, u);

    const buckets = new Map<string, { bucket: string; low: number; high: number }>();
    let progress: Awaited<ReturnType<ProgressService['build']>> | null = null;
    try {
      progress = await this.progress.build(studentUserId);
      for (const rq of progress.requests) for (const c of rq.courses) buckets.set(String(c.id).toLowerCase(), { bucket: c.bucket, low: c.low, high: c.high });
    } catch (err) {
      this.logger.warn(`overview: progress unavailable (${(err as Error).message})`);
    }

    const courses = rows.recordset.map((c) => ({
      id: c.Id as string,
      code: c.CourseCode as string,
      title: c.CourseTitle as string,
      term: (c.Term as string | null) ?? null,
      grade: (c.Grade as string | null) ?? null,
      institutionName: c.SourceName as string,
      originalCredits: Number(c.OriginalCredits),
      convertedCredits: convertCredits(Number(c.OriginalCredits), c.NormalisedCredits, c.Calendar),
      calendar: c.Calendar as string,
      bucket: buckets.get(String(c.Id).toLowerCase())?.bucket ?? null,
    }));
    const totals = {
      courses: courses.length,
      originalCredits: r2(courses.reduce((s, c) => s + c.originalCredits, 0)),
      convertedCredits: r2(courses.reduce((s, c) => s + c.convertedCredits, 0)),
    };

    // Current institution: latest request's source, else profile free text, else latest education row.
    let institution: { id: number | null; name: string; source: 'transcript' | 'profile' | 'education' } | null = null;
    let educationCredits: number | null = null;
    const latest = rows.recordset[0];
    if (latest) institution = { id: latest.SourceId, name: latest.SourceName, source: 'transcript' };
    let eduRows: Array<{ InstitutionName: string; InstitutionId: number | null; CreditsEarned: number | null }> = [];
    if (await this.schema.has('StudentEducation')) {
      try {
        const e = await this.db.query<any>(
          `SELECT InstitutionName, InstitutionId, CreditsEarned FROM StudentEducation WHERE UserId = @u
           ORDER BY CASE WHEN ToYear IS NULL THEN 1 ELSE 0 END DESC, ToYear DESC, SortOrder DESC, Id DESC`, u);
        eduRows = e.recordset;
        const sum = eduRows.reduce((s, x) => s + (x.CreditsEarned == null ? 0 : Number(x.CreditsEarned)), 0);
        educationCredits = eduRows.some((x) => x.CreditsEarned != null) ? r2(sum) : null;
      } catch (err) {
        this.logger.warn(`overview: StudentEducation unreadable (${(err as Error).message})`);
      }
    }
    if (!institution && profile.PriorInstitutionName) institution = { id: null, name: profile.PriorInstitutionName, source: 'profile' };
    if (!institution && eduRows[0]) institution = { id: eduRows[0].InstitutionId ?? null, name: eduRows[0].InstitutionName, source: 'education' };

    // Target university + program.
    let target: { institutionId: number; institutionName: string; institutionCode: string; programId: number | null; programName: string | null } | null = null;
    if (profile.TargetInstitutionId) {
      const t = await this.db.query<any>(
        `SELECT i.Id, i.Name, i.Code, p.Id AS ProgramId, p.Name AS ProgramName
         FROM Institutions i LEFT JOIN Programs p ON p.Id = @p
         WHERE i.Id = @i`,
        [{ name: 'i', type: sql.Int, value: profile.TargetInstitutionId }, { name: 'p', type: sql.Int, value: profile.TargetProgramId ?? null }],
      );
      const x = t.recordset[0];
      if (x) target = { institutionId: x.Id, institutionName: x.Name, institutionCode: x.Code, programId: x.ProgramId ?? null, programName: x.ProgramName ?? null };
    }

    const atTarget = progress && courses.length
      ? {
          secure: progress.totals.secure,
          likelyLow: progress.totals.likelyLow,
          likelyHigh: progress.totals.likelyHigh,
          pending: progress.totals.pending,
          notCounted: progress.totals.notCounted,
          cap: progress.cap.limit,
          capRemaining: progress.cap.remaining,
          isProvisional: progress.isProvisional,
        }
      : null;

    return {
      institution,
      program: (profile.FieldOfStudy as string | null) || (profile.ProgramArea as string | null) || null,
      educationLevel: (profile.HighestEducationLevel as string | null) ?? null,
      courses,
      totals,
      /** Credits the student reported on their profile; only used when no transcript courses exist. */
      profileCredits: educationCredits,
      target,
      atTarget,
    };
  }

  // ── comparison ─────────────────────────────────────────────────

  parseIds(raw: string | undefined): number[] {
    const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new BadRequestException('Pass ids=1,2,3 (1 to 3 university ids).');
    if (parts.length > 3) throw new BadRequestException('You can compare at most 3 universities.');
    const ids = parts.map((p) => (/^\d{1,9}$/.test(p) ? Number(p) : NaN));
    if (ids.some((i) => !Number.isInteger(i) || i <= 0)) throw new BadRequestException('ids must be positive whole numbers.');
    return [...new Set(ids)];
  }

  async compare(studentUserId: string, ids: number[]) {
    // 1. Universities (must be active receiving universities).
    const inst = await this.db.query<{ Id: number; Code: string; Name: string }>(
      `SELECT Id, Code, Name FROM Institutions WHERE IsActive = 1 AND Type IN ('university','community_college') AND Id IN (${intList(ids)})`);
    const found = new Map(inst.recordset.map((i) => [i.Id, i] as const));
    const missing = ids.filter((i) => !found.has(i));
    if (missing.length) throw new NotFoundException(`University not found: ${missing.join(', ')}`);

    // 2. The student's courses, once.
    const courses = await this.studentCourses(studentUserId);

    // 3. Catalogues, topics, programs, equivalencies: one query each for all universities.
    const cat = await this.db.query<any>(
      `SELECT Id, InstitutionId, Code, Title, Credits, ProgramArea, ProgramId, Description FROM Courses
       WHERE IsActive = 1 AND InstitutionId IN (${intList(ids)})`);
    const topics = await this.db.query<any>(
      `SELECT t.CourseId, t.Title, t.Description
       FROM CourseTopics t JOIN Courses c ON c.Id = t.CourseId
       ${(await this.schema.has('UniversityTopicStatus')) ? `LEFT JOIN UniversityTopicStatus us ON us.TopicId = t.Id AND us.InstitutionId = c.InstitutionId` : ''}
       WHERE c.IsActive = 1 AND c.InstitutionId IN (${intList(ids)})
       ${(await this.schema.has('UniversityTopicStatus')) ? 'AND (us.IsActive IS NULL OR us.IsActive = 1)' : ''}`);
    const topicsByCourse = new Map<number, string[]>();
    for (const t of topics.recordset) {
      const list = topicsByCourse.get(t.CourseId) ?? [];
      list.push(t.Description ? `${t.Title} ${String(t.Description).slice(0, 160)}` : t.Title);
      topicsByCourse.set(t.CourseId, list);
    }

    const hasPU = await this.schema.has('ProgramUniversities');
    const progRows = await this.db.query<any>(
      hasPU
        ? `SELECT pu.InstitutionId, p.Id, p.Name, p.Area, p.Degree, p.School
           FROM ProgramUniversities pu JOIN Programs p ON p.Id = pu.ProgramId
           WHERE p.IsActive = 1 AND pu.InstitutionId IN (${intList(ids)})`
        : `SELECT p.InstitutionId, p.Id, p.Name, p.Area, p.Degree, p.School FROM Programs p
           WHERE p.IsActive = 1 AND p.InstitutionId IN (${intList(ids)})`);
    const progCourses = new Map<number, Set<number>>();
    const addPC = (p: number, c: number) => (progCourses.get(p) ?? progCourses.set(p, new Set()).get(p)!).add(c);
    for (const c of cat.recordset) if (c.ProgramId) addPC(c.ProgramId, c.Id);
    if (await this.schema.has('ProgramCourses')) {
      const pc = await this.db.query<{ ProgramId: number; CourseId: number }>(`SELECT ProgramId, CourseId FROM ProgramCourses`);
      for (const r of pc.recordset) addPC(r.ProgramId, r.CourseId);
    }

    const extIds = [...new Set(courses.map((c) => c.externalCourseId).filter((x): x is number => x != null))];
    let eqRows: Array<{ ExternalCourseId: number; BUCourseId: number; Outcome: string; BUCredits: number | null; InstitutionId: number }> = [];
    if (extIds.length) {
      const dated = await this.schema.has('Equivalencies', 'EffectiveFrom');
      const e = await this.db.query<any>(
        `SELECT e.ExternalCourseId, e.BUCourseId, e.Outcome, e.BUCredits, bc.InstitutionId
         FROM Equivalencies e JOIN Courses bc ON bc.Id = e.BUCourseId
         WHERE e.IsActive = 1 AND bc.IsActive = 1 AND e.Outcome IN ('equivalent','elective')
           AND bc.InstitutionId IN (${intList(ids)}) AND e.ExternalCourseId IN (${intList(extIds)})
           ${dated ? `AND (e.EffectiveFrom IS NULL OR e.EffectiveFrom <= CAST(SYSUTCDATETIME() AS DATE))
                      AND (e.EffectiveTo IS NULL OR e.EffectiveTo >= CAST(SYSUTCDATETIME() AS DATE))` : ''}`);
      eqRows = e.recordset;
    }

    // 4. Cap per university (policy defaults when migration 015 is absent).
    let applicantType: string | null = null;
    if (await this.schema.policyReady()) {
      try {
        const a = await this.db.query<{ A: string | null }>(`SELECT ApplicantType AS A FROM StudentProfiles WHERE UserId = @u`, [{ name: 'u', type: sql.UniqueIdentifier, value: studentUserId }]);
        applicantType = a.recordset[0]?.A ?? null;
      } catch { /* default */ }
    }

    const universities: UniversityComparison[] = [];
    for (const id of ids) {
      const i = found.get(id)!;
      const pol = await this.policy.getEffective(id);
      const catalogue: CatalogCourse[] = cat.recordset
        .filter((c) => c.InstitutionId === id)
        .map((c) => ({
          id: c.Id, code: c.Code, title: c.Title, credits: Number(c.Credits), programArea: c.ProgramArea ?? null,
          description: c.Description ?? null, topics: topicsByCourse.get(c.Id) ?? [],
        }));
      const inCat = new Set(catalogue.map((c) => c.id));
      const programs: ProgramInput[] = progRows.recordset
        .filter((p) => p.InstitutionId === id)
        .map((p) => ({
          id: p.Id, name: p.Name, area: p.Area ?? null, degree: p.Degree ?? null, school: p.School ?? null,
          courseIds: [...(progCourses.get(p.Id) ?? [])].filter((c) => inCat.has(c)),
        }));
      const equivalencies: EquivalencyInput[] = eqRows
        .filter((e) => e.InstitutionId === id)
        .map((e) => ({ externalCourseId: e.ExternalCourseId, courseId: e.BUCourseId, outcome: e.Outcome as 'equivalent' | 'elective', credits: e.BUCredits == null ? null : Number(e.BUCredits) }));
      const input: UniversityInput = { id, code: i.Code, name: i.Name, catalogue, programs, equivalencies, cap: this.policy.capFor(pol, applicantType) };
      universities.push(compareUniversity(courses, input));
    }

    return {
      preview: true,
      note: PREVIEW_NOTE,
      studentCourses: courses.map((c) => ({ id: c.id, code: c.code, title: c.title, term: c.term, convertedCredits: c.convertedCredits })),
      universities,
    };
  }

  private async studentCourses(studentUserId: string): Promise<StudentCourseInput[]> {
    const rows = await this.db.query<any>(
      `SELECT tc.Id, tc.CourseCode, tc.CourseTitle, tc.Term, tc.Grade, tc.OriginalCredits, tc.NormalisedCredits, tc.Lane,
              i.Calendar, COALESCE(tc.ExternalCourseId, ec.Id) AS ExtId
       FROM TranscriptCourses tc
       JOIN Transcripts t ON t.Id = tc.TranscriptId
       JOIN Institutions i ON i.Id = t.InstitutionId
       LEFT JOIN Courses ec ON ec.InstitutionId = t.InstitutionId AND ec.Code = tc.CourseCode
       WHERE t.StudentUserId = @u AND t.Status <> 'cancelled'
       ORDER BY t.ReceivedAt DESC, tc.SortOrder, tc.CourseCode`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: studentUserId }]);
    const extIds = [...new Set(rows.recordset.map((r) => r.ExtId).filter((x: number | null) => x != null))] as number[];
    const text = new Map<number, string>();
    if (extIds.length) {
      const d = await this.db.query<{ Id: number; Description: string | null }>(`SELECT Id, Description FROM Courses WHERE Id IN (${intList(extIds)})`);
      for (const r of d.recordset) text.set(r.Id, r.Description ?? '');
      const t = await this.db.query<{ CourseId: number; Title: string }>(`SELECT CourseId, Title FROM CourseTopics WHERE CourseId IN (${intList(extIds)})`);
      for (const r of t.recordset) text.set(r.CourseId, `${text.get(r.CourseId) ?? ''} ${r.Title}`);
    }
    return rows.recordset.map((r) => ({
      id: r.Id,
      code: r.CourseCode,
      title: r.CourseTitle,
      term: r.Term ?? null,
      grade: r.Grade ?? null,
      originalCredits: Number(r.OriginalCredits),
      convertedCredits: convertCredits(Number(r.OriginalCredits), r.NormalisedCredits, r.Calendar),
      externalCourseId: r.ExtId ?? null,
      text: r.ExtId != null ? text.get(r.ExtId) ?? '' : '',
      notEligible: r.Lane === 'not_eligible',
    }));
  }

  // ── apply (create a tracked request for each chosen university) ──────────

  /**
   * Creates one transcript ("request") per selected university, each targeted at that university
   * (Transcripts.TargetInstitutionId) and copying the student's current courses, so each is tracked
   * separately. Reuses TranscriptsService.submit, which keeps the existing preview/official evaluation-kind
   * logic intact. Universities the student already has an active (non-preview) request for are skipped.
   */
  async apply(studentUserId: string, rawIds: number[], role: string): Promise<ApplyOutcome[]> {
    const ids = [...new Set(rawIds.map((i) => Math.trunc(Number(i))).filter((i) => Number.isInteger(i) && i > 0))];
    if (!ids.length) throw new BadRequestException('Pick at least one university to apply to.');

    // The source institution + courses from the student's most recent request.
    const latest = await this.db.query<{ Id: string; InstId: number; Code: string; Name: string; Calendar: string | null }>(
      `SELECT TOP 1 t.Id, t.InstitutionId AS InstId, i.Code, i.Name, i.Calendar
       FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE t.StudentUserId = @u AND t.Status <> 'cancelled' ORDER BY t.ReceivedAt DESC`,
      [{ name: 'u', type: sql.UniqueIdentifier, value: studentUserId }]);
    const source = latest.recordset[0];
    if (!source) {
      throw new BadRequestException('You have no courses yet. Submit a transcript or use Smart Upload first, then apply.');
    }
    const courseRows = await this.db.query<{ CourseCode: string; CourseTitle: string; OriginalCredits: number; Grade: string | null; Term: string | null }>(
      `SELECT CourseCode, CourseTitle, OriginalCredits, Grade, Term
       FROM TranscriptCourses WHERE TranscriptId = @t ORDER BY SortOrder, CourseCode`,
      [{ name: 't', type: sql.UniqueIdentifier, value: source.Id }]);
    if (!courseRows.recordset.length) {
      throw new BadRequestException('Your latest transcript has no courses to apply with.');
    }

    // Only active receiving universities can be applied to.
    const inst = await this.db.query<{ Id: number; Name: string }>(
      `SELECT Id, Name FROM Institutions WHERE IsActive = 1 AND Type IN ('university','community_college') AND Id IN (${intList(ids)})`);
    const found = new Map(inst.recordset.map((i) => [i.Id, i.Name] as const));

    // Universities the student already has an active (non-preview) request for — skip those.
    const already = new Set<number>();
    const hasTarget = await this.schema.has('Transcripts', 'TargetInstitutionId');
    if (hasTarget) {
      const hasKind = await this.schema.has('Transcripts', 'EvaluationKind');
      const ex = await this.db.query<{ TargetInstitutionId: number }>(
        `SELECT DISTINCT TargetInstitutionId FROM Transcripts
         WHERE StudentUserId = @u AND Status <> 'cancelled' AND TargetInstitutionId IS NOT NULL
           AND TargetInstitutionId IN (${intList(ids)})
           ${hasKind ? `AND ISNULL(EvaluationKind, 'official') <> 'preview'` : ''}`,
        [{ name: 'u', type: sql.UniqueIdentifier, value: studentUserId }]);
      for (const r of ex.recordset) already.add(r.TargetInstitutionId);
    }

    const calendar = ['semester', 'quarter', 'trimester'].includes(String(source.Calendar)) ? String(source.Calendar) : 'semester';
    const courses = courseRows.recordset.map((c) => ({
      courseCode: c.CourseCode,
      courseTitle: c.CourseTitle,
      originalCredits: Number(c.OriginalCredits),
      grade: c.Grade ?? '',
      term: c.Term ?? undefined,
    }));

    const out: ApplyOutcome[] = [];
    for (const id of ids) {
      const name = found.get(id) ?? null;
      if (!name) {
        out.push({ institutionId: id, institutionName: null, transcriptId: null, status: 'error', reason: 'University not found or inactive.' });
        continue;
      }
      if (already.has(id)) {
        out.push({ institutionId: id, institutionName: name, transcriptId: null, status: 'skipped', reason: 'You already have a request for this university.' });
        continue;
      }
      try {
        const created = await this.transcripts.submit(
          { institutionName: source.Name, institutionCode: source.Code, calendar, targetInstitutionId: id, courses },
          studentUserId,
          role,
        );
        out.push({ institutionId: id, institutionName: name, transcriptId: created.id, status: 'created' });
      } catch (err) {
        this.logger.warn(`apply: request for university ${id} failed: ${(err as Error).message}`);
        out.push({ institutionId: id, institutionName: name, transcriptId: null, status: 'error', reason: 'Could not create this request. Please try again.' });
      }
    }
    return out;
  }
}
