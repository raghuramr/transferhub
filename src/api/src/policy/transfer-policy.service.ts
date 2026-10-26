import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from './schema.service';

export interface TransferPolicy {
  id: number | null;
  institutionId: number | null;
  institutionName?: string | null;
  minGrade: string;
  maxCourseAgeYears: number | null;
  capTransfer: number;
  capFirstYear: number;
  capCurrentStudent: number;
  allowPassFail: boolean;
  requireAccreditation: boolean;
  hubRequirementsTransfer: number;
  hubCocurricularAllowed: number;
}

/** BU's published rules (doc 12) - used when migration 015 is not applied or no row exists. */
export const DEFAULT_POLICY: TransferPolicy = {
  id: null,
  institutionId: null,
  minGrade: 'C',
  maxCourseAgeYears: 5,
  capTransfer: 68,
  capFirstYear: 60,
  capCurrentStudent: 68,
  allowPassFail: false,
  requireAccreditation: true,
  hubRequirementsTransfer: 10,
  hubCocurricularAllowed: 1,
};

export type FlagSeverity = 'block' | 'review' | 'info';
export interface PolicyFlag {
  code: string;
  severity: FlagSeverity;
  message: string;
}

export const GRADE_POINTS: Record<string, number> = {
  'A+': 4.3, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0,
};
const PASS_GRADES = new Set(['P', 'S', 'CR', 'SAT', 'PASS']);
const NO_CREDIT_TYPES = new Set(['internship', 'research', 'military', 'life_experience']);
const REVIEWABLE = new Set(['applied', 'likely', 'needs_syllabus', 'elective_only', 'pending']);

interface PolicyRow {
  Id: number;
  InstitutionId: number | null;
  InstitutionName?: string | null;
  MinGrade: string;
  MaxCourseAgeYears: number | null;
  CapTransfer: number;
  CapFirstYear: number;
  CapCurrentStudent: number;
  AllowPassFail: boolean;
  RequireAccreditation: boolean;
  HubRequirementsTransfer: number;
  HubCocurricularAllowed: number;
}

const mapPolicy = (r: PolicyRow): TransferPolicy => ({
  id: r.Id,
  institutionId: r.InstitutionId,
  institutionName: r.InstitutionName ?? null,
  minGrade: r.MinGrade,
  maxCourseAgeYears: r.MaxCourseAgeYears,
  capTransfer: Number(r.CapTransfer),
  capFirstYear: Number(r.CapFirstYear),
  capCurrentStudent: Number(r.CapCurrentStudent),
  allowPassFail: !!r.AllowPassFail,
  requireAccreditation: !!r.RequireAccreditation,
  hubRequirementsTransfer: r.HubRequirementsTransfer,
  hubCocurricularAllowed: r.HubCocurricularAllowed,
});

export const parseFlags = (json: string | null | undefined): PolicyFlag[] => {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as PolicyFlag[]) : [];
  } catch {
    return [];
  }
};

/**
 * Applies BU's transfer policy on top of sp_TriageCourse's result: pass/fail, minimum grade,
 * course age, accreditation, trimester, non-course experience, coursework outside the US, and
 * the external-credit cap. It only ever tightens a lane (sends a course to review or marks it
 * not eligible); it never auto-approves anything the stored procedure did not.
 */
@Injectable()
export class TransferPolicyService {
  private readonly logger = new Logger(TransferPolicyService.name);

  constructor(private db: DatabaseService, private schema: SchemaService) {}

  // ── settings ──────────────────────────────────────────────────

  async getEffective(institutionId: number | null): Promise<TransferPolicy> {
    if (!(await this.schema.policyReady())) return { ...DEFAULT_POLICY };
    const r = await this.db.query<PolicyRow>(
      `SELECT TOP 1 * FROM TransferPolicies WHERE InstitutionId = @i OR InstitutionId IS NULL
       ORDER BY CASE WHEN InstitutionId IS NULL THEN 1 ELSE 0 END`,
      [{ name: 'i', type: sql.Int, value: institutionId }],
    );
    return r.recordset[0] ? mapPolicy(r.recordset[0]) : { ...DEFAULT_POLICY, institutionId };
  }

  async list(): Promise<TransferPolicy[]> {
    if (!(await this.schema.policyReady())) return [{ ...DEFAULT_POLICY }];
    const r = await this.db.query<PolicyRow>(
      `SELECT p.*, i.Name AS InstitutionName FROM TransferPolicies p LEFT JOIN Institutions i ON i.Id = p.InstitutionId
       ORDER BY CASE WHEN p.InstitutionId IS NULL THEN 0 ELSE 1 END, i.Name`,
    );
    return r.recordset.length ? r.recordset.map(mapPolicy) : [{ ...DEFAULT_POLICY }];
  }

