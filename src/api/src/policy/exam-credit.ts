/**
 * Exam credit thresholds (AP / IB / CLEP / A-level). Pure logic, no database: see ExamCreditService for the
 * lookups and scripts/test-exam-credit.ts for the expected behaviour.
 *
 * Scores are compared on a numeric scale per exam: AP 1-5, IB 1-7, CLEP 20-80, A-level letters A*-E mapped to
 * 6..1. A rule says "this exam (optionally only subjects matching a pattern) counts when the score is at least
 * MinScore". An exam below the minimum is NOT counted toward the external-credit cap and is shown to reviewers and
 * the student; nothing is ever denied silently - a person can still award credit by hand.
 */

export type ExamType = 'AP' | 'IB' | 'A-level' | 'CLEP';
export const EXAM_TYPES: ExamType[] = ['AP', 'IB', 'A-level', 'CLEP'];

/** counts = meets the minimum; below_minimum = does not count; review = no rule / no usable score, a person decides. */
export type ExamState = 'counts' | 'below_minimum' | 'review';

export interface ExamRule {
  id?: number | null;
  /** null = the global default; a number = that university's own rule. */
  institutionId: number | null;
  examType: ExamType;
  /** null = any subject. Several alternatives may be separated with '|'; matched as whole words, case-insensitive. */
  subjectPattern: string | null;
  /** Minimum score as written (AP '3', IB '5', CLEP '50', A-level 'C'). */
  minScore: string;
  /** BU credits normally awarded when the exam counts; null = unknown (a person sets it). */
  creditsAwarded: number | null;
  isActive: boolean;
  notes?: string | null;
}

export interface ExamInput {
  examType: string;
  subject: string;
  score: string | null;
  credits?: number | null;
}

export interface ExamResult {
  examType: string;
  subject: string;
  score: string | null;
  state: ExamState;
  minScore: string | null;
  ruleId: number | null;
  /** Credits that count toward the external-credit cap (0 when below the minimum). */
  countedCredits: number;
  message: string;
}

/** Defaults (BU-like; doc 11 gives AP >= 3, CLEP >= 50, IB 4-5; doc 12 gives no BU figure). Confirm with BU. Used until migration 028 / seed 019. */
export const DEFAULT_EXAM_RULES: ExamRule[] = [
  { institutionId: null, examType: 'AP', subjectPattern: null, minScore: '3', creditsAwarded: null, isActive: true },
  { institutionId: null, examType: 'IB', subjectPattern: 'HL|Higher Level', minScore: '5', creditsAwarded: null, isActive: true },
  { institutionId: null, examType: 'CLEP', subjectPattern: null, minScore: '50', creditsAwarded: null, isActive: true },
  { institutionId: null, examType: 'A-level', subjectPattern: null, minScore: 'C', creditsAwarded: null, isActive: true },
];

const A_LEVEL: Record<string, number> = { 'A*': 6, A: 5, B: 4, C: 3, D: 2, E: 1 };

