/**
 * Pure logic for the "equivalency intelligence network": how OTHER universities treated the same external course.
 * No database here - network.service.ts loads the rows, this file aggregates them. Anonymity is enforced HERE:
 * the aggregate result never carries another university's name, id or course code, only counts and generic titles.
 */

export interface NetRow {
  extId: number;
  extInstId: number | null;
  recvInstId: number;
  recvInstName: string;
  buCourseId: number;
  buCode: string;
  buTitle: string;
  buCredits: number | null;
  outcome: string; // equivalent | elective | no_credit | bu_only
  awarded: number | null; // Equivalencies.BUCredits
  decidedAt: Date | string | null;
  createdAt: Date | string | null;
  effectiveFrom: Date | string | null;
  effectiveTo: Date | string | null;
  isActive: boolean;
}

const STOP = new Set(['the', 'and', 'of', 'to', 'in', 'for', 'a', 'an', 'intro', 'introduction', 'fundamentals', 'principles', 'course']);
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };

/** Normalised title key: case/punctuation/stop-word/roman-numeral insensitive ("Calculus II" == "calculus 2"). */
export function normTitle(title: string): string {
  const words = (title || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (ROMAN[w] && out.length) { out.push(ROMAN[w]); continue; }
    if (w === 'i' || STOP.has(w)) continue;
    out.push(w);
  }
  return out.join(' ');
}

