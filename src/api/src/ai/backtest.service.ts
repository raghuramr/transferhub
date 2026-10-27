import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CatalogCourse } from './course-prefilter';
import { BacktestCase, BacktestResult, runBacktest } from './backtest-scoring';

interface DecisionRow {
  ExternalCourseId: number;
  BUCourseId: number;
  ExtCode: string;
  ExtTitle: string;
  ExtCredits: number;
  ExtDescription: string | null;
  ExtInstCode: string;
  Calendar: string | null;
  TargetId: number;
  TargetCode: string;
  TargetName: string;
}

interface CourseRow {
  Id: number;
  InstitutionId: number;
  Code: string;
  Title: string;
  Credits: number;
  ProgramArea: string | null;
  Description: string | null;
}

const CACHE_MS = 60_000;

/**
 * Measures how often a matcher finds the course evaluators really chose (top-1 / top-3) over past decisions,
 * holding each decision out per receiving university. Read-only. Today it scores the built-in rules matcher;
 * the AI matcher would be plugged in through `Matcher` in backtest-scoring.ts once an Anthropic key exists.
 */
@Injectable()
export class BacktestService {
  private cache: { at: number; result: BacktestResult } | null = null;

  constructor(private db: DatabaseService) {}

  async run(force = false): Promise<BacktestResult & { generatedAt: string; cached: boolean }> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return { ...this.cache.result, generatedAt: new Date(this.cache.at).toISOString(), cached: true };
    }
    const result = await this.compute();
    this.cache = { at: Date.now(), result };
    return { ...result, generatedAt: new Date(this.cache.at).toISOString(), cached: false };
  }

  private async compute(): Promise<BacktestResult> {
    const dec = await this.db.query<DecisionRow>(
      `SELECT eq.ExternalCourseId, eq.BUCourseId,
              ec.Code AS ExtCode, ec.Title AS ExtTitle, ec.Credits AS ExtCredits, ec.Description AS ExtDescription,
              ei.Code AS ExtInstCode, ei.Calendar,
              bc.InstitutionId AS TargetId, bi.Code AS TargetCode, bi.Name AS TargetName
       FROM Equivalencies eq
       JOIN Courses ec ON ec.Id = eq.ExternalCourseId
       JOIN Institutions ei ON ei.Id = ec.InstitutionId
       JOIN Courses bc ON bc.Id = eq.BUCourseId
       JOIN Institutions bi ON bi.Id = bc.InstitutionId
       WHERE eq.IsActive = 1 AND eq.Outcome = 'equivalent' AND ec.IsActive = 1 AND bc.IsActive = 1`,
    );

    const courses = await this.db.query<CourseRow>(
      `SELECT Id, InstitutionId, Code, Title, Credits, ProgramArea, Description FROM Courses WHERE IsActive = 1 ORDER BY Code`,
    );
    const topics = await this.db.query<{ CourseId: number; Title: string }>(
      `SELECT CourseId, Title FROM CourseTopics ORDER BY CourseId, SortOrder`,
    );
    const topicsByCourse = new Map<number, string[]>();
    for (const t of topics.recordset) {
      const list = topicsByCourse.get(t.CourseId) ?? [];
      if (list.length < 6) list.push(t.Title); // same cap as AiService
      topicsByCourse.set(t.CourseId, list);
    }

    // Catalogue per receiving university, built the same way AiService builds it.
    const catalogs = new Map<number, CatalogCourse[]>();
    for (const c of courses.recordset) {
      const list = catalogs.get(c.InstitutionId) ?? [];
      list.push({
        id: c.Id,
        code: c.Code,
        title: c.Title,
        credits: Number(c.Credits),
        programArea: c.ProgramArea,
        description: c.Description,
        topics: topicsByCourse.get(c.Id) ?? [],
      });
      catalogs.set(c.InstitutionId, list);
    }

    // One case per (external course, receiving university); several true answers are all accepted.
    const cases = new Map<string, BacktestCase>();
    for (const d of dec.recordset) {
      const key = `${d.ExternalCourseId}:${d.TargetId}`;
      let c = cases.get(key);
      if (!c) {
        const raw = Number(d.ExtCredits);
        // Same quarter -> semester conversion the triage procedure applies.
        const credits = d.Calendar === 'quarter' ? Math.floor(((raw * 2) / 3) * 100) / 100 : raw;
        const extTopics = topicsByCourse.get(d.ExternalCourseId) ?? [];
        c = {
          externalCourseId: d.ExternalCourseId,
          externalLabel: `${d.ExtInstCode} ${d.ExtCode} - ${d.ExtTitle}`,
          facts: {
            code: d.ExtCode,
            title: d.ExtTitle,
            credits,
            text: `${d.ExtDescription ?? ''} ${extTopics.join(' ')}`,
          },
          targetInstitutionId: d.TargetId,
          targetCode: d.TargetCode,
          targetName: d.TargetName,
          expectedCourseIds: [],
        };
        cases.set(key, c);
      }
      if (!c.expectedCourseIds.includes(d.BUCourseId)) c.expectedCourseIds.push(d.BUCourseId);
    }

    return runBacktest([...cases.values()], catalogs);
  }
}
