import { api } from './api';

// Equivalency intelligence network: how OTHER universities treated the same external course (anonymised counts only).
export type AgreementLevel = 'high' | 'medium' | 'low' | 'none';

export interface NetworkTarget { key: string; title: string; universities: number; avgCredits: number | null; sharePct: number }
export interface NetworkOwnDecision {
  universityName: string;
  targetCourse: { id: number; code: string; title: string };
  outcome: string;
  awardedCredits: number | null;
  decidedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}
export interface CourseNetwork {
  course: { resolved: boolean; code: string | null; title: string | null; matchBasis: string };
  otherUniversities: number;
  acceptedAsEquivalent: number;
  outcomes: { equivalent: number; elective: number; no_credit: number; bu_only: number };
  targets: NetworkTarget[];
  lastDecisionAt: string | null;
  agreement: number;
  agreementLevel: AgreementLevel;
  headline: string;
  own: NetworkOwnDecision[];
  /** keyed by receiving-course id: how many other universities accepted the same course, and the boost it would earn. */
  candidateSupport: Record<string, { universities: number; boost: number }>;
  boostEnabled: boolean;
}
export interface NetworkSummary {
  totalPairs: number;
  contributingUniversities: number;
  externalCourses: number;
  mappedExternalCourses: number;
  coveragePct: number;
  topAgreed: { title: string; universities: number; agreement: number; agreementLevel: AgreementLevel }[];
  growth: { month: string; count: number }[];
  boostEnabled: boolean;
}
export interface NetworkSettings { boostEnabled: boolean; ready: boolean; key: string }

export const networkApi = {
  course: (params: { evaluationId: string; candidateIds?: number[] }) =>
    api.get<CourseNetwork>('/equivalency-network/course', {
      params: { evaluationId: params.evaluationId, candidateIds: params.candidateIds?.join(',') || undefined },
    }),
  summary: () => api.get<NetworkSummary>('/equivalency-network/summary'),
  settings: () => api.get<NetworkSettings>('/equivalency-network/settings'),
  saveSettings: (boostEnabled: boolean) => api.put<NetworkSettings>('/equivalency-network/settings', { boostEnabled }),
};
