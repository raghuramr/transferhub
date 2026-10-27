import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService, QueryInput } from '../database/database.service';
import { ScopeService, ScopeViewer } from '../policy/scope.service';
import { SchemaService } from '../policy/schema.service';
import { parseFlags } from '../policy/transfer-policy.service';
import { computeOverlap, creditMath, parseOutcomes, TopicLite } from './comparison.logic';

interface CourseRow {
  Id: number;
  Code: string;
  Title: string;
  Credits: number;
  Description: string | null;
  LearningOutcomes: string | null;
  InstitutionName: string | null;
}

@Injectable()
export class ComparisonService {
  constructor(private db: DatabaseService, private scope: ScopeService, private schema: SchemaService) {}

  /** Topics for a set of courses, keyed by course id. */
  private async topicsFor(ids: number[]): Promise<Map<number, (TopicLite & { id: number })[]>> {
    const out = new Map<number, (TopicLite & { id: number })[]>();
    if (!ids.length) return out;
    const inputs: QueryInput[] = ids.map((v, i) => ({ name: `c${i}`, type: sql.Int, value: v }));
    const res = await this.db.query<{ Id: number; CourseId: number; Title: string; Description: string | null }>(
      `SELECT Id, CourseId, Title, Description FROM CourseTopics WHERE CourseId IN (${ids.map((_, i) => `@c${i}`).join(',')}) ORDER BY SortOrder, Id`,
      inputs,
    ).catch(() => ({ recordset: [] as { Id: number; CourseId: number; Title: string; Description: string | null }[] }));
    for (const r of res.recordset) {
      const list = out.get(r.CourseId) ?? [];
      list.push({ id: r.Id, title: r.Title, description: r.Description });
      out.set(r.CourseId, list);
    }
    return out;
  }

  private shape(c: CourseRow, topics: (TopicLite & { id: number })[]) {
    return {
      id: c.Id,
      code: c.Code,
      title: c.Title,
      credits: Number(c.Credits),
      institutionName: c.InstitutionName,
      description: c.Description,
      outcomes: parseOutcomes(c.LearningOutcomes),
      topics,
    };
  }

