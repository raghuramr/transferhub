/**
 * Pure aggregation behind GET /progress/*: turns the rows a student's requests already have
 * (lane, evaluation outcome, AI suggestion, policy flags) into secure / likely / pending / not-counted
 * credit buckets. No database access here so it can be tested with synthetic rows.
 */

import type { CreditDeadline } from '../policy/credit-deadline';

export type Bucket = 'secure' | 'likely' | 'pending' | 'not_counted';

export interface ProgressFlag {
  code: string;
  severity?: string;
  message?: string;
}

export interface ProgressCourseRow {
  id: string;
  courseCode: string;
  courseTitle: string;
  lane: string;
  status: string;
  originalCredits: number;
  normalisedCredits: number | null;
  grade?: string | null;
  evalStatus: string | null;
  outcome: string | null;
  awardedCredits: number | null;
  decidedBuCode?: string | null;
  decidedBuTitle?: string | null;
  aiConfidence: number | null;
  aiBuCode?: string | null;
  aiBuTitle?: string | null;
  aiBuCredits: number | null;
  flags: ProgressFlag[];
  isOutsideUS?: boolean;
  appealStatus?: string | null;
  hasSyllabus?: boolean;
}

export interface ProgressRequestRow {
  id: string;
  institutionName: string;
  calendar: string | null;
  kind: string; // official | preview | preapproval
  status: string;
  receivedAt: string | Date | null;
  courses: ProgressCourseRow[];
}

export interface ProgressOptions {
  cap: number;
  examCredits: number;
  likelyThreshold: number;
  hubRequirements: number;
  hubCocurricularAllowed: number;
  applicantType?: string | null;
  policyKnown?: boolean;
  /** PRG-02 deadline for this student (null when migration 024 is not applied). */
  deadline?: CreditDeadline | null;
}

export interface CourseProgress {
  id: string;
  courseCode: string;
  courseTitle: string;
  lane: string;
  bucket: Bucket;
  grade: string | null;
  originalCredits: number;
  convertedCredits: number;
  awardedCredits: number | null;
  /** Provisional credit range for this course (only meaningful for secure/likely). */
  low: number;
  high: number;
  buCourse: string | null;
  nextStep: string;
}

export interface Totals {
  secure: number;
  likelyLow: number;
  likelyHigh: number;
  pending: number;
  notCounted: number;
}

export interface RequestProgress {
  id: string;
  institutionName: string;
  kind: string;
  status: string;
  receivedAt: string | Date | null;
  totals: Totals;
  courses: CourseProgress[];
}

