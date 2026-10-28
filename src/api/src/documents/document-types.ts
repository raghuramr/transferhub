/**
 * Pure helpers for AI document reading: types, prompt sanitising, tolerant JSON parsing and normalising
 * of whatever the model returned. No I/O in this file so it can be unit tested on its own.
 */

export const DOC_TYPES = [
  { key: 'transcript', label: 'Transcript' },
  { key: 'id_document', label: 'ID or passport' },
  { key: 'english_test', label: 'English test report' },
  { key: 'syllabus', label: 'Course syllabus' },
  { key: 'enrollment_letter', label: 'Enrolment letter' },
  { key: 'other', label: 'Other' },
] as const;

export type DocTypeKey = (typeof DOC_TYPES)[number]['key'];
export const DOC_TYPE_KEYS: string[] = DOC_TYPES.map((d) => d.key);

/** Below this overall confidence a person must look at the result before it is used. */
export const REVIEW_THRESHOLD = 0.6;

export interface ExtractedData {
  docType: string;
  confidence: number;
  summary: string;
  fields: Record<string, unknown>;
  /** Word positions from an OCR reader (Azure Document Intelligence). Optional; lets the UI highlight values on scans/photos. */
  layout?: DocLayout;
}

/** Word boxes per page, normalised to 0..1 of the page, top-left origin: b = [x, y, width, height]. */
export interface DocLayout {
  pages: { page: number; words: { t: string; b: [number, number, number, number] }[] }[];
}

export interface TranscriptCourseField {
  courseCode: string;
  courseTitle: string;
  credits: number | null;
  grade: string;
  term: string;
  termSeason?: string;
  termYear?: number;
  confidence?: number;
}

export interface TranscriptPrefill {
  institutionName: string;
  institutionCode: string;
  calendar: 'semester' | 'quarter' | 'trimester';
  studentName: string;
  studentId: string;
  courses: {
    courseCode: string;
    courseTitle: string;
    originalCredits: number;
    grade: string;
    term: string;
    termSeason?: string;
    termYear?: number;
  }[];
  documentUploadId: string;
  isOutsideUS?: boolean;
}

// ── prompt safety ───────────────────────────────────────────

