/**
 * Pure aggregation for the AI Controls "Learning" tab: turns decided evaluations, incoming courses,
 * equivalencies and usage-log rows into weekly series, headline deltas and recurring mistakes.
 * No database access here so it can be unit-tested (scripts/test-learning-trend.ts).
 */

export interface DecisionRow {
  decidedAt: Date | string;
  /** The matcher's top pick (rank 1) for this course, if it made one. */
  aiTopId: number | null;
  /** Rank 1..3 picks. */
  aiTop3Ids: number[];
  aiConfidence: number | null;
  /** BU course the faculty member chose (null when decided elective / no credit). */
  decidedCourseId: number | null;
  outcome: string;
  /** Decision recorded by "accept AI suggestion" / auto-approve (note marker). */
  auto: boolean;
  extLabel?: string;
  extInstitution?: string;
  extCode?: string;
  aiLabel?: string;
  aiCode?: string;
  decidedLabel?: string;
  decidedCode?: string;
}
export interface CourseRow { createdAt: Date | string; lane: string }
export interface EquivalencyRow { createdAt: Date | string; label?: string }
export interface UsageRow { createdAt: Date | string; skipReason: string | null }

export interface WeekPoint {
  /** ISO date (Monday, UTC) the week starts on. */
  weekStart: string;
  decided: number;
  withSuggestion: number;
  agreed: number;
  top3Hits: number;
  overrides: number;
  agreementRate: number | null;
  top3Rate: number | null;
  avgConfidenceRight: number | null;
  avgConfidenceWrong: number | null;
  autoApplied: number;
  /** Picks at/above the auto-apply threshold that faculty decided differently. */
  highConfidence: number;
  autoAppliedWrong: number;
  safetyRate: number | null;
  /** Answers served from the match cache / the shared equivalency table instead of a fresh model call. */
  cacheHits: number;
  knownHits: number;
  incoming: number;
  instant: number;
  instantShare: number | null;
  newEquivalencies: number;
  knowledgeBase: number;
}

export interface TrendInput {
  decisions: DecisionRow[];
  courses: CourseRow[];
  equivalencies: EquivalencyRow[];
  usage: UsageRow[];
  autoApplyThreshold?: number;
}

const DAY = 86_400_000;
const toMs = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

export function weekStartMs(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}
export const weekKey = (ms: number) => new Date(weekStartMs(ms)).toISOString().slice(0, 10);

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null);

export function isAgreement(d: DecisionRow): boolean {
  return d.aiTopId != null && d.outcome === 'equivalent' && d.decidedCourseId != null && d.decidedCourseId === d.aiTopId;
}
/** A decision that can be scored: the matcher offered a pick and the faculty chose a specific BU course. */
export function isScorable(d: DecisionRow): boolean {
  return d.aiTopId != null && d.outcome === 'equivalent' && d.decidedCourseId != null;
}