  async upsert(institutionId: number | null, input: Partial<TransferPolicy>, userId: string): Promise<TransferPolicy> {
    const base = await this.getEffective(institutionId);
    const m = { ...base, ...input };
    if (!(m.minGrade in GRADE_POINTS) || m.minGrade === 'F' || m.minGrade === 'A+') m.minGrade = 'C';
    const inputs = [
      { name: 'i', type: sql.Int, value: institutionId },
      { name: 'g', type: sql.VarChar(3), value: m.minGrade },
      { name: 'age', type: sql.Int, value: m.maxCourseAgeYears },
      { name: 'ct', type: sql.Decimal(6, 2), value: m.capTransfer },
      { name: 'cf', type: sql.Decimal(6, 2), value: m.capFirstYear },
      { name: 'cc', type: sql.Decimal(6, 2), value: m.capCurrentStudent },
      { name: 'pf', type: sql.Bit, value: m.allowPassFail ? 1 : 0 },
      { name: 'acc', type: sql.Bit, value: m.requireAccreditation ? 1 : 0 },
      { name: 'hub', type: sql.Int, value: m.hubRequirementsTransfer },
      { name: 'hubc', type: sql.Int, value: m.hubCocurricularAllowed },
      { name: 'u', type: sql.UniqueIdentifier, value: userId },
    ];
    await this.db.query(
      `IF EXISTS (SELECT 1 FROM TransferPolicies WHERE (@i IS NULL AND InstitutionId IS NULL) OR InstitutionId = @i)
         UPDATE TransferPolicies SET MinGrade=@g, MaxCourseAgeYears=@age, CapTransfer=@ct, CapFirstYear=@cf, CapCurrentStudent=@cc,
                AllowPassFail=@pf, RequireAccreditation=@acc, HubRequirementsTransfer=@hub, HubCocurricularAllowed=@hubc,
                UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u
         WHERE (@i IS NULL AND InstitutionId IS NULL) OR InstitutionId = @i
       ELSE
         INSERT INTO TransferPolicies (InstitutionId, MinGrade, MaxCourseAgeYears, CapTransfer, CapFirstYear, CapCurrentStudent,
                AllowPassFail, RequireAccreditation, HubRequirementsTransfer, HubCocurricularAllowed, UpdatedBy)
         VALUES (@i, @g, @age, @ct, @cf, @cc, @pf, @acc, @hub, @hubc, @u)`,
      inputs,
    );
    return this.getEffective(institutionId);
  }

  async removeOverride(institutionId: number) {
    if (!(await this.schema.policyReady())) return;
    await this.db.query(`DELETE FROM TransferPolicies WHERE InstitutionId = @i`, [{ name: 'i', type: sql.Int, value: institutionId }]);
  }

  capFor(policy: TransferPolicy, applicantType: string | null): number {
    if (applicantType === 'dual_enrollment') return policy.capFirstYear;
    if (applicantType === 'current_student') return policy.capCurrentStudent;
    return policy.capTransfer;
  }

  /** The university whose rules apply to this student's requests (target, else BU). */
  async targetFor(studentUserId: string): Promise<number | null> {
    try {
      const r = await this.db.query<{ T: number | null }>(`SELECT TargetInstitutionId AS T FROM StudentProfiles WHERE UserId = @u`, [
        { name: 'u', type: sql.UniqueIdentifier, value: studentUserId },
      ]);
      if (r.recordset[0]?.T) return r.recordset[0].T;
    } catch {
      // older schema
    }
    const bu = await this.db.query<{ Id: number }>(`SELECT TOP 1 Id FROM Institutions WHERE Code = 'BU'`);
    return bu.recordset[0]?.Id ?? null;
  }

  // ── credit position + Hub (shown to students and reviewers) ────

  async creditSummary(studentUserId: string) {
    const target = await this.targetFor(studentUserId);
    const policy = await this.getEffective(target);
    let applicantType: string | null = null;
    let examCredits = 0;
    if (await this.schema.policyReady()) {
      const p = await this.db.query<{ ApplicantType: string | null }>(`SELECT ApplicantType FROM StudentProfiles WHERE UserId = @u`, [
        { name: 'u', type: sql.UniqueIdentifier, value: studentUserId },
      ]);
      applicantType = p.recordset[0]?.ApplicantType ?? null;
      const e = await this.db.query<{ N: number | null }>(`SELECT SUM(Credits) AS N FROM StudentExamCredits WHERE UserId = @u`, [
        { name: 'u', type: sql.UniqueIdentifier, value: studentUserId },
      ]);
      examCredits = Number(e.recordset[0]?.N ?? 0);
    }
    const used = await this.usedCredits(studentUserId, null);
    const cap = this.capFor(policy, applicantType);
    return {
      cap,
      transferCredits: used,
      examCredits,
      used: used + examCredits,
      remaining: Math.max(0, cap - used - examCredits),
      hubRequirements: policy.hubRequirementsTransfer,
      hubCocurricularAllowed: policy.hubCocurricularAllowed,
      applicantType,
    };
  }