export interface ProgressResult {
  totals: Totals;
  cap: { limit: number; examCredits: number; used: number; projectedMax: number; remaining: number; applicantType: string | null };
  hub: { requirements: number; cocurricularAllowed: number; note: string };
  requests: RequestProgress[];
  isProvisional: boolean;
  /** PRG-02: when everything must be transferred by, plus how many courses still wait on a decision. */
  deadline: (CreditDeadline & { pendingCourses: number }) | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/** Quarter credits convert at 2/3, truncated to 2 decimals (same as sp_TriageCourse). */
export function convertCredits(original: number, normalised: number | null | undefined, calendar: string | null | undefined): number {
  if (normalised != null && !Number.isNaN(Number(normalised))) return r2(Number(normalised));
  if (calendar === 'quarter') return Math.floor((original * 2) / 3 * 100) / 100;
  return r2(original);
}

const emptyTotals = (): Totals => ({ secure: 0, likelyLow: 0, likelyHigh: 0, pending: 0, notCounted: 0 });

export function classifyCourse(c: ProgressCourseRow, calendar: string | null, kind: string, o: Pick<ProgressOptions, 'cap' | 'likelyThreshold'>): CourseProgress {
  const converted = convertCredits(num(c.originalCredits), c.normalisedCredits, calendar);
  const flagCodes = new Set((c.flags ?? []).map((f) => f.code));
  const code = c.courseCode;
  const base = {
    id: c.id,
    courseCode: c.courseCode,
    courseTitle: c.courseTitle,
    lane: c.lane,
    grade: c.grade ?? null,
    originalCredits: num(c.originalCredits),
    convertedCredits: converted,
    awardedCredits: c.awardedCredits == null ? null : num(c.awardedCredits),
  };
  const out = (bucket: Bucket, low: number, high: number, nextStep: string, buCourse: string | null = null): CourseProgress => ({
    ...base, bucket, low: r2(low), high: r2(high), nextStep, buCourse,
  });
  const decidedBu = c.decidedBuCode ?? null;
  const preview = kind === 'preview';

  // 1. Coursework outside the US is never evaluated in this request.
  if (c.isOutsideUS || flagCodes.has('international')) {
    return out('pending', 0, 0, 'Completed outside the US: International Admissions evaluates this separately.');
  }

  // 2. A person's decision wins over everything else.
  if (c.outcome === 'no_credit' || c.outcome === 'bu_only') {
    return out('not_counted', 0, 0, c.outcome === 'bu_only' ? `${code} can only be taken at BU, so no transfer credit is given.` : `No credit was awarded for ${code}.`);
  }
  if ((c.outcome === 'equivalent' || c.outcome === 'elective') && (c.evalStatus === 'decided' || c.evalStatus === 'posted' || c.status === 'decided' || c.status === 'posted')) {
    const awarded = c.awardedCredits != null ? num(c.awardedCredits) : converted;
    const label = c.outcome === 'elective' ? 'Elective credit' : decidedBu ? `Counts as ${decidedBu}` : 'Equivalent credit';
    if (preview) {
      return out('likely', awarded, awarded, `${label}. Preview only: it becomes official once you are admitted.`, decidedBu);
    }
    return out('secure', awarded, awarded, c.evalStatus === 'posted' || c.status === 'posted' ? `${label}. Posted to your record.` : `${label}. Decided; waiting to be posted.`, decidedBu);
  }

  // 3. Rules engine verdicts.
  if (c.lane === 'not_eligible') {
    const f = (c.flags ?? []).find((x) => x.severity === 'block');
    return out('not_counted', 0, 0, f?.message ? shorten(f.message) : `${code} is not eligible for transfer credit.`);
  }
  if (flagCodes.has('over_cap')) {
    return out('not_counted', 0, 0, `Over the ${o.cap}-credit cap on external credit.`);
  }

  // 4. Exact equivalency applied by the rules engine.
  if (c.lane === 'applied') {
    if (preview) return out('likely', converted, converted, 'Matches an existing equivalency. Preview only: it becomes official once you are admitted.');
    return out('secure', converted, converted, 'Matched an existing equivalency and applied automatically.');
  }

  // 5. Suggestions (AI or built-in rules) above the threshold, or the likely lane.
  const conf = c.aiConfidence == null ? null : num(c.aiConfidence);
  const suggested = c.aiBuCredits == null ? null : num(c.aiBuCredits);
  const strongSuggestion = conf != null && conf >= o.likelyThreshold && suggested != null;
  if (c.lane === 'likely' || strongSuggestion) {
    const bu = c.aiBuCode ?? null;
    const sug = suggested ?? converted;
    const low = Math.min(converted, sug);
    const high = Math.max(converted, sug);
    return out('likely', low, high, bu ? `Likely counts as ${bu}; waiting for the department to confirm.` : 'Likely to count; waiting for the department to confirm.', bu);
  }
  if (c.lane === 'elective_only') {
    return out('likely', converted, converted, 'Likely elective credit; waiting for confirmation.');
  }

  // 6. Everything else is still open.
  if (c.appealStatus === 'submitted') return out('pending', 0, 0, 'Your appeal is with the department.');
  if (c.lane === 'needs_syllabus') {
    if (c.hasSyllabus) return out('pending', 0, 0, 'Waiting for the department to review your syllabus.');
    return out('pending', 0, 0, `Upload the syllabus for ${code}.`);
  }
  if (c.evalStatus === 'in_progress') return out('pending', 0, 0, 'Waiting for the department to review.');
  const f = (c.flags ?? []).find((x) => x.severity === 'review');
  return out('pending', 0, 0, f?.message ? `In review: ${shorten(f.message)}` : 'In review with the department.');
}

function shorten(s: string, max = 110): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}...`;
}

export function addTo(t: Totals, c: CourseProgress) {
  if (c.bucket === 'secure') t.secure += c.high;
  else if (c.bucket === 'likely') { t.likelyLow += c.low; t.likelyHigh += c.high; }
  else if (c.bucket === 'pending') t.pending += c.convertedCredits;
  else t.notCounted += c.convertedCredits;
}

const roundTotals = (t: Totals): Totals => ({
  secure: r2(t.secure), likelyLow: r2(t.likelyLow), likelyHigh: r2(t.likelyHigh), pending: r2(t.pending), notCounted: r2(t.notCounted),
});

export function buildProgress(requests: ProgressRequestRow[], o: ProgressOptions): ProgressResult {
  const grand = emptyTotals();
  const reqs: RequestProgress[] = requests.map((r) => {
    const t = emptyTotals();
    const courses = r.courses.map((c) => classifyCourse(c, r.calendar, r.kind, o));
    for (const c of courses) { addTo(t, c); addTo(grand, c); }
    return { id: r.id, institutionName: r.institutionName, kind: r.kind, status: r.status, receivedAt: r.receivedAt, totals: roundTotals(t), courses };
  });
  const totals = roundTotals(grand);
  const used = r2(totals.secure + o.examCredits);
  const projectedMax = r2(used + totals.likelyHigh);

  // Courses still waiting on a decision (pending or likely) in real (non-preview) requests; coursework outside the US is evaluated elsewhere.
  let pendingCourses = 0;
  requests.forEach((r, ri) => {
    if (r.kind === 'preview') return;
    reqs[ri].courses.forEach((cp, ci) => {
      const raw = r.courses[ci];
      const intl = raw.isOutsideUS || (raw.flags ?? []).some((f) => f.code === 'international');
      if ((cp.bucket === 'pending' || cp.bucket === 'likely') && !intl) pendingCourses++;
    });
  });

  const hubNote =
    `Transfer courses never satisfy BU Hub requirements: you will still complete ${o.hubRequirements} Hub requirements at BU` +
    (o.hubCocurricularAllowed ? ` (${o.hubCocurricularAllowed} co-curricular may be earned elsewhere).` : '.');

  return {
    totals,
    cap: {
      limit: o.cap,
      examCredits: r2(o.examCredits),
      used,
      projectedMax,
      remaining: Math.max(0, r2(o.cap - used)),
      applicantType: o.applicantType ?? null,
    },
    hub: { requirements: o.hubRequirements, cocurricularAllowed: o.hubCocurricularAllowed, note: hubNote },
    requests: reqs,
    deadline: o.deadline ? { ...o.deadline, pendingCourses } : null,
    isProvisional: totals.likelyHigh > 0 || totals.pending > 0 || reqs.some((r) => r.kind === 'preview'),
  };
}
