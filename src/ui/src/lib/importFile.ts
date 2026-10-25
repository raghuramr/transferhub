import readExcelFile from 'read-excel-file/browser';
import writeExcelFile from 'write-excel-file/browser';
import type { SubmissionBody } from './partnerApi';

type Row = Record<string, unknown>;

/** Column headers per sheet, in the order they appear in the template. Also the allow-list when reading. */
export const SHEETS = {
  Universities: ['code', 'name', 'type', 'calendar', 'website'],
  Programs: ['universityCode', 'name', 'area', 'degree', 'school', 'description', 'website'],
  Courses: ['universityCode', 'code', 'name', 'credits', 'programName', 'department', 'level', 'requirementType', 'description', 'learningOutcomes', 'source'],
  Topics: ['universityCode', 'courseCode', 'title', 'description', 'linkLabel', 'linkUrl'],
} as const;

export interface ParsedFile {
  body: SubmissionBody;
  warnings: string[];
}

const cell = (v: unknown): unknown => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v.trim() === '' ? undefined : v.trim();
  if (v instanceof Date) return v.toISOString();
  return v;
};

function rowsOf(data: unknown[][], columns: readonly string[], sheet: string, warnings: string[]): Row[] {
  if (!data.length) return [];
  const lookup = new Map(columns.map((c) => [c.toLowerCase(), c]));
  const header = data[0].map((h) => lookup.get(String(h ?? '').trim().toLowerCase()) ?? null);
  const unknown = data[0].map((h, i) => (header[i] === null && String(h ?? '').trim() ? String(h).trim() : null)).filter(Boolean);
  if (unknown.length) warnings.push(`Sheet "${sheet}": ignored unknown column(s) ${unknown.join(', ')}.`);
  const out: Row[] = [];
  for (const r of data.slice(1)) {
    const obj: Row = {};
    r.forEach((v, i) => {
      const key = header[i];
      const val = cell(v);
      if (key && val !== undefined) obj[key] = val;
    });
    if (Object.keys(obj).length) out.push(obj);
  }
  return out;
}

/** Reads the template workbook (sheets Universities / Programs / Courses / Topics) into a submission body. */
export async function parseExcel(file: File, defaultUniversityCode: string): Promise<ParsedFile> {
  const sheets = await readExcelFile(file);
  const warnings: string[] = [];
  const body: SubmissionBody = {};
  const topicRows: Row[] = [];

  for (const s of sheets) {
    const name = Object.keys(SHEETS).find((n) => n.toLowerCase() === s.sheet.trim().toLowerCase()) as keyof typeof SHEETS | undefined;
    if (!name) {
      warnings.push(`Sheet "${s.sheet}" is not one of Universities, Programs, Courses or Topics, so it was skipped.`);
      continue;
    }
    const rows = rowsOf(s.data as unknown[][], SHEETS[name], name, warnings);
    if (name === 'Universities') body.universities = rows;
    if (name === 'Programs') body.programs = rows;
    if (name === 'Courses') body.courses = rows;
    if (name === 'Topics') topicRows.push(...rows);
  }

  if (topicRows.length) {
    const byCourse = new Map<string, Row>();
    for (const c of body.courses ?? []) byCourse.set(`${String(c.universityCode ?? defaultUniversityCode).toLowerCase()}|${String(c.code).toLowerCase()}`, c);
    let orphans = 0;
    for (const t of topicRows) {
      const course = byCourse.get(`${String(t.universityCode ?? defaultUniversityCode).toLowerCase()}|${String(t.courseCode ?? '').toLowerCase()}`);
      if (!course) { orphans++; continue; }
      const topics = (course.topics as Row[] | undefined) ?? [];
      const topic: Row = { title: t.title };
      if (t.description) topic.description = t.description;
      if (t.linkUrl) topic.referenceLinks = [{ label: t.linkLabel ?? 'Reference', url: t.linkUrl }];
      topics.push(topic);
      course.topics = topics;
    }
    if (orphans) warnings.push(`${orphans} topic row(s) did not match any course on the Courses sheet and were skipped.`);
  }
  return { body, warnings };
}

/** Accepts the full body ({universities, programs, courses}) or the older {type, data} shape. */
export async function parseJsonFile(file: File): Promise<ParsedFile> {
  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The JSON must be an object like {"courses": [...]}.');
  const o = raw as Record<string, unknown>;
  const body: SubmissionBody = {};
  if (typeof o.type === 'string' && Array.isArray(o.data) && ['universities', 'programs', 'courses'].includes(o.type)) {
    (body as Record<string, unknown>)[o.type] = o.data;
  } else {
    for (const k of ['universities', 'programs', 'courses'] as const) {
      if (o[k] === undefined) continue;
      if (!Array.isArray(o[k])) throw new Error(`"${k}" must be a list.`);
      body[k] = o[k] as Record<string, unknown>[];
    }
    if (typeof o.note === 'string') body.note = o.note;
  }
  if (!body.universities && !body.programs && !body.courses) warnings.push('No universities, programs or courses were found in this file.');
  return { body, warnings };
}

export function countRows(b: SubmissionBody) {
  return { universities: b.universities?.length ?? 0, programs: b.programs?.length ?? 0, courses: b.courses?.length ?? 0 };
}

/** Downloads an .xlsx with the four sheets, headers and one example row each. */
export async function downloadTemplate(code: string): Promise<void> {
  const head = (cols: readonly string[]) => cols.map((c) => ({ value: c, fontWeight: 'bold' as const, backgroundColor: '#e2e8f0' }));
  const row = (vals: (string | number)[]) => vals.map((v) => ({ value: v }));
  const sheet = (name: string, cols: readonly string[], example: (string | number)[]) => ({
    sheet: name,
    data: [head(cols), row(example)],
    stickyRowsCount: 1,
  });
  await writeExcelFile([
    sheet('Universities', SHEETS.Universities, [code, 'Example University', 'university', 'semester', 'https://catalog.example.edu']),
    sheet('Programs', SHEETS.Programs, [code, 'Computer Science', 'Computer Science', 'BS', 'School of Engineering', 'Four-year degree', '']),
    sheet('Courses', SHEETS.Courses, [code, 'CS101', 'Introduction to Computing', 3, 'Computer Science', 'Computer Science', 'intro', 'Core', 'Fundamentals of programming', '', '']),
    sheet('Topics', SHEETS.Topics, [code, 'CS101', 'Variables and data types', 'Basic data types', 'Syllabus', 'https://example.edu/syllabus.pdf']),
  ]).toFile('transferhub-template.xlsx');
}

export function downloadJsonExample(code: string) {
  const example = {
    note: 'Optional message to the reviewer',
    universities: [{ code, name: 'Example University', type: 'university', calendar: 'semester' }],
    programs: [{ universityCode: code, name: 'Computer Science', degree: 'BS' }],
    courses: [{
      universityCode: code, code: 'CS101', name: 'Introduction to Computing', credits: 3, programName: 'Computer Science',
      topics: [{ title: 'Variables and data types', description: 'Basic data types' }],
    }],
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(example, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'transferhub-example.json';
  a.click();
  URL.revokeObjectURL(url);
}