export function buildWeeklySeries(input: TrendInput, weeks: number, now: number = Date.now()): WeekPoint[] {
  const n = Math.max(1, Math.min(104, Math.trunc(weeks) || 26));
  const thr = input.autoApplyThreshold ?? 0.85;
  const last = weekStartMs(now);
  const first = last - (n - 1) * 7 * DAY;
  const idx = (ms: number) => Math.floor((weekStartMs(ms) - first) / (7 * DAY));

  const pts: WeekPoint[] = [];
  const right: number[][] = [];
  const wrong: number[][] = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      weekStart: new Date(first + i * 7 * DAY).toISOString().slice(0, 10),
      decided: 0, withSuggestion: 0, agreed: 0, top3Hits: 0, overrides: 0, agreementRate: null, top3Rate: null,
      avgConfidenceRight: null, avgConfidenceWrong: null, autoApplied: 0, highConfidence: 0, autoAppliedWrong: 0, safetyRate: null,
      cacheHits: 0, knownHits: 0, incoming: 0, instant: 0, instantShare: null, newEquivalencies: 0, knowledgeBase: 0,
    });
    right.push([]);
    wrong.push([]);
  }

  for (const d of input.decisions) {
    const ms = toMs(d.decidedAt);
    if (!Number.isFinite(ms)) continue;
    const i = idx(ms);
    if (i < 0 || i >= n) continue;
    const p = pts[i];
    p.decided++;
    if (d.auto) p.autoApplied++;
    if (!isScorable(d)) continue;
    p.withSuggestion++;
    if (isAgreement(d)) {
      p.agreed++;
      if (d.aiConfidence != null) right[i].push(Number(d.aiConfidence));
    } else {
      p.overrides++;
      if (d.aiConfidence != null) wrong[i].push(Number(d.aiConfidence));
    }
    if (d.decidedCourseId != null && d.aiTop3Ids.includes(d.decidedCourseId)) p.top3Hits++;
    if (d.aiConfidence != null && Number(d.aiConfidence) >= thr) {
      p.highConfidence++;
      if (!isAgreement(d)) p.autoAppliedWrong++;
    }
  }

  for (const c of input.courses) {
    const ms = toMs(c.createdAt);
    if (!Number.isFinite(ms)) continue;
    const i = idx(ms);
    if (i < 0 || i >= n) continue;
    pts[i].incoming++;
    if (c.lane === 'applied') pts[i].instant++;
  }
  for (const u of input.usage) {
    const ms = toMs(u.createdAt);
    if (!Number.isFinite(ms)) continue;
    const i = idx(ms);
    if (i < 0 || i >= n) continue;
    if (u.skipReason === 'cache_hit') pts[i].cacheHits++;
    else if (u.skipReason === 'equivalency_exists') pts[i].knownHits++;
  }

  let kb = 0;
  for (const e of input.equivalencies) {
    const ms = toMs(e.createdAt);
    if (!Number.isFinite(ms)) continue;
    if (ms < first) kb++;
    else {
      const i = idx(ms);
      if (i < n) pts[i].newEquivalencies++;
    }
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    kb += p.newEquivalencies;
    p.knowledgeBase = kb;
    p.agreementRate = rate(p.agreed, p.withSuggestion);
    p.top3Rate = rate(p.top3Hits, p.withSuggestion);
    p.avgConfidenceRight = avg(right[i]);
    p.avgConfidenceWrong = avg(wrong[i]);
    p.safetyRate = p.highConfidence ? rate(p.highConfidence - p.autoAppliedWrong, p.highConfidence) : null;
    p.instantShare = rate(p.instant, p.incoming);
  }
  return pts;
}

export interface Headline {
  value: number | null;
  previous: number | null;
  /** value - previous, in the metric's own unit (percentage points, or items for the knowledge base). */
  delta: number | null;
}
export interface OverviewHeadlines {
  agreement: Headline;
  top3: Headline;
  safety: Headline;
  instantShare: Headline;
  knowledgeBase: Headline;
  sampleSize: { current: number; previous: number };
}

const sum = (pts: WeekPoint[], k: keyof WeekPoint) => pts.reduce((a, p) => a + (Number(p[k]) || 0), 0);
const head = (v: number | null, p: number | null): Headline => ({
  value: v, previous: p, delta: v != null && p != null ? Math.round((v - p) * 10) / 10 : null,
});

/** Last `window` weeks against the `window` weeks before them (pooled, not an average of weekly rates). */
export function buildHeadlines(series: WeekPoint[], window = 4): OverviewHeadlines {
  const cur = series.slice(Math.max(0, series.length - window));
  const prev = series.slice(Math.max(0, series.length - 2 * window), Math.max(0, series.length - window));
  const m = (pts: WeekPoint[]) => ({
    agreement: rate(sum(pts, 'agreed'), sum(pts, 'withSuggestion')),
    top3: rate(sum(pts, 'top3Hits'), sum(pts, 'withSuggestion')),
    safety: sum(pts, 'highConfidence') ? rate(sum(pts, 'highConfidence') - sum(pts, 'autoAppliedWrong'), sum(pts, 'highConfidence')) : null,
    instant: rate(sum(pts, 'instant'), sum(pts, 'incoming')),
  });
  const a = m(cur);
  const b = m(prev);
  const kbNow = cur.length ? cur[cur.length - 1].knowledgeBase : 0;
  const kbThen = prev.length ? prev[prev.length - 1].knowledgeBase : null;
  return {
    agreement: head(a.agreement, b.agreement),
    top3: head(a.top3, b.top3),
    safety: head(a.safety, b.safety),
    instantShare: head(a.instant, b.instant),
    knowledgeBase: { value: kbNow, previous: kbThen, delta: kbThen != null ? kbNow - kbThen : null },
    sampleSize: { current: sum(cur, 'withSuggestion'), previous: sum(prev, 'withSuggestion') },
  };
}