  /** External credits already counted for the student (auto-applied or awarded), optionally excluding one request. */
  private async usedCredits(studentUserId: string, excludeTranscriptId: string | null): Promise<number> {
    const r = await this.db.query<{ N: number | null }>(
      `SELECT SUM(CASE WHEN e.AwardedCredits IS NOT NULL AND e.Outcome IN ('equivalent','elective') THEN e.AwardedCredits
                       WHEN tc.Lane = 'applied' THEN ISNULL(tc.NormalisedCredits, tc.OriginalCredits) ELSE 0 END) AS N
       FROM TranscriptCourses tc
       JOIN Transcripts t ON t.Id = tc.TranscriptId
       LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
       WHERE t.StudentUserId = @u AND (@x IS NULL OR t.Id <> @x)`,
      [
        { name: 'u', type: sql.UniqueIdentifier, value: studentUserId },
        { name: 'x', type: sql.UniqueIdentifier, value: excludeTranscriptId },
      ],
    );
    return Number(r.recordset[0]?.N ?? 0);
  }

  // ── the rules ────────────────────────────────────────────────

  /** Re-evaluates every course of a request against the policy. Safe to run repeatedly. */
  async applyToTranscript(transcriptId: string): Promise<{ flagged: number } | null> {
    if (!(await this.schema.policyReady())) return null;
    const head = await this.db.query<{ StudentUserId: string; IsAccredited: boolean | null; Calendar: string; ApplicantType: string | null }>(
      `SELECT t.StudentUserId, i.IsAccredited, i.Calendar, sp.ApplicantType
       FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId
       LEFT JOIN StudentProfiles sp ON sp.UserId = t.StudentUserId
       WHERE t.Id = @t`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );
    const t = head.recordset[0];
    if (!t) return null;
    const policy = await this.getEffective(await this.targetFor(t.StudentUserId));

    const courses = await this.db.query<{
      Id: string; CourseCode: string; Grade: string; Lane: string; OriginalCredits: number; NormalisedCredits: number | null;
      TermSeason: string | null; TermYear: number | null; GradingBasis: string | null; CourseType: string | null;
      IsOutsideUS: boolean; PassFailException: boolean; HasEval: number;
    }>(
      `SELECT tc.Id, tc.CourseCode, tc.Grade, tc.Lane, tc.OriginalCredits, tc.NormalisedCredits, tc.TermSeason, tc.TermYear,
              tc.GradingBasis, tc.CourseType, tc.IsOutsideUS, tc.PassFailException,
              (SELECT COUNT(*) FROM Evaluations e WHERE e.TranscriptCourseId = tc.Id) AS HasEval
       FROM TranscriptCourses tc WHERE tc.TranscriptId = @t ORDER BY tc.SortOrder, tc.CourseCode`,
      [{ name: 't', type: sql.UniqueIdentifier, value: transcriptId }],
    );

    const nowYear = new Date().getUTCFullYear();
    const minPoints = GRADE_POINTS[policy.minGrade] ?? 2;
    const cap = this.capFor(policy, t.ApplicantType);
    let running = (await this.usedCredits(t.StudentUserId, transcriptId)) + (await this.examCredits(t.StudentUserId));
    let flagged = 0;

    for (const c of courses.recordset) {
      const flags: PolicyFlag[] = [];
      let lane = c.Lane;
      const review = (code: string, message: string) => {
        flags.push({ code, severity: 'review', message });
        if (lane !== 'not_eligible' && REVIEWABLE.has(lane)) lane = 'pending';
      };
      const block = (code: string, message: string) => {
        flags.push({ code, severity: 'block', message });
        lane = 'not_eligible';
      };
      const grade = (c.Grade ?? '').trim().toUpperCase();

      if (c.IsOutsideUS) {
        flags.push({ code: 'international', severity: 'info', message: 'Completed outside the US: evaluated by the Office of International Undergraduate Admissions (intadvis@bu.edu), not in this request.' });
        if (lane !== 'not_eligible') lane = 'pending';
      } else if (c.CourseType && NO_CREDIT_TYPES.has(c.CourseType)) {
        block('no_credit_type', 'BU does not award transfer credit for internships, research, military or life experience.');
      } else {
        // Grades
        const passish = PASS_GRADES.has(grade) || c.GradingBasis === 'pass_fail' || c.GradingBasis === 'sat_unsat';
        if (passish) {
          const covid = (c.TermSeason ?? '').toLowerCase() === 'spring' && c.TermYear === 2020;
          if (covid) flags.push({ code: 'pf_covid', severity: 'info', message: 'Pass/Fail accepted: Spring 2020 COVID-era grading.' });
          else if (c.PassFailException) flags.push({ code: 'pf_exception', severity: 'info', message: 'Pass/Fail accepted: the college required P/F for this course.' });
          else if (!policy.allowPassFail) review('pass_fail', 'Pass/Fail and Satisfactory/Unsatisfactory grades are not normally transferable; a reviewer must confirm an exception.');
        } else if (grade in GRADE_POINTS) {
          if (GRADE_POINTS[grade] < minPoints) block('below_min_grade', `Grade ${grade} is below the minimum of ${policy.minGrade}.`);
          else if (lane === 'not_eligible') {
            lane = 'pending';
            flags.push({ code: 'min_grade_override', severity: 'review', message: `Eligible under this university's minimum grade (${policy.minGrade}).` });
          }
        }
        // Age
        if (policy.maxCourseAgeYears != null) {
          if (c.TermYear && nowYear - c.TermYear > policy.maxCourseAgeYears) {
            review('too_old', `Taken in ${c.TermYear}: coursework older than ${policy.maxCourseAgeYears} years needs extra review.`);
          } else if (!c.TermYear) {
            flags.push({ code: 'missing_term', severity: 'info', message: 'Term/year not given, so the age of this course could not be checked.' });
          }
        }
        // Accreditation
        if (policy.requireAccreditation) {
          if (t.IsAccredited === false) block('unaccredited', 'The sending institution is not regionally accredited, so BU cannot accept its credit.');
          else if (t.IsAccredited == null) review('accreditation_unknown', 'Accreditation of the sending institution is not recorded; a reviewer must confirm it.');
        }
        // Calendar
        if (t.Calendar === 'trimester') review('trimester', 'Trimester credits have no automatic conversion; a reviewer sets the BU credit value.');
        // Cap (only for credit that would otherwise count)
        if (lane === 'applied') {
          const credits = Number(c.NormalisedCredits ?? c.OriginalCredits ?? 0);
          if (running + credits > cap) review('over_cap', `Over the ${cap}-credit limit on external credit (transfer, AP, IB and A-level combined).`);
          else running += credits;
        }
      }

      if (flags.some((f) => f.severity !== 'info')) flagged++;
      await this.db.query(`UPDATE TranscriptCourses SET Lane = @l, PolicyFlags = @f, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, [
        { name: 'l', type: sql.VarChar(30), value: lane },
        { name: 'f', type: sql.NVarChar(sql.MAX), value: flags.length ? JSON.stringify(flags) : null },
        { name: 'id', type: sql.UniqueIdentifier, value: c.Id },
      ]);
      // Anything a person must look at needs an evaluation record (but never international coursework).
      if (!c.IsOutsideUS && !c.HasEval && (lane === 'pending' || lane === 'needs_syllabus')) {
        await this.db.query(`INSERT INTO Evaluations (TranscriptCourseId, Status) VALUES (@tc, 'queued')`, [
          { name: 'tc', type: sql.UniqueIdentifier, value: c.Id },
        ]);
      }
    }
    return { flagged };
  }

  private async examCredits(studentUserId: string): Promise<number> {
    const e = await this.db.query<{ N: number | null }>(`SELECT SUM(Credits) AS N FROM StudentExamCredits WHERE UserId = @u`, [
      { name: 'u', type: sql.UniqueIdentifier, value: studentUserId },
    ]);
    return Number(e.recordset[0]?.N ?? 0);
  }

  /** Reviewer: accept (or withdraw) a Pass/Fail exception for one course, then re-run the rules. */
  async setPassFailException(transcriptId: string, courseId: string, exception: boolean) {
    await this.db.query(`UPDATE TranscriptCourses SET PassFailException = @e WHERE Id = @c AND TranscriptId = @t`, [
      { name: 'e', type: sql.Bit, value: exception ? 1 : 0 },
      { name: 'c', type: sql.UniqueIdentifier, value: courseId },
      { name: 't', type: sql.UniqueIdentifier, value: transcriptId },
    ]);
    await this.applyToTranscript(transcriptId);
    this.logger.log(`P/F exception ${exception ? 'granted' : 'withdrawn'} for course ${courseId}`);
  }
}