  async forEvaluation(evaluationId: string, viewer: ScopeViewer) {
    const head = await this.db.query<{
      EvalId: string; Status: string; Outcome: string | null; DecidedBUCourseId: number | null; AwardedCredits: number | null;
      SuggestedId: number | null; Confidence: number | null; Rationale: string | null;
      TcId: string; TranscriptId: string; CourseCode: string; CourseTitle: string; OriginalCredits: number; NormalisedCredits: number | null;
      Grade: string; Term: string | null; Lane: string; ExternalCourseId: number | null; InstitutionName: string; Calendar: string | null;
    }>(
      `SELECT e.Id AS EvalId, e.Status, e.Outcome, e.DecidedBUCourseId, e.AwardedCredits,
              e.AISuggestedCourseId AS SuggestedId, e.AIConfidence AS Confidence, e.AIRationale AS Rationale,
              tc.Id AS TcId, tc.TranscriptId, tc.CourseCode, tc.CourseTitle, tc.OriginalCredits, tc.NormalisedCredits,
              tc.Grade, tc.Term, tc.Lane, tc.ExternalCourseId, i.Name AS InstitutionName, i.Calendar
       FROM Evaluations e
       JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
       JOIN Transcripts t ON t.Id = tc.TranscriptId
       JOIN Institutions i ON i.Id = t.InstitutionId
       WHERE e.Id = @id`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: evaluationId }],
    );
    const h = head.recordset[0];
    if (!h) throw new NotFoundException('Evaluation not found');

    // Same scope rules as the request page: the comparison exposes the receiving university's AI candidates,
    // so a scoped admin needs the request incoming (work access), not just read access to an outgoing one.
    if (!(await this.scope.canViewTranscript(viewer, h.TranscriptId)) || !(await this.scope.canWorkRequest(viewer, h.TranscriptId))) {
      throw new ForbiddenException('You do not have access to this request.');
    }

    const cand = await this.db.query<{ Rank: number; Score: number | null; Rationale: string | null; BuId: number }>(
      `SELECT Rank, Score, Rationale, BUCourseId AS BuId FROM AIMatchCandidates WHERE EvaluationId = @id ORDER BY Rank`,
      [{ name: 'id', type: sql.UniqueIdentifier, value: evaluationId }],
    );
    const candidateRows = cand.recordset.slice(0, 3);
    // A decided/suggested BU course that is not among the stored candidates still deserves a column.
    const extras: { id: number; label: string }[] = [];
    for (const [id, label] of [[h.DecidedBUCourseId, 'decided'], [h.SuggestedId, 'suggested']] as [number | null, string][]) {
      if (id != null && !candidateRows.some((c) => c.BuId === id) && !extras.some((x) => x.id === id)) extras.push({ id, label });
    }

    const courseIds = [...candidateRows.map((c) => c.BuId), ...extras.map((x) => x.id)];
    const wanted = [...courseIds, ...(h.ExternalCourseId != null ? [h.ExternalCourseId] : [])];
    const inputs: QueryInput[] = wanted.map((v, i) => ({ name: `c${i}`, type: sql.Int, value: v }));
    const courseRes = wanted.length
      ? await this.db.query<CourseRow>(
          `SELECT c.Id, c.Code, c.Title, c.Credits, c.Description, c.LearningOutcomes, i.Name AS InstitutionName
           FROM Courses c LEFT JOIN Institutions i ON i.Id = c.InstitutionId WHERE c.Id IN (${wanted.map((_, i) => `@c${i}`).join(',')})`,
          inputs,
        )
      : { recordset: [] as CourseRow[] };
    const byId = new Map(courseRes.recordset.map((c) => [c.Id, c]));
    const topics = await this.topicsFor(wanted);

    const extRow = h.ExternalCourseId != null ? byId.get(h.ExternalCourseId) : undefined;
    const external = {
      code: h.CourseCode,
      title: h.CourseTitle,
      institutionName: h.InstitutionName,
      calendar: h.Calendar,
      originalCredits: Number(h.OriginalCredits),
      normalisedCredits: h.NormalisedCredits == null ? null : Number(h.NormalisedCredits),
      grade: h.Grade,
      term: h.Term,
      lane: h.Lane,
      // Catalogue text for the external course comes from its Courses row (may be empty for a student-typed course).
      description: extRow?.Description ?? null,
      outcomes: parseOutcomes(extRow?.LearningOutcomes),
      topics: h.ExternalCourseId != null ? topics.get(h.ExternalCourseId) ?? [] : [],
      syllabus: await this.syllabusFor(h.TcId),
    };

    const build = (buId: number, rank: number, score: number | null, rationale: string | null, source: string) => {
      const row = byId.get(buId);
      if (!row) return null;
      const bu = this.shape(row, topics.get(buId) ?? []);
      const overlap = computeOverlap(
        { title: external.title, description: external.description, outcomes: external.outcomes, topics: external.topics },
        { title: bu.title, description: bu.description, outcomes: bu.outcomes, topics: bu.topics },
      );
      return {
        rank,
        score,
        rationale,
        source,
        course: bu,
        overlap,
        credits: creditMath({ originalCredits: external.originalCredits, normalisedCredits: external.normalisedCredits, calendar: external.calendar, buCredits: bu.credits }),
      };
    };

    const candidates = [
      ...candidateRows.map((c) => build(c.BuId, c.Rank, c.Score == null ? null : Number(c.Score), c.Rationale, 'candidate')),
      ...extras.map((x, i) => build(x.id, candidateRows.length + i + 1, null, null, x.label)),
    ].filter((c): c is NonNullable<typeof c> => !!c);

    let policyFlags: ReturnType<typeof parseFlags> = [];
    if (await this.schema.policyReady()) {
      const pf = await this.db.query<{ PolicyFlags: string | null }>(`SELECT PolicyFlags FROM TranscriptCourses WHERE Id = @id`, [
        { name: 'id', type: sql.UniqueIdentifier, value: h.TcId },
      ]);
      policyFlags = parseFlags(pf.recordset[0]?.PolicyFlags);
    }

    const decidedCourse = h.DecidedBUCourseId != null ? byId.get(h.DecidedBUCourseId) : undefined;
    return {
      evaluationId: h.EvalId,
      transcriptId: h.TranscriptId,
      transcriptCourseId: h.TcId,
      status: h.Status,
      aiConfidence: h.Confidence == null ? null : Number(h.Confidence),
      aiRationale: h.Rationale,
      decision: h.Outcome
        ? { outcome: h.Outcome, awardedCredits: h.AwardedCredits == null ? null : Number(h.AwardedCredits), buCourse: decidedCourse ? { id: decidedCourse.Id, code: decidedCourse.Code, title: decidedCourse.Title } : null }
        : null,
      external,
      candidates,
      // Credit math with no BU course yet (elective / no credit still need the converted figure).
      creditsWithoutCandidate: creditMath({ originalCredits: external.originalCredits, normalisedCredits: external.normalisedCredits, calendar: external.calendar, buCredits: null }),
      policyFlags,
      // The page shows the decision buttons only when this is true (read-only/outgoing viewers never reach here).
      canDecide: true,
    };
  }

  /** Syllabus provided for a course: an uploaded file (Syllabi/TranscriptDocuments) and/or a catalogue link. */
  private async syllabusFor(transcriptCourseId: string) {
    const files: { uploadId: string | null; fileName: string | null }[] = [];
    let catalogUrl: string | null = null;
    const hasUrl = await this.schema.has('Syllabi', 'CatalogUrl');
    const hasUploadId = await this.schema.has('Syllabi', 'UploadId');
    try {
      const s = await this.db.query<{ FileName: string | null; UploadId: string | null; CatalogUrl: string | null }>(
        `SELECT OriginalFileName AS FileName, ${hasUploadId ? 'UploadId' : 'CAST(NULL AS UNIQUEIDENTIFIER)'} AS UploadId, ${hasUrl ? 'CatalogUrl' : 'CAST(NULL AS NVARCHAR(500))'} AS CatalogUrl
         FROM Syllabi WHERE TranscriptCourseId = @id ORDER BY UploadedAt DESC`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: transcriptCourseId }],
      );
      for (const r of s.recordset) {
        if (r.FileName || r.UploadId) files.push({ uploadId: r.UploadId, fileName: r.FileName });
        if (r.CatalogUrl && !catalogUrl) catalogUrl = r.CatalogUrl;
      }
    } catch {
      /* Syllabi unreadable: treat as none */
    }
    try {
      const d = await this.db.query<{ UploadId: string; FileName: string }>(
        `SELECT UploadId, FileName FROM TranscriptDocuments WHERE TranscriptCourseId = @id AND DocTypeKey = 'syllabus' ORDER BY CreatedAt DESC`,
        [{ name: 'id', type: sql.UniqueIdentifier, value: transcriptCourseId }],
      );
      for (const r of d.recordset) {
        if (!files.some((f) => f.uploadId && String(f.uploadId).toLowerCase() === String(r.UploadId).toLowerCase())) files.push({ uploadId: r.UploadId, fileName: r.FileName });
      }
    } catch {
      /* migration 013 absent */
    }
    return { attached: files.length > 0 || !!catalogUrl, files, catalogUrl };
  }
}