export interface RecurringMistake {
  key: string;
  extInstitution: string;
  extCode: string;
  extLabel: string;
  aiCode: string;
  aiLabel: string;
  decidedCode: string;
  decidedLabel: string;
  count: number;
  lastSeen: string;
  title: string;
  instructions: string;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function mistakeKey(d: DecisionRow) {
  return `ov:${d.extInstitution ?? ''}|${d.extCode ?? ''}|${d.decidedCode ?? ''}`;
}

/** Same rule text/key format as AiLearningService.learn(), so the existing "add as rule" flow recognises it. */
export function ruleFor(d: DecisionRow): { key: string; title: string; instructions: string } {
  const inst = d.extInstitution ?? '';
  const ext = d.extCode ?? '';
  return {
    key: mistakeKey(d),
    title: cut(`Prefer ${d.decidedCode} for ${inst} ${ext}`, 150),
    instructions: cut(
      `For ${inst} "${ext} ${d.extLabel ?? ''}" (and very similar courses), faculty have mapped it to ${d.decidedCode} ${d.decidedLabel ?? ''}, ` +
      `not ${d.aiCode} ${d.aiLabel ?? ''}. Rank ${d.decidedCode} first for this kind of course.`, 2000),
  };
}

/** Course pairs the matcher keeps getting wrong: top pick differs from the faculty choice, same course, same answer. */
export function rankRecurringMistakes(decisions: DecisionRow[], opts: { minCount?: number; limit?: number } = {}): RecurringMistake[] {
  const min = opts.minCount ?? 2;
  const limit = opts.limit ?? 5;
  const groups = new Map<string, { sample: DecisionRow; count: number; last: number }>();
  for (const d of decisions) {
    if (!isScorable(d) || isAgreement(d) || !d.extCode || !d.decidedCode || !d.aiCode) continue;
    const k = `${mistakeKey(d)}|${d.aiCode}`;
    const ms = toMs(d.decidedAt);
    const g = groups.get(k);
    if (g) {
      g.count++;
      if (ms > g.last) g.last = ms;
    } else groups.set(k, { sample: d, count: 1, last: ms });
  }
  return [...groups.values()]
    .filter((g) => g.count >= min)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map((g) => {
      const r = ruleFor(g.sample);
      const d = g.sample;
      return {
        key: r.key,
        extInstitution: d.extInstitution ?? '',
        extCode: d.extCode ?? '',
        extLabel: d.extLabel ?? '',
        aiCode: d.aiCode ?? '',
        aiLabel: d.aiLabel ?? '',
        decidedCode: d.decidedCode ?? '',
        decidedLabel: d.decidedLabel ?? '',
        count: g.count,
        lastSeen: Number.isFinite(g.last) ? new Date(g.last).toISOString() : '',
        title: r.title,
        instructions: r.instructions,
      };
    });
}

/** Override patterns that used to repeat (>= minCount before the cut-off) and have not happened since. */
export function countResolvedPatterns(decisions: DecisionRow[], now: number, days = 30, minCount = 2): number {
  const cutoff = now - days * DAY;
  const before = new Map<string, number>();
  const recent = new Set<string>();
  for (const d of decisions) {
    if (!isScorable(d) || isAgreement(d) || !d.extCode || !d.decidedCode) continue;
    const k = mistakeKey(d);
    if (toMs(d.decidedAt) >= cutoff) recent.add(k);
    else before.set(k, (before.get(k) ?? 0) + 1);
  }
  let n = 0;
  for (const [k, c] of before) if (c >= minCount && !recent.has(k)) n++;
  return n;
}

export function countInWindow(rows: { createdAt: Date | string }[], now: number, days = 30): number {
  const cutoff = now - days * DAY;
  return rows.filter((r) => toMs(r.createdAt) >= cutoff).length;
}
