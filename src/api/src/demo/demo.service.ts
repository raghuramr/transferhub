import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { UploadsService } from '../uploads/uploads.service';
import { ProgressService } from '../progress/progress.service';
import type { UploadedFileLike } from '../common/uploaded-file.interface';
import {
  DEMO_DECISION_COURSES, DEMO_NOTE_PREFIX, DEMO_SUGGESTIONS, DEMO_TRANSCRIPTS, KNOWN_EQUIVALENCIES,
  MAYA_EMAIL, NOAH, NOAH_EMAIL, SEED_EQUIVALENCY_SOURCES,
} from './demo-scenario.data';
import { DemoCourseFact, deriveDemoState } from './demo-scenario.logic';
import { DemoDocumentsService } from './demo-documents.service';
import { buildStudentDocuments, type DemoDocKind, type DocCollegeRecord, type GeneratedDoc } from './demo-documents';

export interface Actor { id: string; email: string; role: string }
type Run = <R = any>(q: string, inputs?: QueryInput[]) => Promise<sql.IResult<R>>;

const NOTE_LIKE = `${DEMO_NOTE_PREFIX}%`;
/** Tags a `buildBaseline` transcript distinctly from the scripted scenario, so a normal `resetMaya` never touches it. */
const BASELINE_NOTE_PREFIX = 'Demo baseline';
const BASELINE_NOTE_LIKE = `${BASELINE_NOTE_PREFIX}%`;
const uid = (name: string, value: string): QueryInput => ({ name, type: sql.UniqueIdentifier, value });
const str = (name: string, value: string | null, len = 200): QueryInput => ({ name, type: sql.NVarChar(len), value });
const int = (name: string, value: number | null): QueryInput => ({ name, type: sql.Int, value });
const dec = (name: string, value: number | null): QueryInput => ({ name, type: sql.Decimal(5, 2), value });