export function normCode(code: string): string {
  return (code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ts = (d: Date | string | null): number => (d ? new Date(d).getTime() : 0);
const dayStart = (d: Date | string): number => { const x = new Date(d); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };
const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

/** Active and inside its effective window on the given day. */
export function isEffective(r: Pick<NetRow, 'isActive' | 'effectiveFrom' | 'effectiveTo'>, asOf: Date): boolean {
  if (!r.isActive) return false;
  const day = dayStart(asOf);
  if (r.effectiveFrom && dayStart(r.effectiveFrom) > day) return false;
  if (r.effectiveTo && dayStart(r.effectiveTo) < day) return false;
  return true;
}

export type AgreementLevel = 'high' | 'medium' | 'low' | 'none';

export interface NetworkTarget {
  /** Normalised target-course title, shared by same-titled courses at different universities. */
  key: string;
  /** Generic title only - never a code, never the university. */
  title: string;
  universities: number;
  avgCredits: number | null;
  sharePct: number;
}

export interface OwnDecision {
  universityName: string;
  targetCourse: { id: number; code: string; title: string };
  outcome: string;
  awardedCredits: number | null;
  decidedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface NetworkAggregate {
  otherUniversities: number;
  acceptedAsEquivalent: number;
  /** Distinct other universities per outcome. */
  outcomes: { equivalent: number; elective: number; no_credit: number; bu_only: number };
  targets: NetworkTarget[];
  lastDecisionAt: string | null;
  agreement: number;
  agreementLevel: AgreementLevel;
  headline: string;
  own: OwnDecision[];
}

const round = (n: number, p = 100) => Math.round(n * p) / p;
const plural = (n: number) => `${n} other universit${n === 1 ? 'y' : 'ies'}`;

export function agreementLevel(accepted: number, agreement: number): AgreementLevel {
  if (accepted <= 0) return 'none';
  if (accepted >= 3 && agreement >= 0.7) return 'high';
  if (accepted >= 2 && agreement >= 0.5) return 'medium';
  return 'low';
}

export function aggregate(rows: NetRow[], opts: { ownInstitutionIds: number[]; asOf?: Date }): NetworkAggregate {
  const asOf = opts.asOf ?? new Date();
  const own = new Set(opts.ownInstitutionIds);
  const live = rows.filter((r) => isEffective(r, asOf));

  // Own decisions: by name, newest first.
  const ownRows = live.filter((r) => own.has(r.recvInstId)).sort((a, b) => ts(b.decidedAt ?? b.createdAt) - ts(a.decidedAt ?? a.createdAt));
  const ownOut: OwnDecision[] = ownRows.map((r) => ({
    universityName: r.recvInstName,
    targetCourse: { id: r.buCourseId, code: r.buCode, title: r.buTitle },
    outcome: r.outcome,
    awardedCredits: r.awarded ?? r.buCredits,
    decidedAt: iso(r.decidedAt ?? r.createdAt),
    effectiveFrom: r.effectiveFrom ? iso(r.effectiveFrom)!.slice(0, 10) : null,
    effectiveTo: r.effectiveTo ? iso(r.effectiveTo)!.slice(0, 10) : null,
  }));

  const others = live.filter((r) => !own.has(r.recvInstId));
  const universities = new Set(others.map((r) => r.recvInstId));
  const byOutcome = (o: string) => new Set(others.filter((r) => r.outcome === o).map((r) => r.recvInstId)).size;
  const outcomes = { equivalent: byOutcome('equivalent'), elective: byOutcome('elective'), no_credit: byOutcome('no_credit'), bu_only: byOutcome('bu_only') };

  // Targets: only "equivalent" decisions, grouped by normalised target title so the same course at different universities agrees.
  const equiv = others.filter((r) => r.outcome === 'equivalent');
  const accepted = new Set(equiv.map((r) => r.recvInstId)).size;
  const groups = new Map<string, { unis: Set<number>; credits: number[]; titles: Map<string, number> }>();
  for (const r of equiv) {
    const key = normTitle(r.buTitle) || `#${r.buCourseId}`;
    const g = groups.get(key) ?? { unis: new Set<number>(), credits: [], titles: new Map<string, number>() };
    g.unis.add(r.recvInstId);
    const cr = r.awarded ?? r.buCredits;
    if (cr != null && Number.isFinite(Number(cr))) g.credits.push(Number(cr));
    g.titles.set(r.buTitle, (g.titles.get(r.buTitle) ?? 0) + 1);
    groups.set(key, g);
  }
  const targets: NetworkTarget[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      title: [...g.titles.entries()].sort((a, b) => b[1] - a[1])[0][0],
      universities: g.unis.size,
      avgCredits: g.credits.length ? round(g.credits.reduce((a, b) => a + b, 0) / g.credits.length) : null,
      sharePct: accepted ? Math.round((g.unis.size / accepted) * 100) : 0,
    }))
    .sort((a, b) => b.universities - a.universities || a.title.localeCompare(b.title));

  const agreement = accepted && targets.length ? round(targets[0].universities / accepted) : 0;
  const level = agreementLevel(accepted, agreement);
  const last = others.reduce((m, r) => Math.max(m, ts(r.decidedAt ?? r.createdAt)), 0);

  let headline: string;
  if (!universities.size) headline = 'No other university has recorded a decision for this course yet.';
  else if (accepted) headline = `Accepted as equivalent by ${plural(accepted)}`;
  else if (outcomes.elective) headline = `Given elective credit only by ${plural(outcomes.elective)}`;
  else if (outcomes.no_credit) headline = `Given no credit by ${plural(outcomes.no_credit)}`;
  else headline = `Seen by ${plural(universities.size)}`;

  return {
    otherUniversities: universities.size,
    acceptedAsEquivalent: accepted,
    outcomes,
    targets,
    lastDecisionAt: last ? new Date(last).toISOString() : null,
    agreement,
    agreementLevel: level,
    headline,
    own: ownOut,
  };
}

// ---- Confidence boost ---------------------------------------------------------------------------------------------

export const BOOST_MIN = 0.05;
export const BOOST_MAX = 0.15;
export const RULES_CAP = 0.7;
export const OVERALL_CAP = 0.99;

/** What the matcher needs from the network: the accepted-equivalent targets. Counts only. */
export interface NetworkSupport {
  acceptedAsEquivalent: number;
  targets: Pick<NetworkTarget, 'key' | 'universities'>[];
}

export function toSupport(a: NetworkAggregate | null): NetworkSupport | null {
  return a ? { acceptedAsEquivalent: a.acceptedAsEquivalent, targets: a.targets.map((t) => ({ key: t.key, universities: t.universities })) } : null;
}

/**
 * Bounded boost for one candidate: 0 when no other university accepted this target, otherwise 0.05..0.15 growing with
 * how many universities accepted it (saturating at 4) and with how concentrated the network is on it.
 */
export function networkBoost(candidateTitle: string, support: NetworkSupport | null): { boost: number; universities: number } {
  if (!support || !support.acceptedAsEquivalent) return { boost: 0, universities: 0 };
  const key = normTitle(candidateTitle);
  const t = key ? support.targets.find((x) => x.key === key) : undefined;
  if (!t || t.universities < 1) return { boost: 0, universities: 0 };
  const share = t.universities / support.acceptedAsEquivalent;
  const weight = Math.min(1, t.universities / 4) * share;
  const boost = Math.min(BOOST_MAX, BOOST_MIN + (BOOST_MAX - BOOST_MIN) * weight);
  return { boost: round(boost, 1000), universities: t.universities };
}

export interface BoostableCandidate { buTitle: string; confidenceScore: number; rationale: string; rank: number }

/**
 * Applies the boost to a candidate list (returns NEW objects), never lifting a score above `cap` (0.7 for the rules engine,
 * 0.99 otherwise) and never lowering one that is already above it. Appends a labelled suffix to the rationale and re-ranks.
 */
export function applyNetworkBoost<T extends BoostableCandidate>(candidates: T[], support: NetworkSupport | null, cap: number): T[] {
  if (!support || !candidates.length) return candidates;
  let changed = false;
  const out = candidates.map((c) => {
    const { boost, universities } = networkBoost(c.buTitle, support);
    if (!boost) return c;
    const raised = Math.max(c.confidenceScore, Math.min(cap, c.confidenceScore + boost));
    changed = true;
    // Even when the cap leaves the score untouched the reviewer still learns that other universities accepted it.
    const note = `Also accepted by ${universities} other universit${universities === 1 ? 'y' : 'ies'}.`;
    return { ...c, confidenceScore: Math.round(raised * 1000) / 1000, rationale: `${c.rationale} ${note}`.slice(0, 700) };
  });
  if (!changed) return candidates;
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.confidenceScore - a.c.confidenceScore || a.i - b.i)
    .map(({ c }, idx) => ({ ...c, rank: idx + 1 }));
}

