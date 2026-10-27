/**
 * Pure matching + roll-up behind GET /student/compare. No database access: the service loads the
 * student's courses, each university's catalogue/programs and the equivalency rows once, then calls
 * compareUniversity(). Everything here is a PREVIEW, not an evaluation.
 */
import { CatalogCourse, ExternalCourseFacts } from '../ai/course-prefilter';
import { rulesMatch, RulesCandidate } from '../ai/rules-matcher';

export type MatchKind = 'known' | 'suggested' | 'none';

export interface StudentCourseInput {
  id: string;
  code: string;
  title: string;
  term: string | null;
  grade: string | null;
  originalCredits: number;
  /** Already converted (quarter x 2/3, truncated). */
  convertedCredits: number;
  /** Courses.Id of the student's own course when the catalogue knows it (needed for known equivalencies). */
  externalCourseId: number | null;
  /** Description + topic titles of the student's course, when known. */
  text: string;
  /** Rules engine verdict: a course that is not eligible never counts. */
  notEligible?: boolean;
}

export interface EquivalencyInput {
  externalCourseId: number;
  courseId: number;
  outcome: 'equivalent' | 'elective';
  /** Explicit credits on the mapping (Equivalencies.BUCredits), else null. */
  credits: number | null;
}

export interface ProgramInput {
  id: number;
  name: string;
  area: string | null;
  degree: string | null;
  school: string | null;
  courseIds: number[];
}

export interface UniversityInput {
  id: number;
  code: string;
  name: string;
  catalogue: CatalogCourse[];
  programs: ProgramInput[];
  equivalencies: EquivalencyInput[];
  /** External credit cap (policy). */
  cap: number;
}

export interface MatchedCourse {
  studentCourseId: string;
  studentCode: string;
  studentTitle: string;
  convertedCredits: number;
  kind: Exclude<MatchKind, 'none'>;
  universityCourseId: number;
  universityCode: string;
  universityTitle: string;
  universityCredits: number;
  /** Credits that would transfer for this pair (capped at the target course's credits unless the mapping is explicit). */
  transferCredits: number;
  outcome: 'equivalent' | 'elective' | null;
  confidence: number | null;
  reason: string;
}

export interface ProgramRollup {
  programId: number;
  name: string;
  area: string | null;
  degree: string | null;
  school: string | null;
  matched: MatchedCourse[];
  knownCredits: number;
  suggestedCredits: number;
  transferableCredits: number;
  coursesCovered: number;
  capped: boolean;
}

export interface UnmatchedStudentCourse {
  studentCourseId: string;
  studentCode: string;
  studentTitle: string;
  convertedCredits: number;
  reason: string;
}