/**
 * Presenter tooling for the hackathon demo (Maya Rivera six-course scenario + the learning-loop second student).
 *
 * Why TypeScript and not a stored procedure (the alternative was migration 025 + sp_SeedMayaScenario):
 * there is no SQL Server in the build sandbox, so neither can be run before it ships. A proc would add a
 * migration that has to be applied by hand before the button works, would be a third copy of the data to keep in
 * step with seed 015, and a compile error in it would only show up at apply time. In TypeScript the statements are
 * parameterised single inserts, optional columns (migrations 013/015/022) are checked with SchemaService so the tool
 * degrades instead of failing, and the data/derivation are unit-testable (scripts/test-demo-scenario.ts).
 * The reset runs on ONE pinned connection in ONE transaction: any failure rolls back, the old scenario stays.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private db: DatabaseService,
    private schema: SchemaService,
    private transcripts: TranscriptsService,
    private uploads: UploadsService,
    private demoDocuments: DemoDocumentsService,
    private progress: ProgressService,
  ) {}

  // ── status ─────────────────────────────────────────────────

  async status() {
    const maya = await this.userByEmail(MAYA_EMAIL);
    const catalogue = await this.db.query<{ N: number }>(
      `SELECT COUNT(*) AS N FROM Courses c JOIN Institutions i ON i.Id = c.InstitutionId
       WHERE (i.Code = 'BSCC' AND c.Code IN ('CSC 110','MAT 210','ECO 101','CSC 220','CSC 240')) OR (i.Code = 'PVTC' AND c.Code = 'CIS 150')`);
    const catalogueReady = (catalogue.recordset[0]?.N ?? 0) >= 6;
    const workflowReady = await this.schema.has('TranscriptStages');

    let courses: Array<DemoCourseFact & { title: string; grade: string; outcome: string | null; awardedCredits: number | null; decidedBuCode: string | null; sortOrder: number }> = [];
    let transcripts: Array<{ id: string; institutionCode: string; institutionName: string; status: string; workflowStatus: string | null; currentStage: string | null }> = [];
    if (maya) {
      const rows = await this.db.query(
        `SELECT t.Id AS TranscriptId, i.Code AS InstCode, tc.CourseCode, tc.CourseTitle, tc.Grade, tc.Lane, tc.Status, tc.OriginalCredits, tc.NormalisedCredits,
                tc.SortOrder, e.Status AS EvalStatus, e.Outcome, e.AwardedCredits, bu.Code AS DecidedBuCode
         FROM Transcripts t
         JOIN Institutions i ON i.Id = t.InstitutionId
         JOIN TranscriptCourses tc ON tc.TranscriptId = t.Id
         LEFT JOIN Evaluations e ON e.TranscriptCourseId = tc.Id
         LEFT JOIN Courses bu ON bu.Id = e.DecidedBUCourseId
         WHERE t.StudentUserId = @s AND t.Notes LIKE @n
         ORDER BY i.Code, tc.SortOrder`,
        [uid('s', maya.id), str('n', NOTE_LIKE)],
      );
      courses = rows.recordset.map((r: any) => ({
        transcriptId: r.TranscriptId, institutionCode: r.InstCode, code: r.CourseCode, title: r.CourseTitle, grade: r.Grade,
        lane: r.Lane, status: r.Status, evalStatus: r.EvalStatus ?? null, originalCredits: Number(r.OriginalCredits),
        normalisedCredits: r.NormalisedCredits == null ? null : Number(r.NormalisedCredits),
        outcome: r.Outcome ?? null, awardedCredits: r.AwardedCredits == null ? null : Number(r.AwardedCredits),
        decidedBuCode: r.DecidedBuCode ?? null, sortOrder: r.SortOrder,
      }));
      const wfCols = (await this.schema.has('Transcripts', 'WorkflowStatus')) && workflowReady;
      const tr = await this.db.query(
        wfCols
          ? `SELECT t.Id, t.Status, t.WorkflowStatus, i.Code AS InstCode, i.Name AS InstName,
                    (SELECT TOP 1 ts.StageName FROM TranscriptStages ts WHERE ts.TranscriptId = t.Id AND ts.Status = 'active' ORDER BY ts.StageOrder) AS StageName
             FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId
             WHERE t.StudentUserId = @s AND t.Notes LIKE @n ORDER BY i.Code`
          : `SELECT t.Id, t.Status, NULL AS WorkflowStatus, i.Code AS InstCode, i.Name AS InstName, NULL AS StageName
             FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId
             WHERE t.StudentUserId = @s AND t.Notes LIKE @n ORDER BY i.Code`,
        [uid('s', maya.id), str('n', NOTE_LIKE)],
      );
      transcripts = tr.recordset.map((r: any) => ({
        id: r.Id, institutionCode: r.InstCode, institutionName: r.InstName, status: r.Status,
        workflowStatus: r.WorkflowStatus ?? null, currentStage: r.StageName ?? null,
      }));
    }

    const csc220 = await this.equivalencyFor('BSCC', 'CSC 220');
    const equivalencies = {
      csc220: csc220,
      csc240: await this.equivalencyFor('BSCC', 'CSC 240'),
      cis150: await this.equivalencyFor('PVTC', 'CIS 150'),
    };

    const second = await this.secondStudentFact();
    const derived = deriveDemoState({
      courses, csc220EquivalencyExists: !!csc220, secondStudent: second ? { transcriptId: second.transcriptId, lane: second.lane } : null,
    });

    return {
      scenarioPresent: derived.present,
      catalogueReady,
      workflowReady,
      student: maya ? { id: maya.id, name: `${maya.first} ${maya.last}`, email: MAYA_EMAIL } : null,
      transcripts,
      courses,
      equivalencies,
      secureCredits: derived.secureCredits,
      steps: derived.steps,
      learningLoop: derived.learningLoop,
      secondStudent: second,
    };
  }

  private async userByEmail(email: string) {
    const r = await this.db.query<{ Id: string; FirstName: string; LastName: string }>(
      `SELECT Id, FirstName, LastName FROM Users WHERE Email = @e`, [str('e', email, 254)]);
    const u = r.recordset[0];
    return u ? { id: u.Id, first: u.FirstName, last: u.LastName } : null;
  }

  /** Equivalency (active, not expired) for an external demo course, or null. */
  private async equivalencyFor(inst: string, code: string) {
    const expiry = (await this.schema.has('Equivalencies', 'EffectiveTo')) ? `AND (eq.EffectiveTo IS NULL OR eq.EffectiveTo >= CAST(SYSUTCDATETIME() AS DATE))` : '';
    const r = await this.db.query(
      `SELECT TOP 1 bu.Code AS BuCode, eq.Outcome, eq.BUCredits, eq.Source
       FROM Equivalencies eq JOIN Courses c ON c.Id = eq.ExternalCourseId JOIN Institutions i ON i.Id = c.InstitutionId
       JOIN Courses bu ON bu.Id = eq.BUCourseId
       WHERE i.Code = @i AND c.Code = @c AND eq.IsActive = 1 ${expiry} ORDER BY eq.CreatedAt DESC`,
      [str('i', inst, 20), str('c', code, 30)],
    );
    const e = r.recordset[0];
    return e ? { buCode: e.BuCode as string, outcome: e.Outcome as string, credits: e.BUCredits == null ? null : Number(e.BUCredits), source: e.Source as string } : null;
  }

  private async secondStudentFact() {
    const noah = await this.userByEmail(NOAH_EMAIL);
    if (!noah) return null;
    const r = await this.db.query(
      `SELECT TOP 1 t.Id, t.Status, tc.Lane, tc.Status AS CourseStatus
       FROM Transcripts t LEFT JOIN TranscriptCourses tc ON tc.TranscriptId = t.Id
       WHERE t.StudentUserId = @s AND t.Notes LIKE @n ORDER BY t.ReceivedAt DESC`,
      [uid('s', noah.id), str('n', NOTE_LIKE)],
    );
    const t = r.recordset[0];
    if (!t) return null;
    return {
      studentId: noah.id, name: `${noah.first} ${noah.last}`, email: NOAH_EMAIL,
      transcriptId: t.Id as string, status: t.Status as string, lane: (t.Lane ?? null) as string | null,
      courseStatus: (t.CourseStatus ?? null) as string | null, autoApplied: t.Lane === 'applied',
    };
  }

  // ── reset ──────────────────────────────────────────────────

  async resetMaya(actor: Actor) {
    const maya = await this.userByEmail(MAYA_EMAIL);
    if (!maya) throw new ConflictException('student@test.edu does not exist - run seeds 001-003 first.');
    const bu = await this.idOf(`SELECT Id FROM Institutions WHERE Code = 'BU'`);
    if (!bu) throw new ConflictException('Institution BU is missing - run seed 001 first.');
    const s = await this.status();
    if (!s.catalogueReady) throw new ConflictException('The BSCC/PVTC demo catalogue is missing - apply database/seed/015_demo_maya_scenario.sql first.');

    const flags = {
      policyCols: await this.schema.has('TranscriptCourses', 'GradingBasis'),
      workflow: (await this.schema.has('TranscriptStages')) && (await this.schema.has('Transcripts', 'WorkflowId')),
      notes: await this.schema.has('TranscriptNotes'),
      reminders: await this.schema.has('StatusReminders'),
      appeals: await this.schema.has('CourseAppeals'),
      exchange: await this.schema.exchangeReady(),
      usage: await this.schema.has('AiUsageLog'),
      uploadsTranscript: await this.schema.has('Uploads', 'TranscriptId'),
      effective: await this.schema.has('Equivalencies', 'EffectiveTo'),
      mappings: await this.schema.has('EvaluationCourseMappings'),
    };

    const result = await this.db.transaction(async (run) => {
      const removed = await this.removeDemoRows(run, maya.id, flags);
      const restored = await this.restoreKnownEquivalencies(run, bu);
      const created = await this.createScenario(run, maya.id, bu, flags);
      return { ...removed, knownEquivalenciesRestored: restored, transcripts: created };
    });

    // Documents are a presenter convenience, not the core reset: generate them in their own step, after
    // the scenario is already committed, so a documents problem never rolls back (or blocks) the reset itself.
    let documents: { message: string; transcriptDocsAttached: number; studentDocsAttached: number };
    try {
      documents = await this.attachRequiredDocuments(maya.id, result.transcripts);
    } catch (err) {
      const message = `Documents could not be generated/attached: ${(err as Error).message}`;
      this.logger.warn(message);
      documents = { message, transcriptDocsAttached: 0, studentDocsAttached: 0 };
    }

    await this.audit(actor, 'DEMO_MAYA_RESET', 'Demo', { ...result, documents });
    this.logger.log(`Maya demo scenario reset by ${actor.email}: ${JSON.stringify({ ...result, documents })}`);
    return {
      message: `Maya scenario reset. Six courses are back at upload state. ${documents.message}`,
      ...result,
      documents,
      status: await this.status(),
    };
  }

  /**
   * Wipes EVERY transcript/course/evaluation/document Maya has and recreates nothing - unlike `resetMaya`,
   * which rebuilds the scripted six-course scenario. For when the live walkthrough itself will build her
   * curriculum from scratch (via `buildBaseline` and/or Smart Upload), so nothing scripted is left to
   * contradict whatever the presenter drops on stage. Her account/profile are untouched; the catalogue's
   * baseline equivalencies are restored so an uploaded document can still auto-match during the demo.
   */
  async hardReset(actor: Actor) {
    const maya = await this.userByEmail(MAYA_EMAIL);
    if (!maya) throw new ConflictException('student@test.edu does not exist - run seeds 001-003 first.');
    const bu = await this.idOf(`SELECT Id FROM Institutions WHERE Code = 'BU'`);
    if (!bu) throw new ConflictException('Institution BU is missing - run seed 001 first.');

    const flags = {
      notes: await this.schema.has('TranscriptNotes'),
      reminders: await this.schema.has('StatusReminders'),
      appeals: await this.schema.has('CourseAppeals'),
      exchange: await this.schema.exchangeReady(),
      usage: await this.schema.has('AiUsageLog'),
      uploadsTranscript: await this.schema.has('Uploads', 'TranscriptId'),
      workflow: (await this.schema.has('TranscriptStages')) && (await this.schema.has('Transcripts', 'WorkflowId')),
      mappings: await this.schema.has('EvaluationCourseMappings'),
    };

    const result = await this.db.transaction(async (run) => {
      const removed = await this.removeDemoRows(run, maya.id, flags);
      const restored = await this.restoreKnownEquivalencies(run, bu);
      return { ...removed, knownEquivalenciesRestored: restored };
    });

    await this.audit(actor, 'DEMO_MAYA_HARD_RESET', 'Demo', result);
    this.logger.log(`Maya hard reset by ${actor.email}: ${JSON.stringify(result)}`);
    return {
      message: `Everything wiped: ${result.transcriptsRemoved} request(s) and ${result.equivalenciesRemoved} decision-made equivalenc${result.equivalenciesRemoved === 1 ? 'y' : 'ies'} removed. Maya has no courses or documents left - build her curriculum from here (Build baseline, Demo documents, or Smart Upload live).`,
      ...result,
      status: await this.status(),
    };
  }

  /**
   * Gives Maya a real transcript, right away, built from REAL catalogue courses that already have an
   * active equivalency to a BU course - so `sp_TriageCourse` auto-applies them on submission and they show
   * as Secured immediately, with no reviewer needed. Meant to be run once before the demo (after `hardReset`)
   * so the dashboard already shows a solid credit position; the live walkthrough then adds to it (Smart
   * Upload / Submit transcript) on top. Never touches BSCC/PVTC (that is the scripted six-course scenario).
   */
  async buildBaseline(actor: Actor, opts: { targetCredits?: number; institutionCode?: string } = {}) {
    const maya = await this.userByEmail(MAYA_EMAIL);
    if (!maya) throw new ConflictException('student@test.edu does not exist - run seeds 001-003 first.');
    const targetCredits = opts.targetCredits && opts.targetCredits > 0 ? opts.targetCredits : 30;

    const instRes = await this.db.query<{ Id: number; Code: string; Name: string; Calendar: string | null }>(
      opts.institutionCode
        ? `SELECT TOP 1 Id, Code, Name, Calendar FROM Institutions WHERE Code = @c`
        : `SELECT TOP 1 i.Id, i.Code, i.Name, i.Calendar
           FROM Institutions i
           WHERE i.Code NOT IN ('BU', 'BSCC', 'PVTC') AND i.IsActive = 1
             AND EXISTS (SELECT 1 FROM Equivalencies eq JOIN Courses c ON c.Id = eq.ExternalCourseId WHERE c.InstitutionId = i.Id AND eq.IsActive = 1 AND eq.Outcome = 'equivalent')
           ORDER BY (SELECT COUNT(*) FROM Equivalencies eq JOIN Courses c ON c.Id = eq.ExternalCourseId WHERE c.InstitutionId = i.Id AND eq.IsActive = 1 AND eq.Outcome = 'equivalent') DESC`,
      opts.institutionCode ? [str('c', opts.institutionCode.toUpperCase(), 20)] : [],
    );
    const inst = instRes.recordset[0];
    if (!inst) throw new ConflictException(opts.institutionCode ? `${opts.institutionCode} has no active equivalencies to build from.` : 'No institution with existing equivalencies was found to build a baseline from.');

    const courseRes = await this.db.query<{ Code: string; Title: string; Credits: number; BuCredits: number | null }>(
      `SELECT c.Code, c.Title, c.Credits, eq.BUCredits
       FROM Courses c JOIN Equivalencies eq ON eq.ExternalCourseId = c.Id
       WHERE c.InstitutionId = @inst AND eq.IsActive = 1 AND eq.Outcome = 'equivalent'
         AND (eq.EffectiveTo IS NULL OR eq.EffectiveTo >= CAST(SYSUTCDATETIME() AS DATE))
       ORDER BY ISNULL(eq.BUCredits, c.Credits) DESC`,
      [int('inst', inst.Id)],
    );
    if (!courseRes.recordset.length) throw new ConflictException(`${inst.Code} has no usable equivalencies.`);

    const picked: Array<{ Code: string; Title: string; Credits: number; BuCredits: number | null }> = [];
    let sum = 0;
    const seen = new Set<string>();
    for (const r of courseRes.recordset) {
      if (sum >= targetCredits) break;
      if (seen.has(r.Code)) continue; // a course can have more than one equivalency row; take its first
      seen.add(r.Code);
      picked.push(r);
      sum += Number(r.BuCredits ?? r.Credits);
    }

    // Repeatable: drop an earlier baseline at this same institution first, like the second-student flow does.
    const old = await this.db.query<{ Id: string }>(
      `SELECT Id FROM Transcripts WHERE StudentUserId = @s AND Notes LIKE @n AND InstitutionId = @inst`,
      [uid('s', maya.id), str('n', BASELINE_NOTE_LIKE), int('inst', inst.Id)],
    );
    for (const t of old.recordset) await this.deleteTranscript(t.Id);

    const submitted: any = await this.transcripts.submit(
      {
        institutionName: inst.Name,
        institutionCode: inst.Code,
        calendar: inst.Calendar === 'quarter' ? 'quarter' : 'semester',
        notes: `${BASELINE_NOTE_PREFIX}: built before the demo from ${inst.Code}'s real catalogue + existing equivalencies, so it is secured on submission.`,
        courses: picked.map((c) => ({
          courseCode: c.Code, courseTitle: c.Title, originalCredits: Number(c.Credits),
          grade: 'A-', term: 'Fall 2025', termSeason: 'fall', termYear: 2025,
          gradingBasis: 'graded', deliveryMode: 'in_person', courseType: 'lecture', isOutsideUS: false,
        })),
      },
      maya.id,
      'student',
    );

    const appliedCount = Array.isArray(submitted?.courses) ? submitted.courses.filter((c: { lane?: string }) => c.lane === 'applied').length : 0;
    const progress = await this.progress.build(maya.id).catch(() => null);
    const securedNow = progress ? progress.totals.secure : null;

    const result = {
      institution: { code: inst.Code, name: inst.Name },
      transcriptId: submitted?.id as string,
      coursesSubmitted: picked.length,
      coursesAutoApplied: appliedCount,
      securedCreditsOverall: securedNow,
    };
    await this.audit(actor, 'DEMO_MAYA_BUILD_BASELINE', 'Demo', result);
    this.logger.log(`Maya baseline built by ${actor.email}: ${JSON.stringify(result)}`);
    return {
      message: securedNow != null
        ? `Submitted ${picked.length} ${inst.Code} course(s); ${appliedCount} matched an existing equivalency and applied at once. Maya now shows ${securedNow} secured credit(s) overall.`
        : `Submitted ${picked.length} ${inst.Code} course(s); ${appliedCount} applied at once.`,
      ...result,
      status: await this.status(),
    };
  }

  private async idOf(query: string, inputs: QueryInput[] = []): Promise<number | null> {
    const r = await this.db.query<{ Id: number }>(query, inputs);
    return r.recordset[0]?.Id ?? null;
  }

  /**
   * Deletes EVERY transcript/request Maya has - not just the ones the demo scenario itself created - plus
   * their dependents, and the equivalencies the presenter's decisions wrote. The presenter may have submitted
   * or uploaded something manually while rehearsing; "reset" means Maya goes back to a clean slate regardless
   * of how a stray request got there, not just that the scripted demo rows are put back.
   */
  private async removeDemoRows(
    run: Run,
    studentId: string,
    f: { notes: boolean; reminders: boolean; appeals: boolean; exchange: boolean; usage: boolean; uploadsTranscript: boolean; workflow: boolean; mappings: boolean },
  ): Promise<{ transcriptsFound: number; transcriptsRemoved: number; equivalenciesRemoved: number }> {
    const demoIds = `SELECT Id FROM Transcripts WHERE StudentUserId = @s`;
    const n = [uid('s', studentId)];
    const cnt = async (q: string) => (await run(q, n)).rowsAffected.reduce((a, b) => a + b, 0);
    const out: Record<string, number> = {};

    out.transcriptsFound = (await run<{ N: number }>(`SELECT COUNT(*) AS N FROM Transcripts WHERE StudentUserId = @s`, n)).recordset[0].N;
    if (f.appeals) await run(`DELETE FROM CourseAppeals WHERE TranscriptId IN (${demoIds})`, n);
    if (f.exchange) {
      await run(`DELETE FROM PartyReminders WHERE TranscriptId IN (${demoIds})`, n);
      await run(`DELETE FROM DocumentRequests WHERE TranscriptId IN (${demoIds})`, n);
    }
    if (f.reminders) await run(`DELETE FROM StatusReminders WHERE TranscriptId IN (${demoIds})`, n);
    if (f.notes) await run(`DELETE FROM TranscriptNotes WHERE TranscriptId IN (${demoIds})`, n);
    if (f.workflow) await run(`DELETE FROM TranscriptStages WHERE TranscriptId IN (${demoIds})`, n);
    if (f.usage) await run(`DELETE FROM AiUsageLog WHERE TranscriptId IN (${demoIds})`, n);
    if (f.uploadsTranscript) await run(`DELETE FROM Uploads WHERE TranscriptId IN (${demoIds})`, n);
    await run(`DELETE FROM Uploads WHERE EntityType IN ('transcript', 'transcript_document') AND EntityId IN (SELECT CAST(Id AS NVARCHAR(100)) FROM Transcripts WHERE StudentUserId = @s)`, n);
    // Student-level documents (ID/English test/enrollment letter from an earlier reset or a real smart upload)
    // also go, so the attach step below never piles duplicates on top of what a previous run left behind.
    await run(`DELETE FROM Uploads WHERE OwnerUserId = @s AND EntityType = 'smart_upload'`, n);
    if (await this.schema.has('DocumentIntakes')) await run(`DELETE FROM DocumentIntakes WHERE UserId = @s`, n);

    // EvaluationCourseMappings (migration 026, one-to-many decisions) has no ON DELETE CASCADE from either
    // TranscriptCourses or Evaluations - left in place, deleting Transcripts below fails with a FK violation
    // (SQL error 547, surfaced as a 500) the moment Maya has even one multi-course decision on record.
    if (f.mappings) {
      await run(
        `DELETE FROM EvaluationCourseMappings WHERE TranscriptCourseId IN (SELECT tc.Id FROM TranscriptCourses tc WHERE tc.TranscriptId IN (${demoIds}))`,
        n,
      );
    }
    const evalIds = `SELECT e.Id FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId WHERE tc.TranscriptId IN (${demoIds})`;
    await run(`DELETE FROM AIMatchCandidates WHERE EvaluationId IN (${evalIds})`, n);
    await run(`DELETE FROM Evaluations WHERE TranscriptCourseId IN (SELECT tc.Id FROM TranscriptCourses tc WHERE tc.TranscriptId IN (${demoIds}))`, n);
    // TranscriptCourses / Syllabi / TranscriptDocuments cascade from Transcripts.
    out.transcriptsRemoved = await cnt(`DELETE FROM Transcripts WHERE StudentUserId = @s`);

    // Equivalencies created by decisions on the three demo courses only; seed-written ones (synthetic/workbook) stay.
    let eqRemoved = 0;
    for (let i = 0; i < DEMO_DECISION_COURSES.length; i++) {
      const d = DEMO_DECISION_COURSES[i];
      const srcList = SEED_EQUIVALENCY_SOURCES.map((_, k) => `@src${k}`).join(',');
      const inputs: QueryInput[] = [str('i', d.institutionCode, 20), str('c', d.code, 30), ...SEED_EQUIVALENCY_SOURCES.map((v, k) => str(`src${k}`, v, 20))];
      const r = await run(
        `DELETE FROM Equivalencies WHERE Source NOT IN (${srcList}) AND ExternalCourseId IN
           (SELECT c.Id FROM Courses c JOIN Institutions ins ON ins.Id = c.InstitutionId WHERE ins.Code = @i AND c.Code = @c)`,
        inputs,
      );
      eqRemoved += r.rowsAffected.reduce((a, b) => a + b, 0);
    }
    out.equivalenciesRemoved = eqRemoved;
    return out as { transcriptsFound: number; transcriptsRemoved: number; equivalenciesRemoved: number };
  }

  /** Re-adds the three "existing" equivalencies if someone deactivated/deleted them. Never touches others. */
  private async restoreKnownEquivalencies(run: Run, buId: number): Promise<number> {
    let added = 0;
    for (const k of KNOWN_EQUIVALENCIES) {
      const r = await run(
        `INSERT INTO Equivalencies (ExternalCourseId, BUCourseId, Outcome, BUCredits, MatchLevel, Rationale, Source, DecidedAt)
         SELECT ext.Id, bu.Id, 'equivalent', @cr, 'Likely equivalent', @why, 'synthetic', SYSUTCDATETIME()
         FROM Courses ext JOIN Institutions ei ON ei.Id = ext.InstitutionId AND ei.Code = 'BSCC'
         JOIN Courses bu ON bu.InstitutionId = @bu AND bu.Code = @buCode
         WHERE ext.Code = @ext
           AND NOT EXISTS (SELECT 1 FROM Equivalencies eq WHERE eq.ExternalCourseId = ext.Id AND eq.BUCourseId = bu.Id AND eq.IsActive = 1)`,
        [str('ext', k.ext, 30), str('buCode', k.bu, 30), int('bu', buId), dec('cr', k.credits), str('why', k.why, 1000)],
      );
      added += r.rowsAffected[0] ?? 0;
    }
    return added;
  }

  /** Same rows seed 015 section 3 inserts: transcripts, courses (lanes as triage leaves them), evaluations, candidates, stages. */
  private async createScenario(run: Run, studentId: string, buId: number, f: { policyCols: boolean; workflow: boolean; notes: boolean }) {
    const wfRes = f.workflow
      ? await run<{ Id: number }>(
          `SELECT ISNULL(
             (SELECT TOP 1 Id FROM WorkflowDefinitions WHERE InstitutionId = @bu AND IsActive = 1),
             (SELECT TOP 1 Id FROM WorkflowDefinitions WHERE InstitutionId IS NULL AND IsActive = 1)) AS Id`, [int('bu', buId)])
      : null;
    const wfId: number | null = wfRes?.recordset[0]?.Id ?? null;
    const created: Array<{ id: string; institution: string; courses: number }> = [];

    for (const t of DEMO_TRANSCRIPTS) {
      const inst = await run<{ Id: number }>(`SELECT Id FROM Institutions WHERE Code = @c`, [str('c', t.institutionCode, 20)]);
      const instId = inst.recordset[0]?.Id;
      if (!instId) throw new ConflictException(`Institution ${t.institutionCode} is missing - run seed 001.`);
      const tid = randomUUID();

      const cols = wfId
        ? `, TargetInstitutionId, WorkflowId, WorkflowStatus, CurrentStageOrder`
        : '';
      const vals = wfId ? `, @bu, @wf, 'active', 3` : '';
      const tInputs: QueryInput[] = [uid('id', tid), uid('s', studentId), int('inst', instId), str('notes', t.notes, 4000)];
      if (wfId) tInputs.push(int('bu', buId), int('wf', wfId));
      await run(
        `INSERT INTO Transcripts (Id, StudentUserId, SubmittedById, InstitutionId, Status, Notes, ReceivedAt${cols})
         VALUES (@id, @s, @s, @inst, 'processing', @notes, DATEADD(DAY, -2, SYSUTCDATETIME())${vals})`,
        tInputs,
      );

      let sort = 0;
      for (const c of t.courses) {
        sort++;
        const tcId = randomUUID();
        const quarter = t.key === 'pvtc';
        const normalised = quarter ? Math.floor(((c.credits * 2) / 3) * 100) / 100 : c.credits;
        await run(
          `INSERT INTO TranscriptCourses (Id, TranscriptId, CourseCode, CourseTitle, ExternalCourseId, OriginalCredits, NormalisedCredits, Grade, GradeIsEligible, Term, Lane, Status, SortOrder)
           SELECT @id, @t, @code, @title, c.Id, @oc, @nc, @grade, 1, @term, @lane, 'pending', @sort
           FROM Courses c WHERE c.InstitutionId = @inst AND c.Code = @code`,
          [uid('id', tcId), uid('t', tid), str('code', c.code, 50), str('title', c.title, 300), dec('oc', c.credits), dec('nc', normalised),
           str('grade', c.grade, 10), str('term', c.term, 50), str('lane', c.lane, 30), int('sort', sort), int('inst', instId)],
        );
        if (f.policyCols) {
          await run(`UPDATE TranscriptCourses SET GradingBasis = 'graded', DeliveryMode = 'in_person', CourseType = 'lecture', IsOutsideUS = 0 WHERE Id = @id`, [uid('id', tcId)]);
        }
        const sug = DEMO_SUGGESTIONS[c.code];
        if (c.lane === 'needs_syllabus' && sug) {
          const evId = randomUUID();
          await run(
            `INSERT INTO Evaluations (Id, TranscriptCourseId, Status, AISuggestedCourseId, AIConfidence, AIRationale)
             SELECT @ev, @tc, 'in_progress', bu.Id, @conf, @why FROM Courses bu WHERE bu.InstitutionId = @bu AND bu.Code = @buCode`,
            [uid('ev', evId), uid('tc', tcId), { name: 'conf', type: sql.Decimal(5, 4), value: sug.confidence }, str('why', '[Built-in rules] ' + sug.why, 4000), int('bu', buId), str('buCode', sug.buCode, 30)],
          );
          for (const k of sug.candidates) {
            await run(
              `INSERT INTO AIMatchCandidates (EvaluationId, Rank, BUCourseId, Score, Rationale)
               SELECT @ev, @rank, bu.Id, @score, @why FROM Courses bu WHERE bu.InstitutionId = @bu AND bu.Code = @buCode`,
              [uid('ev', evId), int('rank', k.rank), { name: 'score', type: sql.Decimal(5, 4), value: k.score }, str('why', '[Built-in rules] ' + k.why, 4000), int('bu', buId), str('buCode', k.buCode, 30)],
            );
          }
        }
      }

      if (wfId) {
        await run(
          `INSERT INTO TranscriptStages (TranscriptId, WorkflowStageId, StageOrder, StageKey, StageName, StageType, AgentTask, Status, ActivatedAt, DueAt, CompletedAt)
           SELECT @t, s.Id, s.Ord, s.StageKey, s.Name, s.StageType, s.AgentTask,
                  CASE WHEN s.Ord <= 2 THEN 'approved' WHEN s.Ord = 3 THEN 'active' ELSE 'pending' END,
                  CASE WHEN s.Ord <= 3 THEN DATEADD(DAY, -2, SYSUTCDATETIME()) END,
                  CASE WHEN s.Ord = 3 AND s.SlaDays IS NOT NULL THEN DATEADD(DAY, s.SlaDays - 2, SYSUTCDATETIME()) END,
                  CASE WHEN s.Ord <= 2 THEN DATEADD(DAY, -2, SYSUTCDATETIME()) END
           FROM (SELECT ws.Id, ws.StageKey, ws.Name, ws.StageType, ws.AgentTask, ws.SlaDays, ROW_NUMBER() OVER (ORDER BY ws.StageOrder) AS Ord
                 FROM WorkflowStages ws WHERE ws.WorkflowId = @wf AND ws.IsEnabled = 1) s`,
          [uid('t', tid), int('wf', wfId)],
        );
        if (f.notes) {
          await run(
            `INSERT INTO TranscriptNotes (TranscriptId, TranscriptStageId, Audience, Kind, Body)
             SELECT ts.TranscriptId, ts.Id, 'student', 'system', 'Your request is now in "' + ts.StageName + '".'
             FROM TranscriptStages ts WHERE ts.TranscriptId = @t AND ts.Status = 'active'`,
            [uid('t', tid)],
          );
        }
      }
      created.push({ id: tid, institution: t.institutionCode, courses: t.courses.length });
    }
    return created;
  }

  // ── required documents (so the presenter never has to upload anything live) ────────

  /**
   * Generates and attaches the documents Maya's fresh requests would actually need, using the same
   * synthetic-but-deterministic renderers as the "Demo documents" tool (`DemoDocumentsService`/
   * `demo-documents.ts`), built FROM the scenario just created (so course codes/titles/terms on the
   * paperwork match what's on screen):
   *  - A transcript PDF per source college, attached to that college's own request (`TranscriptDocuments`,
   *    docTypeKey 'transcript') - always needed, whatever the applicant type.
   *  - A syllabus PDF for each course the scenario put in a review lane (CSC 220, CSC 240, CIS 150 -
   *    see `DEMO_TRANSCRIPTS`), attached to that course (`TranscriptDocuments`, docTypeKey 'syllabus',
   *    TranscriptCourseId set) - exactly the courses whose checklist actually asks for one.
   *  - Maya's own ID and an enrolment letter, plus an English test report only if her profile says she
   *    is not a native speaker, saved as already-`confirmed` Smart Upload documents (`DocumentIntakes`)
   *    so they show up under My Documents with nothing left to review.
   * Runs AFTER the reset transaction commits (uploads write to blob storage, not the DB transaction), so
   * a failure here is reported but never undoes the scenario reset itself - see resetMaya's try/catch.
   */
  private async attachRequiredDocuments(studentId: string, created: Array<{ id: string; institution: string; courses: number }>) {
    const hasTranscriptDocs = await this.schema.has('TranscriptDocuments');
    const hasIntakes = await this.schema.has('DocumentIntakes');
    if (!hasTranscriptDocs && !hasIntakes) {
      return { message: 'No documents were attached (the document tables are not migrated yet).', transcriptDocsAttached: 0, studentDocsAttached: 0 };
    }

    const loaded = await this.demoDocuments.load(studentId);
    if (!loaded) return { message: 'No documents were attached (student not found).', transcriptDocsAttached: 0, studentDocsAttached: 0 };
    const { student } = loaded;

    const toFile = (d: GeneratedDoc): UploadedFileLike => ({ originalname: d.fileName, buffer: d.bytes, mimetype: 'application/pdf', size: d.bytes.length });
    const attachToTranscript = async (doc: GeneratedDoc, transcriptId: string, transcriptCourseId: string | null) => {
      const saved = await this.uploads.save(toFile(doc), {
        ownerUserId: studentId, role: 'student', entityType: 'transcript_document', entityId: transcriptId, isPublic: false, documentType: doc.docType,
      });
      await this.db.query(
        `INSERT INTO TranscriptDocuments (TranscriptId, TranscriptCourseId, DocTypeKey, UploadId, FileName, Notes, CreatedBy)
         VALUES (@t, @c, @k, @u, @f, @n, @by)`,
        [
          uid('t', transcriptId), { name: 'c', type: sql.UniqueIdentifier, value: transcriptCourseId }, str('k', doc.docType, 40),
          uid('u', saved.id), str('f', doc.fileName, 300), str('n', 'Generated by Reset Maya scenario (Demo documents).', 500), uid('by', studentId),
        ],
      );
    };

    let transcriptDocsAttached = 0;
    if (hasTranscriptDocs) {
      // 1. One transcript document per source college.
      for (const college of loaded.colleges) {
        const transcriptId = created.find((c) => c.institution === college.institution.code)?.id;
        if (!transcriptId) continue;
        const [doc] = await buildStudentDocuments(student, [college], ['transcript']);
        if (doc) { await attachToTranscript(doc, transcriptId, null); transcriptDocsAttached++; }
      }

      // 2. A syllabus for each course the scenario itself put in a review lane.
      for (const t of DEMO_TRANSCRIPTS) {
        const transcriptId = created.find((c) => c.institution === t.institutionCode)?.id;
        const college = loaded.colleges.find((c) => c.institution.code === t.institutionCode);
        if (!transcriptId || !college) continue;
        for (const c of t.courses) {
          if (c.lane !== 'needs_syllabus') continue;
          const course = college.courses.find((x) => x.code === c.code);
          if (!course) continue;
          const tc = await this.db.query<{ Id: string }>(
            `SELECT TOP 1 Id FROM TranscriptCourses WHERE TranscriptId = @t AND CourseCode = @c`,
            [uid('t', transcriptId), str('c', c.code, 50)],
          );
          const tcId = tc.recordset[0]?.Id;
          if (!tcId) continue;
          const [doc] = await buildStudentDocuments(student, [{ institution: college.institution, courses: [course] }], ['syllabus']);
          if (doc) { await attachToTranscript(doc, transcriptId, tcId); transcriptDocsAttached++; }
        }
      }
    }

    let studentDocsAttached = 0;
    if (hasIntakes) {
      const kinds: DemoDocKind[] = ['id_document', 'enrollment_letter', ...(student.english ? (['english_test'] as const) : [])];
      const docs = await buildStudentDocuments(student, loaded.colleges as DocCollegeRecord[], kinds);
      for (const doc of docs) {
        const saved = await this.uploads.save(toFile(doc), {
          ownerUserId: studentId, role: 'student', entityType: 'smart_upload', isPublic: false, documentType: doc.docType,
        });
        await this.db.query(
          `INSERT INTO DocumentIntakes (UserId, UploadId, OriginalFileName, MimeType, Status, DocType, Summary, ReadAt, ConfirmedAt)
           VALUES (@u, @up, @n, 'application/pdf', 'confirmed', @dt, @s, SYSUTCDATETIME(), SYSUTCDATETIME())`,
          [
            uid('u', studentId), uid('up', saved.id), str('n', doc.fileName, 300), str('dt', doc.docType, 40),
            str('s', 'Generated and pre-confirmed by Reset Maya scenario (Demo documents).', 500),
          ],
        );
        studentDocsAttached++;
      }
    }

    const parts = [transcriptDocsAttached ? `${transcriptDocsAttached} request document(s)` : null, studentDocsAttached ? `${studentDocsAttached} personal document(s)` : null];
    const message = parts.some(Boolean) ? `Attached ${parts.filter(Boolean).join(' and ')}.` : 'No documents were attached (nothing applied to this student).';
    return { message, transcriptDocsAttached, studentDocsAttached };
  }

  // ── second student (learning loop) ─────────────────────────

  /** Creates (or reuses) Noah Chen and submits a one-course BSCC transcript through the real submit path. */
  async addSecondStudent(actor: Actor) {
    const eq = await this.equivalencyFor('BSCC', 'CSC 220');
    const noahId = await this.ensureNoah();

    // Repeatable: drop Noah's earlier demo request first.
    const old = await this.db.query<{ Id: string }>(`SELECT Id FROM Transcripts WHERE StudentUserId = @s AND Notes LIKE @n`, [uid('s', noahId), str('n', NOTE_LIKE)]);
    for (const t of old.recordset) await this.deleteTranscript(t.Id);

    const c = NOAH.course;
    const submitted: any = await this.transcripts.submit({
      institutionName: NOAH.institutionName, institutionCode: NOAH.institutionCode, calendar: 'semester',
      notes: NOAH.notes,
      courses: [{
        courseCode: c.code, courseTitle: c.title, originalCredits: c.credits, grade: c.grade, term: c.term,
        termSeason: c.termSeason, termYear: c.termYear, gradingBasis: 'graded', deliveryMode: 'in_person', courseType: 'lecture', isOutsideUS: false,
      }],
    }, noahId, 'student');

    const course = submitted?.courses?.[0];
    const lane: string | null = course?.lane ?? null;
    const autoApplied = lane === 'applied';
    const result = {
      transcriptId: submitted?.id as string,
      lane,
      autoApplied,
      equivalencyExisted: !!eq,
      message: autoApplied
        ? 'Learning loop proven: CSC 220 was applied automatically from the equivalency recorded for Maya.'
        : eq
          ? 'The request was created, but CSC 220 was not auto-applied (a policy rule may have flagged it) - open it to see why.'
          : 'The request was created, but CSC 220 has no equivalency yet, so it needs review. Decide CSC 220 for Maya, then press this button again.',
    };
    await this.audit(actor, 'DEMO_SECOND_STUDENT', 'Demo', result);
    return { ...result, status: await this.status() };
  }

  private async deleteTranscript(id: string) {
    const n = [uid('t', id)];
    const q = (s: string, ex = true) => ex ? this.db.query(s, n) : Promise.resolve();
    await q(`DELETE FROM CourseAppeals WHERE TranscriptId = @t`, await this.schema.has('CourseAppeals'));
    await q(`DELETE FROM PartyReminders WHERE TranscriptId = @t`, await this.schema.exchangeReady());
    await q(`DELETE FROM DocumentRequests WHERE TranscriptId = @t`, await this.schema.exchangeReady());
    await q(`DELETE FROM StatusReminders WHERE TranscriptId = @t`, await this.schema.has('StatusReminders'));
    await q(`DELETE FROM TranscriptNotes WHERE TranscriptId = @t`, await this.schema.has('TranscriptNotes'));
    await q(`DELETE FROM TranscriptStages WHERE TranscriptId = @t`, await this.schema.has('TranscriptStages'));
    await q(`DELETE FROM AiUsageLog WHERE TranscriptId = @t`, await this.schema.has('AiUsageLog'));
    await q(`DELETE FROM Uploads WHERE TranscriptId = @t`, await this.schema.has('Uploads', 'TranscriptId'));
    // Same missing-cascade issue as removeDemoRows: EvaluationCourseMappings (migration 026) must go first.
    await q(`DELETE FROM EvaluationCourseMappings WHERE TranscriptCourseId IN (SELECT Id FROM TranscriptCourses WHERE TranscriptId = @t)`, await this.schema.has('EvaluationCourseMappings'));
    await this.db.query(`DELETE FROM AIMatchCandidates WHERE EvaluationId IN (SELECT e.Id FROM Evaluations e JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId WHERE tc.TranscriptId = @t)`, n);
    await this.db.query(`DELETE FROM Evaluations WHERE TranscriptCourseId IN (SELECT Id FROM TranscriptCourses WHERE TranscriptId = @t)`, n);
    await this.db.query(`DELETE FROM Transcripts WHERE Id = @t`, n);
  }

  /** Noah Chen: synthetic student with a placeholder (non-login) password hash, like the seed's synthetic students. */
  private async ensureNoah(): Promise<string> {
    const existing = await this.userByEmail(NOAH_EMAIL);
    if (existing) return existing.id;
    const role = await this.idOf(`SELECT Id FROM Roles WHERE Name = 'student'`);
    if (!role) throw new BadRequestException('The student role is missing.');
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO Users (Id, Email, PasswordHash, FirstName, LastName, RoleId, IsActive, MustChangePass)
       VALUES (@id, @e, '$argon2id$v=19$m=65536,t=3,p=4$PLACEHOLDER$PLACEHOLDER', @fn, @ln, @r, 1, 1)`,
      [uid('id', id), str('e', NOAH_EMAIL, 254), str('fn', NOAH.firstName, 100), str('ln', NOAH.lastName, 100), int('r', role)],
    );
    const bu = await this.idOf(`SELECT Id FROM Institutions WHERE Code = 'BU'`);
    const hasTarget = await this.schema.has('StudentProfiles', 'TargetInstitutionId');
    await this.db.query(
      hasTarget
        ? `INSERT INTO StudentProfiles (UserId, ProgramArea, AdmissionYear, TargetInstitutionId) VALUES (@id, 'Computer Science', 2026, @bu)`
        : `INSERT INTO StudentProfiles (UserId, ProgramArea, AdmissionYear) VALUES (@id, 'Computer Science', 2026)`,
      [uid('id', id), ...(hasTarget ? [int('bu', bu)] : [])],
    );
    return id;
  }

  private async audit(actor: Actor, action: string, entityType: string, detail: unknown) {
    try {
      await this.db.query(
        `INSERT INTO AuditLog (UserId, UserEmail, UserRole, Action, EntityType, EntityId, NewValue) VALUES (@u, @e, @r, @a, @t, @id, @v)`,
        [
          uid('u', actor.id), str('e', actor.email, 254), { name: 'r', type: sql.VarChar(20), value: actor.role },
          str('a', action, 200), str('t', entityType, 100), str('id', 'maya', 100), { name: 'v', type: sql.NVarChar(sql.MAX), value: JSON.stringify(detail) },
        ],
      );
    } catch (err) {
      this.logger.warn(`Audit write failed: ${(err as Error).message}`);
    }
  }
}
