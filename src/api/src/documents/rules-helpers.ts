/**
 * Pure, dependency-free helpers for the built-in "rules" document reader: keyword classification and
 * regex field extraction over plain text. No I/O so they can be unit tested on their own
 * (see scripts/test-rules-reader.ts). Everything here is best effort - confidence is deliberately modest.
 */
import { DOC_TYPE_KEYS, ExtractedData, normalizeExtraction } from './document-types';

export const RULES_MODEL = 'built-in rules';
/** Rules never claim more than this - a person should always glance at the result. */
const MAX_CONFIDENCE = 0.85;

const clamp = (n: number) => Math.min(MAX_CONFIDENCE, Math.max(0, Math.round(n * 100) / 100));

export function cleanText(text: string): string {
  return (text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ── classification ──────────────────────────────────────────

type Rule = [RegExp, number];

const KEYWORDS: Record<string, Rule[]> = {
  transcript: [
    [/\btranscript\b/i, 4], [/\bofficial transcript\b/i, 2], [/\bcumulative gpa\b|\bgpa\b/i, 2], [/\bcredits? (earned|attempted)\b/i, 2],
    [/\bregistrar\b/i, 2], [/\b(fall|spring|summer|winter) (semester |term )?\d{4}\b/i, 2], [/\bgrade\b/i, 1], [/\bcourse (no|number|title)\b/i, 1],
    [/\bacademic record\b|\bdegree awarded\b|\bcredit hours?\b/i, 2], [/\b[A-Z]{2,5}\s?-?\d{3,4}[A-Z]?\s+.+\s\d(\.\d+)?\s+[A-F][+-]?\s*$/m, 3],
  ],
  id_document: [
    [/\bpassport\b/i, 4], [/\bdate of birth\b|\bdob\b/i, 2], [/\bnationality\b/i, 2], [/\bdate of expiry\b|\bexpiry\b|\bexpires\b/i, 1],
    [/\bdriver'?s? licen[cs]e\b|\bidentity card\b|\bnational id\b|\bid card\b/i, 3], [/\bsurname\b|\bgiven names?\b/i, 1],
    [/[A-Z0-9<]{30,44}\n?[A-Z0-9<]{30,44}/, 5], [/\bP<[A-Z]{3}/, 5], [/\bissuing (authority|country)\b|\bplace of birth\b/i, 2],
  ],
  english_test: [
    [/\btoefl\b/i, 5], [/\bielts\b/i, 5], [/\bduolingo\b/i, 5], [/\bpte academic\b|\bpearson test of english\b/i, 5],
    [/\btest taker\b|\bcandidate\b/i, 1], [/\bband score\b|\boverall band\b/i, 3], [/\blistening\b/i, 1], [/\bspeaking\b/i, 1],
    [/\bscore report\b|\btest report form\b/i, 2], [/\benglish (proficiency|language) test\b/i, 3],
  ],
  syllabus: [
    [/\bsyllabus\b/i, 5], [/\bcourse (description|outline|objectives|schedule)\b/i, 3], [/\blearning outcomes?\b|\blearning objectives?\b/i, 2],
    [/\binstructor\b|\bprofessor\b/i, 1], [/\boffice hours\b/i, 2], [/\bweek \d+\b/gi, 2], [/\bgrading (policy|scale|breakdown)\b|\bassignments?\b|\bexams?\b/i, 1],
    [/\bprerequisites?\b|\btextbook\b|\breadings?\b/i, 1], [/\bacademic (integrity|honesty)\b/i, 1],
  ],
  enrollment_letter: [
    [/\benrol?lment (verification|letter|certificate)\b/i, 5], [/\bis (currently )?enrol?led\b|\bwas enrol?led\b|\bhas been enrol?led\b/i, 4],
    [/\bto whom it may concern\b/i, 3], [/\bfull[- ]time student\b|\bgood standing\b|\bexpected graduation\b|\bletter of (admission|acceptance)\b/i, 2],
    [/\bcertif(y|ies) that\b|\bthis letter\b/i, 2], [/\bstudent status\b/i, 2],
  ],
};

const FILENAME_HINTS: [RegExp, string][] = [
  [/transcript|grade.?report|academic.?record/i, 'transcript'],
  [/passport|visa|national.?id|driver|licen[cs]e|\bid\b|identity|aadhaar|pan.?card/i, 'id_document'],
  [/toefl|ielts|duolingo|pte|english/i, 'english_test'],
  [/syllabus|syllabi|course.?outline/i, 'syllabus'],
  [/enrol+ment|enrol+ed|admission|acceptance|bonafide/i, 'enrollment_letter'],
];

export interface Classification {
  docType: string;
  score: number;
  confidence: number;
  scores: Record<string, number>;
}

export function classify(text: string, fileName = ''): Classification {
  const scores: Record<string, number> = {};
  for (const [type, rules] of Object.entries(KEYWORDS)) {
    let s = 0;
    for (const [re, w] of rules) {
      const flags = re.flags.replace('g', '');
      if (new RegExp(re.source, flags).test(text)) s += w;
    }
    scores[type] = s;
  }
  for (const [re, type] of FILENAME_HINTS) if (re.test(fileName)) scores[type] = (scores[type] ?? 0) + 2;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, topScore] = ranked[0] ?? ['other', 0];
  const second = ranked[1]?.[1] ?? 0;
  if (!topScore || topScore < 2) return { docType: 'other', score: topScore || 0, confidence: 0.15, scores };
  let confidence = topScore >= 8 ? 0.9 : topScore >= 5 ? 0.75 : topScore >= 3 ? 0.55 : 0.4;
  if (second >= topScore * 0.7) confidence -= 0.2; // close call between two types
  return { docType: top, score: topScore, confidence: Math.max(0.15, confidence), scores };
}

/** Classification from the file name / mime alone (images and scans with no text layer). */
export function classifyByName(fileName: string): string {
  for (const [re, type] of FILENAME_HINTS) if (re.test(fileName)) return type;
  return 'other';
}

// ── dates ───────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');

/** Returns YYYY-MM-DD when the date is unambiguous (ISO or month name), else the trimmed original; null if empty. */
export function normalizeDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/);
  const mon = m ? MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()] : undefined;
  if (m && mon) return `${m[3]}-${pad(mon)}-${pad(+m[1])}`;
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && (MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()])) {
    return `${m[3]}-${pad(MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(+m[2])}`;
  }
  return s.slice(0, 20);
}