export interface UniversityComparison {
  institutionId: number;
  code: string;
  name: string;
  cap: number;
  summary: {
    studentCourses: number;
    coursesMatched: number;
    coursesKnown: number;
    coursesSuggested: number;
    percentMatched: number;
    knownCredits: number;
    suggestedCredits: number;
    transferableCredits: number;
    capped: boolean;
  };
  programs: ProgramRollup[];
  /** Matches to university courses that sit in none of the listed programs. */
  otherMatches: MatchedCourse[];
  noMatch: UnmatchedStudentCourse[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

interface Pair {
  sc: StudentCourseInput;
  course: CatalogCourse;
  kind: 'known' | 'suggested';
  outcome: 'equivalent' | 'elective' | null;
  confidence: number | null;
  reason: string;
  credits: number;
  explicit: boolean;
}

/** Max suggested candidates considered per student course (so a program can pick a lower-ranked course it owns). */
const MAX_CANDIDATES = 12;

function pairCredits(sc: StudentCourseInput, courseCredits: number, explicit: number | null): number {
  if (explicit != null) return r2(explicit);
  return r2(Math.min(sc.convertedCredits, courseCredits));
}

export function candidatePairs(sc: StudentCourseInput, uni: UniversityInput): Pair[] {
  if (sc.notEligible) return [];
  const byId = new Map(uni.catalogue.map((c) => [c.id, c] as const));
  const out: Pair[] = [];
  const knownIds = new Set<number>();
  if (sc.externalCourseId != null) {
    const eqs = uni.equivalencies
      .filter((e) => e.externalCourseId === sc.externalCourseId && byId.has(e.courseId))
      .sort((a, b) => (a.outcome === b.outcome ? 0 : a.outcome === 'equivalent' ? -1 : 1));
    for (const e of eqs) {
      if (knownIds.has(e.courseId)) continue;
      knownIds.add(e.courseId);
      const course = byId.get(e.courseId)!;
      out.push({
        sc, course, kind: 'known', outcome: e.outcome, confidence: null,
        reason: e.outcome === 'elective' ? 'Existing mapping: counts as elective credit.' : 'Existing equivalency on record.',
        credits: pairCredits(sc, course.credits, e.credits), explicit: e.credits != null,
      });
    }
  }
  const facts: ExternalCourseFacts = { code: sc.code, title: sc.title, credits: sc.convertedCredits, text: sc.text };
  const cands: RulesCandidate[] = rulesMatch(facts, uni.catalogue, MAX_CANDIDATES);
  for (const c of cands) {
    if (knownIds.has(c.courseId)) continue;
    const course = byId.get(c.courseId)!;
    out.push({
      sc, course, kind: 'suggested', outcome: null, confidence: c.confidence,
      reason: c.rationale.replace('[Built-in rules] ', '').replace(' Please verify against the syllabus.', ''),
      credits: pairCredits(sc, course.credits, null), explicit: false,
    });
  }
  return out;
}

const rank = (p: Pair) => (p.kind === 'known' ? 2 : 1) * 10 + (p.kind === 'known' ? (p.outcome === 'equivalent' ? 1 : 0) : p.confidence ?? 0);

/** Greedy one-to-one assignment: each student course and each university course is used at most once. */
export function assign(pairs: Pair[]): Pair[] {
  const sorted = [...pairs].sort((a, b) => rank(b) - rank(a));
  const usedS = new Set<string>();
  const usedC = new Set<number>();
  const out: Pair[] = [];
  for (const p of sorted) {
    if (usedS.has(p.sc.id) || usedC.has(p.course.id)) continue;
    usedS.add(p.sc.id);
    usedC.add(p.course.id);
    out.push(p);
  }
  return out;
}

const toMatched = (p: Pair, transfer = p.credits): MatchedCourse => ({
  studentCourseId: p.sc.id,
  studentCode: p.sc.code,
  studentTitle: p.sc.title,
  convertedCredits: p.sc.convertedCredits,
  kind: p.kind,
  universityCourseId: p.course.id,
  universityCode: p.course.code,
  universityTitle: p.course.title,
  universityCredits: p.course.credits,
  transferCredits: r2(transfer),
  outcome: p.outcome,
  confidence: p.confidence,
  reason: p.reason,
});

/** Applies a credit cap to matched courses in priority order (known first, then by confidence); returns the credits kept. */
export function applyCap(matched: MatchedCourse[], cap: number): { kept: MatchedCourse[]; capped: boolean } {
  const order = [...matched].sort((a, b) => (a.kind === b.kind ? (b.confidence ?? 1) - (a.confidence ?? 1) : a.kind === 'known' ? -1 : 1));
  let left = cap;
  let capped = false;
  const keptIds = new Map<string, number>();
  for (const m of order) {
    const give = Math.max(0, Math.min(m.transferCredits, left));
    if (give < m.transferCredits) capped = true;
    left = r2(left - give);
    keptIds.set(m.studentCourseId, give);
  }
  return { kept: matched.map((m) => ({ ...m, transferCredits: r2(keptIds.get(m.studentCourseId) ?? 0) })), capped };
}

function sums(matched: MatchedCourse[]) {
  let known = 0;
  let suggested = 0;
  for (const m of matched) (m.kind === 'known' ? (known += m.transferCredits) : (suggested += m.transferCredits));
  return { known: r2(known), suggested: r2(suggested) };
}

export function compareUniversity(student: StudentCourseInput[], uni: UniversityInput): UniversityComparison {
  const pairsByCourse = new Map<string, Pair[]>();
  for (const sc of student) pairsByCourse.set(sc.id, candidatePairs(sc, uni));

  // University-level: best one-to-one assignment over the whole catalogue.
  const all = assign([...pairsByCourse.values()].flat());
  const matchedAll = applyCap(all.map((p) => toMatched(p)), uni.cap);
  const matchedIds = new Set(all.map((p) => p.sc.id));

  const programCourseIds = new Set<number>();
  const programs: ProgramRollup[] = [];
  for (const prog of uni.programs) {
    const inProg = new Set(prog.courseIds);
    prog.courseIds.forEach((id) => programCourseIds.add(id));
    const progPairs = [...pairsByCourse.values()].flat().filter((p) => inProg.has(p.course.id));
    const assigned = assign(progPairs);
    if (!assigned.length) continue;
    const capRes = applyCap(assigned.map((p) => toMatched(p)), uni.cap);
    const s = sums(capRes.kept);
    programs.push({
      programId: prog.id, name: prog.name, area: prog.area, degree: prog.degree, school: prog.school,
      matched: capRes.kept.sort((a, b) => (a.kind === b.kind ? b.transferCredits - a.transferCredits : a.kind === 'known' ? -1 : 1)),
      knownCredits: s.known, suggestedCredits: s.suggested, transferableCredits: r2(s.known + s.suggested),
      coursesCovered: assigned.length, capped: capRes.capped,
    });
  }
  programs.sort((a, b) => b.transferableCredits - a.transferableCredits || b.coursesCovered - a.coursesCovered || a.name.localeCompare(b.name));

  const total = sums(matchedAll.kept);
  const noMatch: UnmatchedStudentCourse[] = student
    .filter((sc) => !matchedIds.has(sc.id))
    .map((sc) => ({
      studentCourseId: sc.id, studentCode: sc.code, studentTitle: sc.title, convertedCredits: sc.convertedCredits,
      reason: sc.notEligible ? 'Not eligible for transfer under the rules (for example grade or grading basis).' : 'No match yet: a department review would be needed.',
    }));

  return {
    institutionId: uni.id, code: uni.code, name: uni.name, cap: uni.cap,
    summary: {
      studentCourses: student.length,
      coursesMatched: all.length,
      coursesKnown: all.filter((p) => p.kind === 'known').length,
      coursesSuggested: all.filter((p) => p.kind === 'suggested').length,
      percentMatched: student.length ? Math.round((all.length / student.length) * 100) : 0,
      knownCredits: total.known,
      suggestedCredits: total.suggested,
      transferableCredits: r2(total.known + total.suggested),
      capped: matchedAll.capped,
    },
    programs,
    otherMatches: matchedAll.kept.filter((m) => !programCourseIds.has(m.universityCourseId)),
    noMatch,
  };
}
