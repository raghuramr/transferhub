/**
 * Pure logic for programme rules (PRG-03..08): per-university, optionally per-programme requirements such as
 * "CS 320 must be taken at BU" or "at most 4 transferred Economics courses at 200+ level".
 *
 * Effects are FLAGS ONLY (GOV-01): a rule routes a course to department review or explains something; it never
 * denies credit by itself. No database access here so every rule type can be tested with synthetic data.
 */

export const RULE_TYPES = [
  'max_transfer_at_level',
  'min_at_home',
  'required_at_home',
  'substitution',
  'not_principal',
  'residency_courses_count',
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  max_transfer_at_level: 'Maximum transferred at a level',
  min_at_home: 'Minimum taken at the home university',
  required_at_home: 'Required course',
  substitution: 'Substitution',
  not_principal: 'Not a principal course',
  residency_courses_count: 'Courses required in residency',
};

export interface ProgramRule {
  id: number;
  institutionId: number;
  institutionCode?: string | null;
  programId: number | null;
  programName?: string | null;
  ruleCode?: string | null;
  ruleType: RuleType;
  levelMin: number | null;
  maxCount: number | null;
  minCount: number | null;
  /** Course codes (CAS CS 320 | MA 242) or a department prefix (BI); several joined by | or a comma. */
  courseCodePattern: string | null;
  /** substitution: the required course the pattern's courses may stand in for. */
  substituteFor: string | null;
  /** Extra settings: excludeCodes[], allOf, enforcement ('info' softens required_at_home), bidirectional... */
  params: Record<string, unknown>;
  description: string;
  isActive: boolean;
}

/** One course of the request being checked, with the home-university courses it maps to (decided, mapped or auto-applied). */
export interface RuleCourse {
  id: string;
  code: string;
  lane: string;
  isOutsideUS?: boolean;
  buCodes: string[];
}

export interface RuleFlag {
  code: string;
  severity: 'review' | 'info';
  message: string;
}

/** Flag codes this module owns; they are stripped and rebuilt on every run so re-checking never duplicates them. */
export const PROGRAMME_FLAG_CODES = ['program_rule', 'program_substitution', 'program_at_home', 'partial_combination'] as const;

// ── course code handling ─────────────────────────────────────────

export interface ParsedCode {
  dept: string;
  num: number | null;
}

/**
 * Flexible course-code parsing: 'CAS CS 320', 'CS 320', 'cs320' -> {CS, 320}; 'QST QM 221' -> {QM, 221};
 * 'CHEM 1161' -> {CHEM, 1161}; a bare department 'BI' -> {BI, null}. The college prefix is ignored.
 */
export function parseCode(raw: string | null | undefined): ParsedCode | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/([A-Z]{1,8})\s*(\d{2,4})[A-Z]?$/);
  if (m) return { dept: m[1], num: Number(m[2]) };
  const d = s.match(/([A-Z]{1,8})$/);
  return d ? { dept: d[1], num: null } : null;
}

export const displayCode = (p: ParsedCode): string => (p.num == null ? p.dept : `${p.dept} ${p.num}`);

/** 'Hundreds level' of a course number: 2100 -> 200, 242 -> 200, 1161 -> 100. */
export function levelOf(num: number): number {
  return num >= 1000 ? Math.floor(num / 1000) * 100 : Math.floor(num / 100) * 100;
}

export function splitPattern(pattern: string | null | undefined): ParsedCode[] {
  if (!pattern) return [];
  return pattern
    .split(/[|,]/)
    .map((t) => parseCode(t))
    .filter((p): p is ParsedCode => !!p);
}

export function termMatches(term: ParsedCode, code: ParsedCode, levelMin?: number | null): boolean {
  if (term.dept !== code.dept) return false;
  if (term.num != null && term.num !== code.num) return false;
  if (levelMin != null && (code.num == null || levelOf(code.num) < levelMin)) return false;
  return true;
}

const matchesAny = (terms: ParsedCode[], code: ParsedCode, levelMin?: number | null) => terms.some((t) => termMatches(t, code, levelMin));

const parsedList = (codes: string[]) => codes.map((c) => parseCode(c)).filter((p): p is ParsedCode => !!p);

const stringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// ── the engine ───────────────────────────────────────────────────