/** Anything user supplied that goes into a prompt (file names...) is flattened to a short plain string. */
export function sanitizeForPrompt(value: unknown, max = 120): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[`<>{}[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ── JSON parsing ────────────────────────────────────────────

export function stripFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

/** Parses the model's reply; tolerates fences and chatter around one JSON object. Returns null when unusable. */
export function parseModelJson(text: string): unknown | null {
  const cleaned = stripFences(text ?? '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── coercion helpers ────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function str(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim().slice(0, max);
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.\-]/g, ''));
    return v.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

function conf(v: unknown): number {
  let n = num(v);
  if (n === null) return 0;
  if (n > 1 && n <= 100) n = n / 100;
  return Math.min(1, Math.max(0, Math.round(n * 1000) / 1000));
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'yes') return true;
  if (v === 'false' || v === 'no') return false;
  return undefined;
}

const SEASONS = ['fall', 'spring', 'summer', 'winter', 'other'];
const CALENDARS = ['semester', 'quarter', 'trimester'];

function normalizeTestType(v: unknown): string | null {
  const s = (str(v, 40) ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('toefl')) return 'TOEFL';
  if (s.includes('ielts')) return 'IELTS';
  if (s.includes('duolingo')) return 'Duolingo';
  return 'Other';
}

function lastFour(v: unknown): string | null {
  const s = (str(v, 60) ?? '').replace(/[^A-Za-z0-9]/g, '');
  return s ? s.slice(-4) : null;
}

/** Plain, flat key/value data for document types we do not model (strings, numbers, booleans only). */
function flatFields(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, 30)) {
    const key = k.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
    if (!key) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string') out[key] = v.trim().slice(0, 300);
  }
  return out;
}

function normalizeTranscript(raw: Record<string, unknown>): Record<string, unknown> {
  const inst = isObj(raw.institution) ? raw.institution : {};
  const student = isObj(raw.student) ? raw.student : {};
  const calendar = (str(raw.calendar, 20) ?? '').toLowerCase();
  const gpa = num(raw.gpa);
  const courses: TranscriptCourseField[] = [];
  for (const c of Array.isArray(raw.courses) ? raw.courses.slice(0, 120) : []) {
    if (!isObj(c)) continue;
    const courseCode = str(c.courseCode ?? c.code, 50) ?? '';
    const courseTitle = str(c.courseTitle ?? c.title, 300) ?? '';
    if (!courseCode && !courseTitle) continue;
    const credits = num(c.credits);
    const season = (str(c.termSeason, 10) ?? '').toLowerCase();
    const year = num(c.termYear);
    const row: TranscriptCourseField = {
      courseCode,
      courseTitle,
      credits: credits !== null && credits >= 0 && credits <= 30 ? credits : null,
      grade: str(c.grade, 10) ?? '',
      term: str(c.term, 50) ?? '',
    };
    if (SEASONS.includes(season)) row.termSeason = season;
    if (year !== null && Number.isInteger(year) && year >= 1950 && year <= 2100) row.termYear = year;
    if (c.confidence !== undefined) row.confidence = conf(c.confidence);
    courses.push(row);
  }
  const outside = bool(inst.isOutsideUS);
  return {
    institution: {
      name: str(inst.name, 200) ?? '',
      ...(str(inst.code, 20) ? { code: str(inst.code, 20)!.toUpperCase() } : {}),
      ...(str(inst.country, 100) ? { country: str(inst.country, 100) } : {}),
      ...(outside !== undefined ? { isOutsideUS: outside } : {}),
    },
    calendar: CALENDARS.includes(calendar) ? calendar : null,
    student: { name: str(student.name, 200) ?? '', id: str(student.id, 60) ?? '' },
    program: str(raw.program, 200),
    degree: str(raw.degree, 100),
    gpa: gpa !== null && gpa >= 0 && gpa <= 5 ? gpa : null,
    courses,
  };
}

function normalizeFields(docType: string, raw: unknown): Record<string, unknown> {
  const f = isObj(raw) ? raw : {};
  switch (docType) {
    case 'transcript':
      return normalizeTranscript(f);
    case 'id_document':
      // Only the last 4 characters of a government id number are ever kept.
      return {
        fullName: str(f.fullName, 200),
        idType: str(f.idType, 30),
        idLast4: lastFour(f.idNumber ?? f.idLast4),
        dateOfBirth: str(f.dateOfBirth, 20),
        country: str(f.country, 100),
        expiryDate: str(f.expiryDate, 20),
      };
    case 'english_test':
      return {
        testType: normalizeTestType(f.testType),
        score: str(f.score, 20),
        testDate: str(f.testDate, 20),
        candidateName: str(f.candidateName, 200),
        validUntil: str(f.validUntil, 20),
        ...(isObj(f.sections) ? { sections: flatFields(f.sections) } : {}),
      };
    case 'syllabus': {
      const topics: { title: string; description: string }[] = [];
      for (const t of Array.isArray(f.topics) ? f.topics.slice(0, 40) : []) {
        if (typeof t === 'string' && t.trim()) topics.push({ title: t.trim().slice(0, 200), description: '' });
        else if (isObj(t) && str(t.title, 200)) topics.push({ title: str(t.title, 200)!, description: str(t.description, 400) ?? '' });
      }
      return {
        courseCode: str(f.courseCode, 50),
        courseTitle: str(f.courseTitle, 300),
        institution: str(f.institution, 200),
        credits: num(f.credits),
        term: str(f.term, 50),
        description: str(f.description, 600),
        topics,
      };
    }
    default:
      return flatFields(f);
  }
}

/** One-line description for the student when the model did not write a usable summary. */
export function fallbackSummary(docType: string, fields: Record<string, unknown>): string {
  if (docType === 'transcript') {
    const inst = isObj(fields.institution) ? str(fields.institution.name, 120) : null;
    const n = Array.isArray(fields.courses) ? fields.courses.length : 0;
    return `${inst ?? 'Transcript'}: ${n} course${n === 1 ? '' : 's'} found.`;
  }
  const label = DOC_TYPES.find((d) => d.key === docType)?.label ?? 'Document';
  return `${label} read.`;
}

/**
 * Normalises whatever the model (or a student editing the result) produced into ExtractedData, or null
 * if it is not an object. `forceDocType` wins over the document's own docType (manual classification).
 */
export function normalizeExtraction(raw: unknown, forceDocType?: string | null): ExtractedData | null {
  if (!isObj(raw)) return null;
  const claimed = (str(raw.docType, 40) ?? '').toLowerCase();
  const docType = forceDocType && DOC_TYPE_KEYS.includes(forceDocType) ? forceDocType : DOC_TYPE_KEYS.includes(claimed) ? claimed : 'other';
  const fields = normalizeFields(docType, raw.fields);
  let summary = (str(raw.summary, 500) ?? '').replace(/\b[A-Z0-9]{8,}\b/g, (m) => (/\d/.test(m) ? `****${m.slice(-4)}` : m));
  if (!summary) summary = fallbackSummary(docType, fields);
  return { docType, confidence: conf(raw.confidence), summary: summary.slice(0, 500), fields };
}

/** True when a person should look before the result is used (low confidence or gaps in a transcript). */
export function needsReview(e: ExtractedData): boolean {
  if (e.confidence < REVIEW_THRESHOLD) return true;
  if (e.docType === 'transcript') {
    const courses = Array.isArray(e.fields.courses) ? (e.fields.courses as TranscriptCourseField[]) : [];
    if (courses.length === 0) return true;
    if (courses.some((c) => c.credits === null || !c.grade)) return true;
    const inst = isObj(e.fields.institution) ? str(e.fields.institution.name) : null;
    if (!inst) return true;
  }
  return false;
}

// ── transcript prefill ──────────────────────────────────────

const STOP_WORDS = new Set(['of', 'the', 'and', 'at', 'for', 'in', 'a']);

/** "Northeastern University" -> "NU"; a single word -> its first letters ("Harvard" -> "HARVAR"). */
export function deriveInstitutionCode(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return 'INST';
  const code = words.length === 1 ? words[0].slice(0, 6) : words.map((w) => w[0]).join('');
  return code.toUpperCase().slice(0, 20) || 'INST';
}

export function toPrefill(e: ExtractedData, uploadId: string): TranscriptPrefill {
  const inst = isObj(e.fields.institution) ? e.fields.institution : {};
  const student = isObj(e.fields.student) ? e.fields.student : {};
  const name = str(inst.name, 200) ?? 'Unknown institution';
  const cal = str(e.fields.calendar, 20);
  const courses = Array.isArray(e.fields.courses) ? (e.fields.courses as TranscriptCourseField[]) : [];
  return {
    institutionName: name,
    institutionCode: str(inst.code, 20) ?? deriveInstitutionCode(name),
    calendar: cal && CALENDARS.includes(cal) ? (cal as TranscriptPrefill['calendar']) : 'semester',
    studentName: str(student.name, 200) ?? '',
    studentId: str(student.id, 60) ?? '',
    courses: courses.map((c) => ({
      courseCode: c.courseCode,
      courseTitle: c.courseTitle,
      originalCredits: c.credits ?? 0,
      grade: c.grade,
      term: c.term,
      ...(c.termSeason ? { termSeason: c.termSeason } : {}),
      ...(c.termYear ? { termYear: c.termYear } : {}),
    })),
    documentUploadId: uploadId,
    ...(typeof inst.isOutsideUS === 'boolean' ? { isOutsideUS: inst.isOutsideUS } : {}),
  };
}