const DATE_PAT = String.raw`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})`;

function labelled(text: string, labels: string, valuePat = String.raw`([^\n]{1,80})`): string | null {
  const re = new RegExp(String.raw`(?:${labels})\s*[:\-#]?\s*${valuePat}`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// ── transcript ──────────────────────────────────────────────

const SEASON_RE = String.raw`(Fall|Autumn|Spring|Summer|Winter)`;
const TERM_RES: RegExp[] = [
  new RegExp(String.raw`\b${SEASON_RE}\s+(?:Semester\s+|Term\s+|Quarter\s+|Session\s+)?(\d{4})\b`, 'i'),
  new RegExp(String.raw`\b(\d{4})\s+${SEASON_RE}\b`, 'i'),
  new RegExp(String.raw`\b${SEASON_RE}\s*['’]?(\d{2})\b`, 'i'),
];

export function parseTerm(s: string): { term: string; season: string; year: number } | null {
  let m = s.match(TERM_RES[0]);
  let season: string | undefined;
  let year: number | undefined;
  if (m) { season = m[1]; year = +m[2]; }
  else if ((m = s.match(TERM_RES[1]))) { season = m[2]; year = +m[1]; }
  else if ((m = s.match(TERM_RES[2]))) { season = m[1]; year = 2000 + +m[2]; }
  if (!season || !year) return null;
  const sea = season.toLowerCase() === 'autumn' ? 'fall' : season.toLowerCase();
  return { term: `${sea[0].toUpperCase()}${sea.slice(1)} ${year}`, season: sea, year };
}

const GRADE = String.raw`(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|P|NP|S|U|W|WP|WF|CR|NC|IP|AU|I|TR)`;
const CODE = String.raw`([A-Z]{2,5}\s?-?\s?\d{3,4}[A-Z]{0,2})`;
const NUM = String.raw`(\d{1,2}(?:\.\d{1,2})?)`;
// "CS 101 Intro to Programming 3.0 A [12.0]"
const ROW_CREDITS_THEN_GRADE = new RegExp(String.raw`^${CODE}[\s:\-]+(.+?)\s+${NUM}\s+${GRADE}(?:\s+\d{1,2}(?:\.\d{1,3})?)?\s*$`);
// "CS 101 Intro to Programming A 3.0"
const ROW_GRADE_THEN_CREDITS = new RegExp(String.raw`^${CODE}[\s:\-]+(.+?)\s+${GRADE}\s+${NUM}(?:\s+\d{1,2}(?:\.\d{1,3})?)?\s*$`);
// "CS 101 3.0 A Intro to Programming" is rare; "CS 101 Intro 3 credits A"
const ROW_CREDITS_WORD = new RegExp(String.raw`^${CODE}[\s:\-]+(.+?)\s+${NUM}\s*(?:cr|credits?|units?|hrs?)\.?\s+${GRADE}\s*$`, 'i');

export interface ParsedCourse {
  courseCode: string;
  courseTitle: string;
  credits: number | null;
  grade: string;
  term: string;
  termSeason?: string;
  termYear?: number;
}

export function parseTranscriptCourses(text: string): ParsedCourse[] {
  const out: ParsedCourse[] = [];
  let cur: ReturnType<typeof parseTerm> = null;
  const seen = new Set<string>();
  for (const raw of lines(text)) {
    const line = raw.replace(/\s{2,}/g, ' ').replace(/\t/g, ' ').trim();
    const looksLikeHeader = line.length < 60 && !/\d\.\d/.test(line.replace(/\d{4}/g, ''));
    const t = parseTerm(line);
    if (t && looksLikeHeader) { cur = t; continue; }
    let code = '';
    let title = '';
    let credits: number | null = null;
    let grade = '';
    let m = line.match(ROW_CREDITS_THEN_GRADE);
    if (m) { code = m[1]; title = m[2]; credits = +m[3]; grade = m[4]; }
    else if ((m = line.match(ROW_GRADE_THEN_CREDITS))) { code = m[1]; title = m[2]; grade = m[3]; credits = +m[4]; }
    else if ((m = line.match(ROW_CREDITS_WORD))) { code = m[1]; title = m[2]; credits = +m[3]; grade = m[4].toUpperCase(); }
    if (!code) continue;
    code = code.replace(/\s*-\s*/, ' ').replace(/^([A-Z]+)(\d)/, '$1 $2').replace(/\s+/g, ' ');
    title = title.replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
    if (title.length < 3 || credits === null || credits > 30) continue;
    const inlineTerm = parseTerm(line);
    const term = inlineTerm ?? cur;
    const key = `${code}|${term?.term ?? ''}|${grade}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      courseCode: code, courseTitle: title, credits, grade,
      term: term?.term ?? '',
      ...(term ? { termSeason: term.season, termYear: term.year } : {}),
    });
  }
  return out;
}

function guessInstitution(text: string): string {
  const ls = lines(text).slice(0, 25);
  const labelledName = labelled(text, 'institution|school name|university name|college name', String.raw`([^\n]{3,120})`);
  if (labelledName && /univers|college|institut|school|academy/i.test(labelledName)) return labelledName.slice(0, 200);
  for (const l of ls) {
    if (/\b(university|college|institute|polytechnic|academy|school of)\b/i.test(l) && l.length <= 100) {
      const cleaned = l.replace(/\b(official )?(academic )?transcript\b.*$/i, '').replace(/[|•\-–]+\s*$/, '').trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return '';
}

export function parseTranscript(text: string): { fields: Record<string, unknown>; found: number } {
  const courses = parseTranscriptCourses(text);
  const institution = guessInstitution(text);
  const studentName = labelled(text, String.raw`student name|name of student|student|name`, String.raw`([A-Za-z][A-Za-z.,'’\- ]{2,60}?)(?=\s{2,}|\s+(?:student|id|dob|date|program|major)\b|\n|$)`) ?? '';
  const studentId = labelled(text, String.raw`student (?:id|no\.?|number)|id (?:no\.?|number|#)|roll (?:no|number)|registration (?:no|number)`, String.raw`([A-Z0-9][A-Z0-9\-/]{3,20})`) ?? '';
  const gpaM = text.match(/\b(?:cumulative |overall |cgpa|total )?\s*(?:gpa|cgpa)\s*[:=\-]?\s*(\d(?:\.\d{1,3})?)/i);
  const gpa = gpaM ? +gpaM[1] : null;
  const program = labelled(text, 'program(?:me)?|major|degree program|field of study');
  const degree = labelled(text, 'degree(?: awarded)?', String.raw`((?:Bachelor|Master|Associate|Doctor|B\.?\s?[AS]\.?|M\.?\s?[AS]\.?|Ph\.?D)[^\n]{0,60})`);
  const calendar = /\bquarter\b/i.test(text) ? 'quarter' : /\btrimester\b/i.test(text) ? 'trimester' : 'semester';
  const fields = {
    institution: { name: institution },
    calendar,
    student: { name: studentName, id: studentId },
    program: program ?? null,
    degree: degree ?? null,
    gpa: gpa !== null && gpa <= 5 ? gpa : null,
    courses: courses.map((c) => ({ ...c })),
  };
  const found = (institution ? 1 : 0) + (studentName ? 1 : 0) + (studentId ? 1 : 0) + (gpa !== null ? 1 : 0);
  return { fields, found: found + courses.length };
}

function transcriptConfidence(fields: Record<string, any>): number {
  const n = fields.courses.length;
  let c = 0.2 + Math.min(0.4, n * 0.06);
  if (fields.institution.name) c += 0.12;
  if (fields.student.name) c += 0.05;
  if (fields.student.id) c += 0.04;
  if (fields.gpa !== null) c += 0.04;
  if (n === 0) c = Math.min(c, 0.35);
  return c;
}

// ── id document ─────────────────────────────────────────────

function mrzDate(yymmdd: string, future: boolean): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = +yymmdd.slice(0, 2);
  const nowYY = new Date().getFullYear() % 100;
  const century = future ? (yy > nowYY + 30 ? 1900 : 2000) : yy > nowYY ? 1900 : 2000;
  const mm = +yymmdd.slice(2, 4);
  const dd = +yymmdd.slice(4, 6);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${century + yy}-${pad(mm)}-${pad(dd)}`;
}

const MRZ_WEIGHTS = [7, 3, 1];
function mrzCheck(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const v = ch === '<' ? 0 : /\d/.test(ch) ? +ch : ch.charCodeAt(0) - 55;
    sum += v * MRZ_WEIGHTS[i % 3];
  }
  return sum % 10;
}

/** Parses a TD3 (passport, 2x44) MRZ if one is present. */
export function parseMrz(text: string): { fields: Record<string, unknown>; checksOk: boolean } | null {
  const cand = text.split('\n').map((l) => l.replace(/\s+/g, '').toUpperCase()).filter((l) => /^[A-Z0-9<]{40,46}$/.test(l) && l.includes('<'));
  for (let i = 0; i < cand.length - 1; i++) {
    const l1 = cand[i].padEnd(44, '<').slice(0, 44);
    const l2 = cand[i + 1].padEnd(44, '<').slice(0, 44);
    if (!/^[PVA][A-Z<][A-Z<]{3}/.test(l1)) continue;
    const country = l1.slice(2, 5).replace(/</g, '');
    const [sur, given = ''] = l1.slice(5).split('<<');
    const name = `${given.replace(/</g, ' ').trim()} ${sur.replace(/</g, ' ').trim()}`.trim();
    const number = l2.slice(0, 9).replace(/</g, '');
    const nationality = l2.slice(10, 13).replace(/</g, '');
    const dob = mrzDate(l2.slice(13, 19), false);
    const expiry = mrzDate(l2.slice(21, 27), true);
    const checksOk = mrzCheck(l2.slice(0, 9)) === +l2[9] && mrzCheck(l2.slice(13, 19)) === +l2[19] && mrzCheck(l2.slice(21, 27)) === +l2[27];
    if (!number && !dob) continue;
    return {
      checksOk,
      fields: { fullName: name, idType: 'passport', idNumber: number, dateOfBirth: dob, expiryDate: expiry, country: nationality || country },
    };
  }
  return null;
}

export function parseIdDocument(text: string): { fields: Record<string, unknown>; confidence: number } {
  const mrz = parseMrz(text);
  if (mrz) return { fields: mrz.fields, confidence: mrz.checksOk ? 0.88 : 0.7 };
  const idType = /passport/i.test(text) ? 'passport' : /driver|licen[cs]e/i.test(text) ? 'drivers_license' : 'national_id';
  const idNumber = labelled(text, String.raw`passport (?:no\.?|number)|document (?:no\.?|number)|licen[cs]e (?:no\.?|number)|id (?:no\.?|number)|identity (?:no\.?|number)|card (?:no\.?|number)|number`, String.raw`([A-Z0-9][A-Z0-9 \-]{4,18})`);
  const dob = labelled(text, 'date of birth|birth date|dob|born', DATE_PAT);
  const expiry = labelled(text, 'date of expiry|expiry date|expiration date|expires|valid until|valid thru|expiry', DATE_PAT);
  const surname = labelled(text, 'surname|last name|family name', String.raw`([A-Za-z][A-Za-z'’\- ]{1,40})`);
  const given = labelled(text, 'given names?|first name|forenames?', String.raw`([A-Za-z][A-Za-z'’\- ]{1,40})`);
  const full = labelled(text, 'full name|name', String.raw`([A-Za-z][A-Za-z.'’\- ]{3,60})`);
  const fullName = given && surname ? `${given} ${surname}` : full ?? '';
  const country = labelled(text, 'nationality|citizenship|country of (?:issue|citizenship)|issuing country', String.raw`([A-Za-z][A-Za-z ]{2,40})`);
  const fields = {
    fullName: fullName || null,
    idType,
    idNumber: idNumber ? idNumber.replace(/\s+/g, '') : null,
    dateOfBirth: normalizeDate(dob),
    expiryDate: normalizeDate(expiry),
    country: country ?? null,
  };
  let c = 0.15;
  if (fields.idNumber) c += 0.2;
  if (fields.fullName) c += 0.15;
  if (fields.dateOfBirth) c += 0.1;
  if (fields.expiryDate) c += 0.08;
  if (fields.country) c += 0.05;
  return { fields, confidence: c };
}

// ── english test ────────────────────────────────────────────

export function parseEnglishTest(text: string): { fields: Record<string, unknown>; confidence: number } {
  const testType = /ielts/i.test(text) ? 'IELTS' : /toefl/i.test(text) ? 'TOEFL' : /duolingo/i.test(text) ? 'Duolingo' : /\bpte\b|pearson test of english/i.test(text) ? 'PTE' : null;
  let score: string | null = null;
  const pick = (re: RegExp) => text.match(re)?.[1] ?? null;
  if (testType === 'IELTS') score = pick(/overall(?: band)?(?: score)?\s*[:\-]?\s*(\d(?:\.\d)?)/i) ?? pick(/band score\s*[:\-]?\s*(\d(?:\.\d)?)/i);
  else if (testType === 'TOEFL') score = pick(/total(?: score)?\s*[:\-]?\s*(\d{2,3})\b/i) ?? pick(/toefl[^\n]{0,40}?(?:score)?\s*[:\-]?\s*(\d{2,3})\b/i);
  else if (testType === 'Duolingo') score = pick(/(?:overall|duolingo english test(?: score)?|score)\s*[:\-]?\s*(\d{2,3})\b/i);
  else if (testType === 'PTE') score = pick(/overall(?: score)?\s*[:\-]?\s*(\d{2,3})\b/i);
  if (!score) score = pick(/(?:overall|total|final)(?: band)?(?: score)?\s*[:\-]?\s*(\d{1,3}(?:\.\d)?)/i);
  const testDate = normalizeDate(labelled(text, 'test date|date of test|date tested|test taken|exam date|date of exam|date', DATE_PAT));
  const valid = normalizeDate(labelled(text, 'valid until|valid through|expiry date|expires|expiration date|scores? valid', DATE_PAT));
  const candidate = labelled(text, 'candidate name|test taker name|test taker|candidate|name', String.raw`([A-Za-z][A-Za-z.'’\- ]{3,60})`);
  const sections: Record<string, number> = {};
  for (const k of ['listening', 'reading', 'writing', 'speaking', 'literacy', 'comprehension', 'conversation', 'production']) {
    const v = text.match(new RegExp(String.raw`\b${k}\b\s*[:\-]?\s*(\d{1,3}(?:\.\d)?)\b`, 'i'));
    if (v) sections[k] = +v[1];
  }
  const fields: Record<string, unknown> = {
    testType, score, testDate, candidateName: candidate, validUntil: valid,
    ...(Object.keys(sections).length ? { sections } : {}),
  };
  let c = 0.1;
  if (testType) c += 0.3;
  if (score) c += 0.3;
  if (testDate) c += 0.08;
  if (candidate) c += 0.05;
  if (Object.keys(sections).length >= 2) c += 0.07;
  return { fields, confidence: c };
}

// ── syllabus ────────────────────────────────────────────────

const BULLET = /^\s*(?:[-*•▪◦●]|\d{1,2}[.)]|week\s*\d{1,2}\s*[:.\-–]?|module\s*\d{1,2}\s*[:.\-–]?|unit\s*\d{1,2}\s*[:.\-–]?)\s*(.{3,160})$/i;
const TOPIC_HEADING = /^(?:course\s+)?(?:topics?(?: covered)?|schedule|weekly schedule|course outline|outline|content|course content|syllabus|modules|units|learning outcomes|learning objectives)\s*:?\s*$/i;

export function parseSyllabus(text: string): { fields: Record<string, unknown>; confidence: number } {
  const ls = lines(text);
  const codeRe = /\b([A-Z]{2,5}\s?-?\s?\d{3,4}[A-Z]?)\b/;
  let courseCode: string | null = null;
  let courseTitle: string | null = labelled(text, 'course title|title of course|course name', String.raw`([^\n]{3,150})`);
  for (const l of ls.slice(0, 30)) {
    const m = l.match(codeRe);
    if (m) {
      courseCode = m[1].replace(/\s*-\s*/, ' ').replace(/^([A-Z]+)(\d)/, '$1 $2').replace(/\s+/g, ' ');
      if (!courseTitle) {
        const rest = l.replace(m[0], '').replace(/^[\s:\-–—|.]+|[\s:\-–—|.]+$/g, '').replace(/\bsyllabus\b/i, '').trim();
        if (rest.length >= 4 && rest.length <= 120) courseTitle = rest;
      }
      break;
    }
  }
  if (!courseTitle) courseTitle = ls.find((l) => /syllabus/i.test(l) && l.length < 100)?.replace(/syllabus/i, '').replace(/^[\s:\-–—]+|[\s:\-–—]+$/g, '') || null;
  const credits = (() => {
    const a = text.match(/\bcredits?(?: hours?)?\s*[:=\-]?\s*(\d{1,2}(?:\.\d)?)\b/i) ?? text.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:credits?|credit hours?|units?|cr\b)/i);
    return a ? +a[1] : null;
  })();
  const term = parseTerm(text)?.term ?? null;
  const institution = guessInstitution(text) || null;
  const description = (() => {
    const i = ls.findIndex((l) => /^course description\s*:?\s*$/i.test(l) || /^description\s*:?\s*$/i.test(l));
    if (i >= 0 && ls[i + 1]) return ls.slice(i + 1, i + 4).join(' ').slice(0, 600);
    const inline = labelled(text, 'course description|description', String.raw`([^\n]{20,600})`);
    return inline;
  })();

  const topics: string[] = [];
  let inSection = false;
  for (const l of ls) {
    if (TOPIC_HEADING.test(l)) { inSection = true; continue; }
    if (inSection && /^[A-Z][A-Za-z ]{3,40}:?\s*$/.test(l) && !BULLET.test(l) && !/^week/i.test(l)) { inSection = false; }
    const b = l.match(BULLET);
    if (b && inSection) topics.push(b[1].trim());
  }
  if (!topics.length) for (const l of ls) { const b = l.match(/^\s*(?:week|module|unit)\s*\d{1,2}\s*[:.\-–]?\s*(.{3,160})$/i); if (b) topics.push(b[1].trim()); }
  const uniq = [...new Set(topics)].slice(0, 40);
  const fields = { courseCode, courseTitle, institution, credits, term, description, topics: uniq.map((title) => ({ title, description: '' })) };
  let c = 0.15;
  if (courseCode) c += 0.15;
  if (courseTitle) c += 0.15;
  if (credits !== null) c += 0.08;
  if (uniq.length) c += Math.min(0.3, 0.1 + uniq.length * 0.03);
  return { fields, confidence: c };
}

// ── other / letters ─────────────────────────────────────────

function parseOther(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const inst = guessInstitution(text);
  if (inst) out.institution = inst;
  const date = normalizeDate(text.match(new RegExp(DATE_PAT))?.[1]);
  if (date) out.date = date;
  const name = labelled(text, 'student name|this is to certify that|certify that|name', String.raw`([A-Z][A-Za-z.'’\- ]{3,50}?)(?=\s+(?:is|was|has|with)\b|\n|$)`);
  if (name) out.studentName = name;
  return out;
}

// ── entry point ─────────────────────────────────────────────

export interface RulesOutcome {
  extracted: ExtractedData;
  /** True when no text could be read at all (image / scan) and only the file name was used. */
  textless: boolean;
}

/** Classifies + extracts from already-obtained plain text (may be empty) and the file name. Never throws. */
export function extractFromText(rawText: string, fileName: string, note = ''): RulesOutcome {
  const text = cleanText(rawText);
  const textless = text.length < 20;
  const cls = textless ? { docType: classifyByName(fileName), confidence: 0.2, score: 0, scores: {} } : classify(text, fileName);
  const docType = DOC_TYPE_KEYS.includes(cls.docType) ? cls.docType : 'other';

  if (textless) {
    const summary = `${note || 'No readable text found in this file (scan or image).'} Guessed "${docType}" from the file name - please check and fill in the details.`;
    const e = normalizeExtraction({ docType, confidence: docType === 'other' ? 0.1 : 0.25, summary, fields: {} }, docType)!;
    return { extracted: e, textless: true };
  }

  let fields: Record<string, unknown> = {};
  let fieldsConf = 0.4;
  switch (docType) {
    case 'transcript': {
      const t = parseTranscript(text);
      fields = t.fields;
      fieldsConf = transcriptConfidence(t.fields);
      break;
    }
    case 'id_document': {
      const r = parseIdDocument(text);
      fields = r.fields; fieldsConf = r.confidence;
      break;
    }
    case 'english_test': {
      const r = parseEnglishTest(text);
      fields = r.fields; fieldsConf = r.confidence;
      break;
    }
    case 'syllabus': {
      const r = parseSyllabus(text);
      fields = r.fields; fieldsConf = r.confidence;
      break;
    }
    default:
      fields = parseOther(text);
      fieldsConf = docType === 'enrollment_letter' ? 0.45 : 0.3;
  }
  const confidence = clamp(Math.min(cls.confidence, fieldsConf) );
  const raw = normalizeExtraction({ docType, confidence, summary: '', fields }, docType)!;
  // Rules results are never trusted blindly: a person confirms them. Keep the honest score but add a hint.
  raw.summary = `${raw.summary} (read by the built-in reader - please check)`.slice(0, 500);
  return { extracted: raw, textless: false };
}