/** Evaluates the rules against one request's courses. Returns flags per course id (courses with no flag are absent). */
export function evaluateProgrammeRules(rules: ProgramRule[], courses: RuleCourse[]): Map<string, RuleFlag[]> {
  const out = new Map<string, RuleFlag[]>();
  const add = (courseId: string, f: RuleFlag) => {
    const list = out.get(courseId) ?? [];
    if (!list.some((x) => x.code === f.code && x.message === f.message)) list.push(f);
    out.set(courseId, list);
  };

  const live = courses.filter((c) => !c.isOutsideUS && c.lane !== 'not_eligible');
  const withBu = live.map((c) => ({ c, bu: parsedList(c.buCodes) }));
  const allBu = withBu.flatMap((x) => x.bu);

  for (const rule of rules) {
    if (!rule.isActive) continue;
    const label = rule.programName ?? 'this programme';
    const home = rule.institutionCode ?? 'the home university';
    const terms = splitPattern(rule.courseCodePattern);
    const exclude = parsedList(stringArray(rule.params?.excludeCodes));
    const info = rule.params?.enforcement === 'info';

    switch (rule.ruleType) {
      case 'max_transfer_at_level': {
        if (rule.maxCount == null || rule.levelMin == null) break;
        const counted = withBu.filter(({ c, bu }) => {
          const p = bu[0] ?? parseCode(c.code);
          if (!p || p.num == null || levelOf(p.num) < rule.levelMin!) return false;
          return terms.length === 0 || matchesAny(terms, p);
        });
        if (counted.length > rule.maxCount) {
          for (const { c } of counted) {
            add(c.id, {
              code: 'program_rule',
              severity: 'review',
              message: `${label} allows at most ${rule.maxCount} transferred courses at ${rule.levelMin}+ level (${counted.length} listed); a reviewer decides which ones count.`,
            });
          }
        }
        break;
      }

      case 'required_at_home': {
        for (const { c, bu } of withBu) {
          for (const p of bu) {
            if (!matchesAny(terms, p)) continue;
            if (info) {
              add(c.id, { code: 'program_rule', severity: 'info', message: `${displayCode(p)} is a required course for ${label}; transfer credit counts only as an exact equivalent of it.` });
            } else {
              add(c.id, {
                code: 'program_at_home',
                severity: 'review',
                message: `${displayCode(p)} must be taken at ${home} (${label}); transfer credit cannot satisfy it. A reviewer decides whether it can count as an elective instead.`,
              });
            }
          }
        }
        break;
      }

      case 'min_at_home': {
        if (rule.minCount == null) break;
        for (const { c, bu } of withBu) {
          for (const p of bu) {
            if (!matchesAny(terms, p, rule.levelMin) || matchesAny(exclude, p)) continue;
            const beyond = exclude.length ? ` beyond ${exclude.map(displayCode).join('/')}` : '';
            add(c.id, {
              code: 'program_at_home',
              severity: 'review',
              message: `${label} needs at least ${rule.minCount} ${terms.map((t) => t.dept).join('/') || ''} courses${beyond} taken at ${home}; ${displayCode(p)} may not count toward them.`.replace(/\s+/g, ' '),
            });
          }
        }
        break;
      }

      case 'not_principal': {
        for (const { c, bu } of withBu) {
          for (const p of bu) {
            if (matchesAny(terms, p)) add(c.id, { code: 'program_rule', severity: 'info', message: `${displayCode(p)} is not counted as a principal course for ${label}.` });
          }
        }
        break;
      }

      case 'residency_courses_count': {
        const matched = withBu.filter(({ bu }) => bu.some((p) => terms.length === 0 || matchesAny(terms, p)));
        const tooMany = rule.maxCount != null && matched.length > rule.maxCount;
        for (const { c, bu } of matched) {
          const p = bu.find((x) => terms.length === 0 || matchesAny(terms, x))!;
          add(c.id, tooMany
            ? { code: 'program_rule', severity: 'review', message: `${label} allows at most ${rule.maxCount} transferred courses here (${matched.length} listed); a reviewer decides which ones count.` }
            : { code: 'program_rule', severity: 'info', message: `${label} requires ${rule.minCount ?? 'a number of'} courses in residency${rule.courseCodePattern ? ` (${rule.courseCodePattern})` : ''}; ${displayCode(p)} counts toward them only if the department accepts it.` });
        }
        break;
      }

      case 'substitution': {
        const required = parseCode(rule.substituteFor);
        if (!required) break;
        const subList = terms.map(displayCode).join(' + ');
        const allOf = rule.params?.allOf === true;
        if (allOf) {
          const have = terms.filter((t) => allBu.some((p) => termMatches(t, p)));
          for (const { c, bu } of withBu) {
            if (!bu.some((p) => matchesAny(terms, p))) continue;
            add(c.id, have.length === terms.length
              ? { code: 'program_substitution', severity: 'info', message: `substitution available: ${subList} together may satisfy ${displayCode(required)} (${label}).` }
              : { code: 'program_substitution', severity: 'info', message: `${subList} together may satisfy ${displayCode(required)} (${label}); only ${have.map(displayCode).join(', ')} is on this request.` });
          }
          break;
        }
        for (const { c, bu } of withBu) {
          for (const p of bu) {
            if (termMatches({ dept: required.dept, num: required.num }, p)) {
              add(c.id, { code: 'program_substitution', severity: 'info', message: `substitution available: ${displayCode(p)} may be satisfied by ${terms.map(displayCode).join(', ')} (${label}).` });
            } else if (matchesAny(terms, p)) {
              add(c.id, { code: 'program_substitution', severity: 'info', message: `substitution available: ${displayCode(p)} may satisfy ${displayCode(required)} (${label}).` });
            }
          }
        }
        break;
      }
    }
  }
  return out;
}