/** Numeric value of a score on the exam's own scale, or null if it is not a valid score for that exam. */
export function scoreOrdinal(examType: string, score: string | null | undefined): number | null {
  if (score == null) return null;
  const s = String(score).trim();
  if (!s) return null;
  if (examType === 'A-level') {
    const l = s.toUpperCase().replace(/\s*(STAR|\+)$/, '*');
    return l in A_LEVEL ? A_LEVEL[l] : null;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  const range: Record<string, [number, number]> = { AP: [1, 5], IB: [1, 7], CLEP: [20, 80] };
  const r = range[examType];
  if (!r || n < r[0] || n > r[1]) return null;
  return n;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does the rule's subject pattern match this subject? null/empty pattern matches everything. */
export function subjectMatches(pattern: string | null | undefined, subject: string): boolean {
  const alts = (pattern ?? '').split('|').map((x) => x.trim()).filter(Boolean);
  if (!alts.length) return true;
  return alts.some((a) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(a)}($|[^A-Za-z0-9])`, 'i').test(subject));
}

/**
 * The rules that apply to an exam: the university's own rules for that exam type when it has any, otherwise the
 * global ones. Among those, active rules whose subject matches; a specific pattern beats "any subject".
 */
export function pickRule(rules: ExamRule[], institutionId: number | null, examType: string, subject: string): ExamRule | null {
  const ofType = rules.filter((r) => r.isActive && r.examType === examType);
  const own = institutionId == null ? [] : ofType.filter((r) => r.institutionId === institutionId);
  const pool = own.length ? own : ofType.filter((r) => r.institutionId == null);
  const hits = pool.filter((r) => subjectMatches(r.subjectPattern, subject));
  if (!hits.length) return null;
  hits.sort((a, b) => (b.subjectPattern ? 1 : 0) - (a.subjectPattern ? 1 : 0) || (b.subjectPattern?.length ?? 0) - (a.subjectPattern?.length ?? 0));
  return hits[0];
}

export function evaluateExam(exam: ExamInput, rules: ExamRule[], institutionId: number | null): ExamResult {
  const name = `${exam.examType} ${exam.subject}`.trim();
  const base = { examType: exam.examType, subject: exam.subject, score: exam.score ?? null };
  const rule = pickRule(rules, institutionId, exam.examType, exam.subject);
  const own = exam.credits != null ? Number(exam.credits) : null;
  if (!rule) {
    return { ...base, state: 'review', minScore: null, ruleId: null, countedCredits: own ?? 0, message: `${name}: no minimum score is set for this exam, so a reviewer decides whether it counts.` };
  }
  const got = scoreOrdinal(exam.examType, exam.score);
  const min = scoreOrdinal(exam.examType, rule.minScore);
  const ruleId = rule.id ?? null;
  if (got == null || min == null) {
    return { ...base, state: 'review', minScore: rule.minScore, ruleId, countedCredits: own ?? rule.creditsAwarded ?? 0,
      message: got == null ? `${name}: ${exam.score ? `score "${exam.score}" is not a valid ${exam.examType} score` : 'no score was given'}, so a reviewer must check it against the minimum of ${rule.minScore}.` : `${name}: the minimum score is not set correctly, so a reviewer decides.` };
  }
  if (got < min) {
    return { ...base, state: 'below_minimum', minScore: rule.minScore, ruleId, countedCredits: 0,
      message: `${name} score ${exam.score} is below the minimum of ${rule.minScore} - not counted.` };
  }
  return { ...base, state: 'counts', minScore: rule.minScore, ruleId, countedCredits: own ?? rule.creditsAwarded ?? 0,
    message: `${name} score ${exam.score} meets the minimum of ${rule.minScore}.` };
}

export function evaluateExams(exams: ExamInput[], rules: ExamRule[], institutionId: number | null): ExamResult[] {
  return exams.map((e) => evaluateExam(e, rules, institutionId));
}

/** Credits that count toward the external-credit cap: qualifying (and still-to-review) exams only. */
export function countedExamCredits(results: ExamResult[]): number {
  return Math.round(results.reduce((n, r) => n + (r.state === 'below_minimum' ? 0 : r.countedCredits), 0) * 100) / 100;
}

// ── document checklist conditions (credential evaluation, translation, score reports) ──

export interface DocConditionContext {
  /** Any education row outside the US, or the registration said "coursework outside the US", or a course was flagged outside the US. */
  outsideUS: boolean;
  /** StudentProfiles.IsNativeEnglish (null = not answered). */
  nativeEnglish: boolean | null;
  hasExamCredits: boolean;
}

/**
 * Informational requirements shown to the student ("needed by International Admissions"). They never change the routing:
 * coursework outside the US stays with International Admissions and out of AI/evaluation. Returns null for other keys.
 */
export function conditionalDocApplies(key: string, ctx: DocConditionContext): boolean | null {
  switch (key) {
    case 'credential_evaluation': return ctx.outsideUS; // NACES-member course-by-course evaluation
    case 'certified_translation': return ctx.outsideUS && ctx.nativeEnglish === false; // certified English translation of non-English transcripts
    case 'exam_score_report': return ctx.hasExamCredits; // official report from the testing body
    default: return null;
  }
}
