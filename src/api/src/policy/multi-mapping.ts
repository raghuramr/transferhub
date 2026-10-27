/**
 * Pure logic for OUT-06: one external course counting as several BU courses (NU CHEM 1161 -> CH 101 + CH 102),
 * and several external courses together counting as one (NU CS 2100 + CS 2700 -> CS 112).
 */

export interface MappingInput {
  buCourseId: number;
  /** Credits the BU course is worth in the catalogue. */
  catalogCredits?: number | null;
  /** Credits the evaluator (or the equivalency record) states explicitly; wins over any computed split. */
  credits?: number | null;
}

export interface MappingOut {
  buCourseId: number;
  awardedCredits: number;
  sortOrder: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;
const num = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/**
 * Splits the external course's converted credits over the BU courses.
 *  - credits stated explicitly are used as given ("unless the data says otherwise");
 *  - the rest share what is left (converted minus the explicit ones): when their catalogue credits fit they get
 *    exactly those, otherwise they are scaled down proportionally so the total never exceeds the converted credits;
 *  - courses with no catalogue credits share equally.
 */
export function splitCredits(converted: number, items: MappingInput[]): MappingOut[] {
  const conv = Math.max(0, num(converted));
  const explicitSum = items.reduce((s, i) => s + (i.credits != null ? num(i.credits) : 0), 0);
  const open = items.filter((i) => i.credits == null);
  const remaining = open.length === items.length ? conv : Math.max(0, r2(conv - explicitSum));
  const nominalSum = open.reduce((s, i) => s + num(i.catalogCredits), 0);

  const shares = new Map<number, number>();
  if (open.length) {
    if (nominalSum <= 0) {
      const each = floor2(remaining / open.length);
      open.forEach((i) => shares.set(i.buCourseId, each));
    } else if (nominalSum <= remaining) {
      open.forEach((i) => shares.set(i.buCourseId, r2(num(i.catalogCredits))));
    } else {
      open.forEach((i) => shares.set(i.buCourseId, floor2((remaining * num(i.catalogCredits)) / nominalSum)));
    }
    // Put rounding leftovers on the last open course only when the split was scaled/equal (never exceed `remaining`).
    if (nominalSum <= 0 || nominalSum > remaining) {
      const used = [...shares.values()].reduce((s, v) => s + v, 0);
      const left = r2(remaining - used);
      if (left > 0) {
        const last = open[open.length - 1].buCourseId;
        shares.set(last, r2((shares.get(last) ?? 0) + left));
      }
    }
  }
  return items.map((i, idx) => ({
    buCourseId: i.buCourseId,
    awardedCredits: i.credits != null ? r2(num(i.credits)) : (shares.get(i.buCourseId) ?? 0),
    sortOrder: idx,
  }));
}

export interface CombineMember {
  courseId: string;
  convertedCredits: number;
}

/**
 * Several external courses that together count as ONE BU course: the BU credits are awarded once, shared between
 * the members in proportion to their converted credits, and never more than the members brought in.
 */
export function combineShares(buCredits: number, members: CombineMember[]): Map<string, number> {
  const out = new Map<string, number>();
  const sum = members.reduce((s, m) => s + num(m.convertedCredits), 0);
  if (!members.length) return out;
  const total = Math.min(num(buCredits), sum);
  let used = 0;
  members.forEach((m, i) => {
    const share = i === members.length - 1 ? r2(total - used) : floor2(sum > 0 ? (total * num(m.convertedCredits)) / sum : total / members.length);
    used += share;
    out.set(m.courseId, Math.max(0, share));
  });
  return out;
}

export interface EquivalencyWindow {
  EffectiveFrom?: Date | string | null;
  EffectiveTo?: Date | string | null;
}

const day = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** An equivalency applies to courses taken between its begin and end date (either may be open). */
export function inWindow(eq: EquivalencyWindow, asOf: string): boolean {
  if (eq.EffectiveFrom && day(eq.EffectiveFrom) > asOf) return false;
  if (eq.EffectiveTo && day(eq.EffectiveTo) < asOf) return false;
  return true;
}

/** Mirrors sp_TriageCourse: the term text ("Fall 2021") gives the as-of date, else today. */
export function asOfFromTerm(term: string | null | undefined, today: string): string {
  const m = (term ?? '').match(/[12][0-9]{3}/);
  if (!m) return today;
  const y = Number(m[0]);
  if (y < 1950 || y > 2100) return today;
  const t = (term ?? '').toLowerCase();
  const month = t.includes('fall') ? '09' : t.includes('summer') ? '06' : '01';
  return `${y}-${month}-01`;
}

/**
 * Validates an evaluator's multi-course decision. Returns problems (empty = ok).
 * Several BU courses only make sense for a positive outcome, each course once.
 */
export function validateMultiDecision(outcome: string, mappings: { buCourseId: number; awardedCredits?: number | null }[]): string[] {
  const errs: string[] = [];
  if (mappings.length > 1 && !['equivalent', 'elective'].includes(outcome)) errs.push('Several BU courses can only be recorded for an equivalent or elective outcome.');
  const ids = mappings.map((m) => m.buCourseId);
  if (new Set(ids).size !== ids.length) errs.push('Each BU course can be listed only once.');
  if (mappings.some((m) => m.awardedCredits != null && (Number.isNaN(Number(m.awardedCredits)) || Number(m.awardedCredits) < 0))) errs.push('Credits cannot be negative.');
  return errs;
}