/** Replaces the flags this module owns with `extra`, keeping every other flag untouched. */
export function mergeOwnedFlags<T extends { code: string }>(existing: T[], extra: T[]): T[] {
  const owned = new Set<string>(PROGRAMME_FLAG_CODES);
  return [...existing.filter((f) => !owned.has(f.code)), ...extra];
}

// ── input validation (admin form / API) ──────────────────────────

export interface RuleInput {
  ruleType?: string;
  levelMin?: number | null;
  maxCount?: number | null;
  minCount?: number | null;
  courseCodePattern?: string | null;
  substituteFor?: string | null;
  description?: string | null;
  params?: Record<string, unknown> | null;
}

/** Returns a list of problems (empty = valid). Which fields a rule needs depends on its type. */
export function validateRuleInput(r: RuleInput): string[] {
  const errs: string[] = [];
  const t = r.ruleType as RuleType;
  if (!RULE_TYPES.includes(t)) return ['Choose a rule type.'];
  if (!r.description || !r.description.trim()) errs.push('Add a description.');
  const posInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (r.maxCount != null && !posInt(r.maxCount)) errs.push('Maximum must be a whole number of 0 or more.');
  if (r.minCount != null && !posInt(r.minCount)) errs.push('Minimum must be a whole number of 0 or more.');
  if (r.levelMin != null && !(posInt(r.levelMin) && r.levelMin <= 900)) errs.push('Level must be between 0 and 900 (for example 200).');
  if (r.courseCodePattern && splitPattern(r.courseCodePattern).length === 0) errs.push('Course codes look wrong. Use codes such as CS 320, separated by | .');
  const hasPattern = splitPattern(r.courseCodePattern).length > 0;
  switch (t) {
    case 'max_transfer_at_level':
      if (r.maxCount == null) errs.push('Set the maximum number of courses.');
      if (r.levelMin == null) errs.push('Set the level (for example 200).');
      break;
    case 'min_at_home':
      if (r.minCount == null) errs.push('Set the minimum number of courses.');
      if (!hasPattern) errs.push('Name the department (for example BI) or the courses.');
      break;
    case 'required_at_home':
    case 'not_principal':
      if (!hasPattern) errs.push('List the course codes.');
      break;
    case 'substitution':
      if (!hasPattern) errs.push('List the courses that may substitute.');
      if (!parseCode(r.substituteFor)?.num) errs.push('Give the course that is being substituted for, for example EC 203.');
      break;
    case 'residency_courses_count':
      if (r.minCount == null && r.maxCount == null) errs.push('Set a minimum or a maximum number of courses.');
      break;
  }
  if (r.params != null && (typeof r.params !== 'object' || Array.isArray(r.params))) errs.push('Settings must be a JSON object.');
  return errs;
}
