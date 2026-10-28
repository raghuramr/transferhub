import { api } from './api';

export interface WeekPoint {
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
  highConfidence: number;
  autoAppliedWrong: number;
  safetyRate: number | null;
  cacheHits: number;
  knownHits: number;
  incoming: number;
  instant: number;
  instantShare: number | null;
  newEquivalencies: number;
  knowledgeBase: number;
}
export interface LearningTrend { weeks: number; institutionId: number | null; autoApplyThreshold: number; series: WeekPoint[] }

export interface Headline { value: number | null; previous: number | null; delta: number | null }
export interface LearningMistake {
  key: string; extInstitution: string; extCode: string; extLabel: string;
  aiCode: string; aiLabel: string; decidedCode: string; decidedLabel: string;
  count: number; lastSeen: string; title: string; instructions: string; alreadyInPlaybook: boolean;
}
export interface LearningOverview {
  headlines: {
    agreement: Headline; top3: Headline; safety: Headline; instantShare: Headline; knowledgeBase: Headline;
    sampleSize: { current: number; previous: number };
  };
  learned: { newEquivalencies: number; newEquivalencyExamples: string[]; playbookRulesAdded: number; patternsResolved: number; days: number };
  recurringMistakes: LearningMistake[];
  hasData: boolean;
}

export const learningApi = {
  trend: (weeks = 26, institutionId?: number | null) =>
    api.get<LearningTrend>('/ai-controls/learning/trend', { params: { weeks, institutionId: institutionId ?? undefined } }),
  overview: (institutionId?: number | null) =>
    api.get<LearningOverview>('/ai-controls/learning/overview', { params: { institutionId: institutionId ?? undefined } }),
};

/** Synthetic, clearly-labelled presentation data (never fetched, never stored). Deterministic. */
export function demoLearning(weeks = 26): { trend: LearningTrend; overview: LearningOverview } {
  const mondayMs = (() => {
    const d = new Date();
    const day = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86_400_000;
  })();
  const series: WeekPoint[] = [];
  let kb = 40;
  for (let i = 0; i < weeks; i++) {
    const t = i / (weeks - 1);
    const wobble = Math.sin(i * 1.7) * 2.5;
    const agree = Math.min(96, Math.round((52 + 38 * (1 - Math.exp(-3 * t)) + wobble) * 10) / 10);
    const top3 = Math.min(99, Math.round((agree + 12 + 8 * (1 - t)) * 10) / 10);
    const withSug = 18 + Math.round(t * 22) + (i % 3);
    const newEq = 2 + Math.round(t * 6) + (i % 2);
    kb += newEq;
    const incoming = withSug + 12;
    const instant = Math.round(incoming * (0.12 + 0.5 * t));
    series.push({
      weekStart: new Date(mondayMs - (weeks - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
      decided: withSug + 2, withSuggestion: withSug, agreed: Math.round((withSug * agree) / 100), top3Hits: Math.round((withSug * top3) / 100),
      overrides: withSug - Math.round((withSug * agree) / 100), agreementRate: agree, top3Rate: top3,
      avgConfidenceRight: 0.86, avgConfidenceWrong: 0.58, autoApplied: Math.round(withSug * 0.3), highConfidence: Math.round(withSug * 0.5),
      autoAppliedWrong: Math.max(0, Math.round(withSug * 0.5 * (0.08 * (1 - t)))), safetyRate: Math.round((92 + 7 * t) * 10) / 10,
      cacheHits: Math.round(t * 9), knownHits: Math.round(t * 14), incoming, instant, instantShare: Math.round((instant / incoming) * 1000) / 10,
      newEquivalencies: newEq, knowledgeBase: kb,
    });
  }
  const cur = series[series.length - 1];
  const prev = series[series.length - 5];
  const h = (v: number | null, p: number | null): Headline => ({ value: v, previous: p, delta: v != null && p != null ? Math.round((v - p) * 10) / 10 : null });
  return {
    trend: { weeks, institutionId: null, autoApplyThreshold: 0.85, series },
    overview: {
      headlines: {
        agreement: h(cur.agreementRate, prev.agreementRate), top3: h(cur.top3Rate, prev.top3Rate), safety: h(cur.safetyRate, prev.safetyRate),
        instantShare: h(cur.instantShare, prev.instantShare), knowledgeBase: h(cur.knowledgeBase, prev.knowledgeBase),
        sampleSize: { current: 120, previous: 96 },
      },
      learned: { newEquivalencies: 31, newEquivalencyExamples: ['DEMO NU CS 2000 -> BU CS 111', 'DEMO NYU CSCI-UA 101 -> BU CS 111', 'DEMO BSCC MAT 120 -> BU MA 123'], playbookRulesAdded: 4, patternsResolved: 3, days: 30 },
      recurringMistakes: [
        { key: 'demo1', extInstitution: 'Demo University', extCode: 'DEMO 210', extLabel: 'Data Structures', aiCode: 'BU CS 112', aiLabel: 'Intro to CS 2', decidedCode: 'BU CS 210', decidedLabel: 'Data Structures', count: 6, lastSeen: new Date().toISOString(), title: 'Prefer BU CS 210 for Demo University DEMO 210', instructions: 'Demo only.', alreadyInPlaybook: false },
        { key: 'demo2', extInstitution: 'Demo University', extCode: 'DEMO 120', extLabel: 'Statistics', aiCode: 'BU MA 123', aiLabel: 'Calculus I', decidedCode: 'BU MA 213', decidedLabel: 'Basic Statistics', count: 4, lastSeen: new Date().toISOString(), title: 'Prefer BU MA 213 for Demo University DEMO 120', instructions: 'Demo only.', alreadyInPlaybook: false },
      ],
      hasData: true,
    },
  };
}