// ---- Network summary ----------------------------------------------------------------------------------------------

export interface TopAgreed {
  title: string;
  universities: number;
  agreement: number;
  agreementLevel: AgreementLevel;
}

/** Most-agreed external courses: grouped by normalised external title, counted per receiving university. Titles only. */
export function topAgreed(rows: (NetRow & { extTitle: string })[], asOf: Date, limit = 8): TopAgreed[] {
  const byExt = new Map<string, { title: string; rows: NetRow[] }>();
  for (const r of rows) {
    if (!isEffective(r, asOf) || r.outcome !== 'equivalent') continue;
    const key = normTitle(r.extTitle);
    if (!key) continue;
    const g = byExt.get(key) ?? { title: r.extTitle, rows: [] };
    g.rows.push(r);
    byExt.set(key, g);
  }
  const out: TopAgreed[] = [];
  for (const g of byExt.values()) {
    const a = aggregate(g.rows, { ownInstitutionIds: [], asOf });
    if (a.acceptedAsEquivalent >= 1) out.push({ title: g.title, universities: a.acceptedAsEquivalent, agreement: a.agreement, agreementLevel: a.agreementLevel });
  }
  return out.sort((a, b) => b.universities - a.universities || b.agreement - a.agreement || a.title.localeCompare(b.title)).slice(0, limit);
}

/** Fills missing months with zero and returns the last `months` months (oldest first) as { month: 'YYYY-MM', count }. */
export function fillMonths(counts: { month: string; count: number }[], months: number, now = new Date()): { month: string; count: number }[] {
  const map = new Map(counts.map((c) => [c.month, Number(c.count)]));
  const out: { month: string; count: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ month: m, count: map.get(m) ?? 0 });
  }
  return out;
}
