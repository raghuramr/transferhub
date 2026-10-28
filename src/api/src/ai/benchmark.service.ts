import { BadRequestException, Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../policy/schema.service';
import { AiService } from './ai.service';
import { AiProvidersService, chatProviderLabel, isChatReady, type ChatProvider } from './ai-providers.service';
import { AiSettingsService } from './ai-settings.service';
import type { CatalogCourse } from './course-prefilter';
import { scoreCase, summarize, type BenchCase } from './benchmark-metrics';

/** Reference answers for the scripted Maya demo, used only when no past equivalency decision exists for the course (docs/DEMO_SCRIPT.md). */
const SCENARIO_REFERENCE: Record<string, string> = {
  'BSCC|CSC 220': 'CAS CS 112',
  'BSCC|CSC 240': 'CAS CS 131',
  'PVTC|CIS 150': 'CAS MA 242',
};

const MAX_STUDENTS = 3;
const MAX_COURSES = 30;
const TARGET_CODE = 'BU';

interface CourseRow {
  StudentId: string; FirstName: string; LastName: string; CourseCode: string; CourseTitle: string; OriginalCredits: number; NormalisedCredits: number | null;
  InstId: number; InstName: string; InstCode: string; Calendar: string | null; ExtId: number | null; ExtDescription: string | null; ExpectedBu: string | null;
}

/**
 * Runs the real transfer matching step for a few students into Boston University through each engine (Anthropic, Azure OpenAI,
 * custom providers and the built-in rules fallback) as a DRY RUN - nothing is saved, cached or logged - and measures accuracy
 * against known answers, latency per pipeline stage, tokens and cost. Super-admin tool (AI Controls > Benchmark).
 */
@Injectable()
export class BenchmarkService {
  constructor(private db: DatabaseService, private schema: SchemaService, private ai: AiService, private providers: AiProvidersService, private settings: AiSettingsService) {}

  async engines() {
    const cfg = await this.providers.getConfig();
    const all: { id: ChatProvider | 'rules'; label: string; ready: boolean; model: string; note?: string }[] = [
      { id: 'anthropic', label: 'Anthropic (Claude)', ready: isChatReady(cfg, 'anthropic'), model: (await this.settings.getEffective(null)).matchModel, note: isChatReady(cfg, 'anthropic') ? undefined : 'No API key' },
      { id: 'azure_openai', label: 'Azure OpenAI', ready: isChatReady(cfg, 'azure_openai'), model: cfg.azureOpenAiDeployment ?? '', note: isChatReady(cfg, 'azure_openai') ? undefined : 'Not fully configured' },
      ...cfg.customProviders.map((c) => ({ id: `custom:${c.id}` as ChatProvider, label: c.name, ready: !!c.baseUrl && !!c.model, model: c.model })),
      { id: 'rules', label: 'Built-in rules (fallback)', ready: true, model: 'built-in rules' },
    ];
    return all;
  }

  private async buId(): Promise<number> {
    const r = await this.db.query<{ Id: number }>(`SELECT TOP 1 Id FROM Institutions WHERE Code = @c`, [{ name: 'c', type: sql.VarChar(20), value: TARGET_CODE }]);
    if (!r.recordset[0]) throw new BadRequestException('Boston University (code BU) is not in the database.');
    return r.recordset[0].Id;
  }

  private async courseRows(bu: number, studentIds?: string[]): Promise<CourseRow[]> {
    const targetFilter = (await this.schema.has('Transcripts', 'TargetInstitutionId')) ? `AND (t.TargetInstitutionId = @bu OR t.TargetInstitutionId IS NULL)` : '';
    const inputs: { name: string; type: sql.ISqlTypeFactoryWithNoParams | sql.ISqlType; value: unknown }[] = [{ name: 'bu', type: sql.Int, value: bu }];
    let idFilter = '';
    if (studentIds?.length) {
      idFilter = `AND t.StudentUserId IN (${studentIds.map((_, i) => `@u${i}`).join(', ')})`;
      studentIds.forEach((id, i) => inputs.push({ name: `u${i}`, type: sql.UniqueIdentifier, value: id }));
    }
    const r = await this.db.query<CourseRow>(
      `SELECT TOP 3000 u.Id AS StudentId, u.FirstName, u.LastName, tc.CourseCode, tc.CourseTitle, tc.OriginalCredits, tc.NormalisedCredits,
              i.Id AS InstId, i.Name AS InstName, i.Code AS InstCode, i.Calendar, ec.Id AS ExtId, ec.Description AS ExtDescription,
              (SELECT TOP 1 bc.Code FROM Equivalencies eq JOIN Courses bc ON bc.Id = eq.BUCourseId
                WHERE eq.ExternalCourseId = ec.Id AND eq.IsActive = 1 AND eq.Outcome = 'equivalent' AND bc.InstitutionId = @bu ORDER BY eq.Id) AS ExpectedBu
       FROM Transcripts t
       JOIN Users u ON u.Id = t.StudentUserId
       JOIN TranscriptCourses tc ON tc.TranscriptId = t.Id
       JOIN Institutions i ON i.Id = t.InstitutionId
       LEFT JOIN Courses ec ON ec.Id = COALESCE(tc.ExternalCourseId, (SELECT TOP 1 c2.Id FROM Courses c2 WHERE c2.InstitutionId = t.InstitutionId AND c2.Code = tc.CourseCode))
       WHERE 1 = 1 ${targetFilter} ${idFilter}
       ORDER BY u.Id, t.ReceivedAt, tc.SortOrder`,
      inputs as never,
    );
    return r.recordset.map((x) => ({ ...x, ExpectedBu: x.ExpectedBu ?? SCENARIO_REFERENCE[`${x.InstCode}|${x.CourseCode}`] ?? null }));
  }

  /** Students that have courses going to BU, ranked by how many of those have a known answer. The default pick is Maya + the best other. */
  async students() {
    const bu = await this.buId();
    const rows = await this.courseRows(bu);
    const by = new Map<string, { id: string; name: string; email?: string; courses: number; known: number }>();
    for (const r of rows) {
      const s = by.get(r.StudentId) ?? { id: r.StudentId, name: `${r.FirstName} ${r.LastName}`, courses: 0, known: 0 };
      s.courses++;
      if (r.ExpectedBu) s.known++;
      by.set(r.StudentId, s);
    }
    const list = [...by.values()].filter((s) => s.known > 0).sort((a, b) => b.known - a.known || b.courses - a.courses);
    const maya = list.find((s) => /^maya rivera$/i.test(s.name));
    const defaults = [...(maya ? [maya] : []), ...list.filter((s) => s !== maya)].slice(0, 2).map((s) => s.id);
    return { students: list.slice(0, 60), defaults };
  }

  async run(input: { studentIds?: string[]; engines?: string[] }) {
    const bu = await this.buId();
    const chosen = (input.studentIds?.length ? input.studentIds : (await this.students()).defaults).slice(0, MAX_STUDENTS);
    if (!chosen.length) throw new BadRequestException('No students with courses going to Boston University were found.');
    const rows = (await this.courseRows(bu, chosen)).slice(0, MAX_COURSES);
    if (!rows.length) throw new BadRequestException('The selected students have no courses going to Boston University.');

    const avail = await this.engines();
    const wanted = input.engines?.length ? input.engines : avail.filter((e) => e.ready).map((e) => e.id);
    const engines = avail.filter((e) => wanted.includes(e.id) && e.ready);
    const skipped = avail.filter((e) => wanted.includes(e.id) && !e.ready).map((e) => ({ id: e.id, label: e.label, reason: e.note ?? 'Not configured' }));
    if (!engines.length) throw new BadRequestException('None of the selected engines is configured.');

    const settings = await this.settings.getEffective(bu);
    const catRes = await this.db.query<{ Id: number; Code: string; Title: string; Credits: number; ProgramArea: string | null; Description: string | null }>(
      `SELECT Id, Code, Title, Credits, ProgramArea, Description FROM Courses WHERE InstitutionId = @bu AND IsActive = 1 ORDER BY Code`, [{ name: 'bu', type: sql.Int, value: bu }]);
    const tr = await this.db.query<{ CourseId: number; Title: string }>(`SELECT CourseId, Title FROM CourseTopics ORDER BY CourseId, SortOrder`);
    const topics = new Map<number, string[]>();
    for (const t of tr.recordset) { const l = topics.get(t.CourseId) ?? []; if (l.length < 6) l.push(t.Title); topics.set(t.CourseId, l); }
    const catalog: CatalogCourse[] = catRes.recordset.map((c) => ({ id: c.Id, code: c.Code, title: c.Title, credits: Number(c.Credits), programArea: c.ProgramArea, description: c.Description, topics: settings.useTopics ? topics.get(c.Id) ?? [] : [] }));

    const cases: BenchCase[] = [];
    for (const eng of engines) {
      for (const r of rows) {
        const credits = r.NormalisedCredits ?? r.OriginalCredits;
        const res = await this.ai.dryMatch(eng.id, {
          code: r.CourseCode, title: r.CourseTitle, credits: credits == null ? null : Number(credits), description: r.ExtDescription,
          topics: r.ExtId && settings.useTopics ? topics.get(r.ExtId) ?? [] : [], institutionName: r.InstName, calendar: r.Calendar ?? 'semester',
        }, catalog, settings, { extInstitutionId: r.InstId, targetInstitutionId: bu });
        cases.push(scoreCase({
          engine: eng.id, engineLabel: eng.label, model: res.model || eng.model, studentId: r.StudentId, studentName: `${r.FirstName} ${r.LastName}`,
          courseCode: r.CourseCode, courseTitle: r.CourseTitle, institution: r.InstCode,
          expected: r.ExpectedBu ? { buCode: r.ExpectedBu, source: SCENARIO_REFERENCE[`${r.InstCode}|${r.CourseCode}`] === r.ExpectedBu ? 'scenario' : 'equivalency' } : null,
          picks: res.candidates.map((c) => ({ buCode: c.buCode, confidence: c.confidenceScore })),
          shortlistMs: res.shortlistMs, callMs: res.callMs, parseMs: res.parseMs, totalMs: res.totalMs, usage: res.usage, costUsd: res.costUsd, error: res.error,
        }));
      }
    }

    const threshold = settings.autoLikelyThreshold;
    const students = chosen.map((id) => {
      const mine = rows.filter((r) => r.StudentId === id);
      return { id, name: mine[0] ? `${mine[0].FirstName} ${mine[0].LastName}` : id, courses: mine.length, withTruth: mine.filter((r) => r.ExpectedBu).length };
    });
    return {
      generatedAt: new Date().toISOString(),
      target: 'Boston University (BU)',
      dryRun: true,
      settings: { matchModel: settings.matchModel, prefilterTopN: settings.prefilterTopN, maxOutputTokens: settings.maxOutputTokens, autoApplyThreshold: threshold, catalogSize: catalog.length, temperature: (await this.providers.getConfig()).temperature },
      engines: engines.map((e) => ({ id: e.id, label: e.label, model: e.model })),
      skipped,
      students,
      summary: summarize(cases, threshold),
      perStudent: students.map((s) => ({ studentId: s.id, name: s.name, summary: summarize(cases.filter((c) => c.studentId === s.id), threshold) })),
      cases,
      providerLabels: Object.fromEntries(engines.map((e) => [e.id, e.label])),
      notes: [
        'Dry run: nothing is saved, cached or added to the usage log.',
        'Accuracy is measured against past equivalency decisions (and the scripted reference answers for the Maya demo). Courses without a known answer are timed but not scored.',
        'Timings cover the automated steps (shortlist, model call, answer parsing). Human approval stages are not included.',
      ],
    };
  }
}

// keep chatProviderLabel referenced for future UI use
void chatProviderLabel;
