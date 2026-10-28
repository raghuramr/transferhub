import type { TokenUsage } from './ai-pricing';

/** One course matched by one engine, with what was measured and what the right answer was (if known). */
export interface BenchCase {
  engine: string;
  engineLabel: string;
  model: string;
  studentId: string;
  studentName: string;
  courseCode: string;
  courseTitle: string;
  institution: string;
  expected: { buCode: string; source: 'equivalency' | 'scenario' } | null;
  picks: { buCode: string; confidence: number }[];
  rank: number | null; // 1-based rank of the expected course among the picks, null if absent / unknown
  hit1: boolean | null;
  hit3: boolean | null;
  topConfidence: number | null;
  shortlistMs: number;
  callMs: number;
  parseMs: number;
  totalMs: number;
  usage: TokenUsage | null;
  costUsd: number;
  error?: string;
}

export interface EngineSummary {
  engine: string;
  label: string;
  model: string;
  courses: number;
  answered: number;
  failed: number;
  withTruth: number;
  top1: number | null; // % of courses with a known answer where the first pick was right
  top3: number | null;
  avgConfidenceRight: number | null;
  avgConfidenceWrong: number | null;
  autoApplied: number; // answers at or above the auto-apply threshold
  autoWrong: number; // ...of which the known answer disagreed (unsafe auto-approvals)
  avgMs: number;
  p95Ms: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  costPerCorrect: number | null;
  correctPerMinute: number | null;
  scores: { accuracy: number; speed: number; cost: number; overall: number };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const p95 = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};

/** Fills rank / hit flags from the picks and the expected answer. */
export function scoreCase(c: Omit<BenchCase, 'rank' | 'hit1' | 'hit3' | 'topConfidence'>): BenchCase {
  const idx = c.expected ? c.picks.findIndex((p) => p.buCode === c.expected!.buCode) : -1;
  return {
    ...c,
    rank: c.expected && idx >= 0 ? idx + 1 : null,
    hit1: c.expected ? idx === 0 : null,
    hit3: c.expected ? idx >= 0 && idx < 3 : null,
    topConfidence: c.picks[0]?.confidence ?? null,
  };
}

/**
 * Per-engine accuracy / speed / cost summary.
 * Scores (0-100): accuracy = 60% top-1 + 40% top-3; speed = fastest engine's average latency / this engine's; cost = 100 for a free
 * engine, otherwise 100 x (1 - cost / the most expensive engine's cost); overall = 50% accuracy + 25% speed + 25% cost.
 */
export function summarize(cases: BenchCase[], autoThreshold: number): EngineSummary[] {
  const engines = [...new Set(cases.map((c) => c.engine))];
  const rows = engines.map((engine) => {
    const mine = cases.filter((c) => c.engine === engine);
    const answered = mine.filter((c) => !c.error && c.picks.length > 0);
    const truth = mine.filter((c) => c.expected);
    const right = truth.filter((c) => c.hit1);
    const wrong = truth.filter((c) => c.hit1 === false && c.picks.length > 0);
    const auto = mine.filter((c) => (c.topConfidence ?? 0) >= autoThreshold);
    const ms = mine.map((c) => c.totalMs);
    const cost = mine.reduce((n, c) => n + c.costUsd, 0);
    const minutes = ms.reduce((a, b) => a + b, 0) / 60000;
    const top1 = truth.length ? (right.length / truth.length) * 100 : null;
    const top3 = truth.length ? (truth.filter((c) => c.hit3).length / truth.length) * 100 : null;
    return {
      engine,
      label: mine[0]?.engineLabel ?? engine,
      model: mine.find((c) => c.model)?.model ?? '',
      courses: mine.length,
      answered: answered.length,
      failed: mine.filter((c) => c.error).length,
      withTruth: truth.length,
      top1: round(top1),
      top3: round(top3),
      avgConfidenceRight: round(avg(right.map((c) => c.topConfidence ?? 0)), 2),
      avgConfidenceWrong: round(avg(wrong.map((c) => c.topConfidence ?? 0)), 2),
      autoApplied: auto.length,
      autoWrong: auto.filter((c) => c.hit1 === false).length,
      avgMs: Math.round(avg(ms) ?? 0),
      p95Ms: Math.round(p95(ms)),
      tokensIn: mine.reduce((n, c) => n + (c.usage?.input ?? 0), 0),
      tokensOut: mine.reduce((n, c) => n + (c.usage?.output ?? 0), 0),
      costUsd: Math.round(cost * 1e6) / 1e6,
      costPerCorrect: right.length && cost > 0 ? Math.round((cost / right.length) * 1e6) / 1e6 : null,
      correctPerMinute: minutes > 0 && truth.length ? round(right.length / minutes, 1) : null,
      _top1: top1 ?? 0,
      _top3: top3 ?? 0,
    };
  });
  const fastest = Math.min(...rows.map((r) => r.avgMs || Infinity));
  const maxCost = Math.max(0, ...rows.map((r) => r.costUsd));
  return rows.map(({ _top1, _top3, ...r }) => {
    const accuracy = 0.6 * _top1 + 0.4 * _top3;
    const speed = r.avgMs > 0 && Number.isFinite(fastest) ? (fastest / r.avgMs) * 100 : 100;
    const cost = maxCost > 0 ? 100 * (1 - r.costUsd / maxCost) : 100;
    return { ...r, scores: { accuracy: Math.round(accuracy), speed: Math.round(speed), cost: Math.round(cost), overall: Math.round(0.5 * accuracy + 0.25 * speed + 0.25 * cost) } };
  });
}
