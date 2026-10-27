import { tokenize } from '../ai/course-prefilter';

/**
 * Pure helpers for the side-by-side course comparison (no database, no I/O).
 * Tokenising deliberately reuses the matcher's own `tokenize` so "shared words" here means the same
 * thing the shortlist/rules matcher counted.
 */

export interface TopicLite {
  title: string;
  description?: string | null;
}

export interface CourseText {
  title: string;
  description?: string | null;
  outcomes?: string[];
  topics?: TopicLite[];
}

/** LearningOutcomes is "JSON array or plain text" (migration 003): always return a clean string list. */
export function parseOutcomes(raw: string | null | undefined): string[] {
  const s = (raw ?? '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).map((x) => x.trim()).filter(Boolean);
    } catch {
      /* fall through to plain text */
    }
  }
  return s.split(/\r?\n|;\s+/).map((x) => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
}

export function courseTokens(c: CourseText): Set<string> {
  return tokenize([c.title, c.description ?? '', ...(c.outcomes ?? []), ...(c.topics ?? []).map((t) => `${t.title} ${t.description ?? ''}`)].join(' '));
}

export interface TopicMatch {
  external: string;
  bu: string;
  sharedTerms: string[];
}

export interface Overlap {
  /** Terms (lower-case) present in both courses' text, sorted. */
  sharedTerms: string[];
  /** Cosine similarity of the two term sets, 0-100 (same measure the matcher's shortlist uses). */
  overlapPct: number;
  externalTermCount: number;
  buTermCount: number;
  topicMatches: TopicMatch[];
}

function intersect(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const t of a) if (b.has(t)) out.push(t);
  return out.sort();
}

/** Pairs each external topic with its best BU topic when they share >= 2 terms, or the whole shorter title. */
export function matchTopics(ext: TopicLite[], bu: TopicLite[]): TopicMatch[] {
  const out: TopicMatch[] = [];
  const used = new Set<number>();
  for (const e of ext) {
    const et = tokenize(`${e.title} ${e.description ?? ''}`);
    const etTitle = tokenize(e.title);
    let best: { i: number; shared: string[] } | null = null;
    bu.forEach((b, i) => {
      if (used.has(i)) return;
      const bt = tokenize(`${b.title} ${b.description ?? ''}`);
      const shared = intersect(et, bt);
      const btTitle = tokenize(b.title);
      const titleCover = etTitle.size > 0 && btTitle.size > 0 && intersect(etTitle, btTitle).length >= Math.min(etTitle.size, btTitle.size);
      if (shared.length >= 2 || titleCover) {
        if (!best || shared.length > best.shared.length) best = { i, shared };
      }
    });
    if (best) {
      const hit: { i: number; shared: string[] } = best;
      used.add(hit.i);
      out.push({ external: e.title, bu: bu[hit.i].title, sharedTerms: hit.shared.slice(0, 8) });
    }
  }
  return out;
}

export function computeOverlap(ext: CourseText, bu: CourseText): Overlap {
  const a = courseTokens(ext);
  const b = courseTokens(bu);
  const shared = intersect(a, b);
  const pct = a.size && b.size ? (shared.length / Math.sqrt(a.size * b.size)) * 100 : 0;
  return {
    sharedTerms: shared,
    overlapPct: Math.round(Math.min(100, pct)),
    externalTermCount: a.size,
    buTermCount: b.size,
    topicMatches: matchTopics(ext.topics ?? [], bu.topics ?? []),
  };
}

export interface CreditMath {
  calendar: string | null;
  externalCredits: number;
  /** 2/3 for quarter schools, 1 otherwise. */
  factor: number;
  /** Stored NormalisedCredits when triage has run, else computed with the same rule as sp_TriageCourse. */
  convertedCredits: number;
  buCredits: number | null;
  /** converted - BU credits: negative = shortfall, positive = surplus, 0 = exact. null without a BU course. */
  difference: number | null;
  status: 'exact' | 'shortfall' | 'surplus' | 'no_candidate';
  quarterTruncated: boolean;
  note: string;
  /** Credits each decision would award, so the UI can show them before the click. */
  awardIfEquivalent: number | null;
  awardIfElective: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** sp_TriageCourse (CR-01/02): quarter credits x 2/3, FLOOR to 2 decimals; semester/trimester unchanged. */
export function convertCredits(original: number, calendar: string | null | undefined): number {
  if ((calendar ?? '').toLowerCase() === 'quarter') return Math.floor(((original * 2) / 3) * 100) / 100;
  return original;
}

export function creditMath(opts: {
  originalCredits: number;
  normalisedCredits: number | null;
  calendar: string | null;
  buCredits: number | null;
}): CreditMath {
  const quarter = (opts.calendar ?? '').toLowerCase() === 'quarter';
  const original = Number(opts.originalCredits);
  const converted = round2(opts.normalisedCredits != null ? Number(opts.normalisedCredits) : convertCredits(original, opts.calendar));
  const bu = opts.buCredits == null ? null : Number(opts.buCredits);
  const diff = bu == null ? null : round2(converted - bu);
  const status: CreditMath['status'] = bu == null ? 'no_candidate' : diff === 0 ? 'exact' : diff! < 0 ? 'shortfall' : 'surplus';
  const exactThird = quarter && Math.abs((original * 2) / 3 - converted) < 1e-9;
  const quarterTruncated = quarter && !exactThird;
  const parts: string[] = [];
  if (quarter) {
    parts.push(
      `Quarter-system credits convert at 2/3 (${original} x 2/3 = ${converted})` +
        (quarterTruncated ? ', truncated (not rounded) to two decimals.' : '.'),
    );
  } else {
    parts.push('Semester-system credits are taken as stated (no conversion).');
  }
  if (status === 'shortfall') parts.push(`The transferring course is ${Math.abs(diff!)} credit(s) short of the BU course; a full equivalent may need a reviewer's judgement.`);
  if (status === 'surplus') parts.push(`The transferring course carries ${diff} more credit(s) than the BU course; the extra is not awarded as the equivalent.`);
  if (status === 'exact') parts.push('Credits line up exactly.');
  return {
    calendar: opts.calendar ?? null,
    externalCredits: original,
    factor: quarter ? 2 / 3 : 1,
    convertedCredits: converted,
    buCredits: bu,
    difference: diff,
    status,
    quarterTruncated,
    note: parts.join(' '),
    awardIfEquivalent: bu,
    awardIfElective: converted,
  };
}
