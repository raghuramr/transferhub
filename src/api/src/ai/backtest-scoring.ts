import { CatalogCourse, ExternalCourseFacts } from './course-prefilter';
import { rulesMatch } from './rules-matcher';

/**
 * Pure hold-out scoring for the course matcher (no database, no model calls).
 *
 * A "case" is one external course with at least one past decision of outcome 'equivalent'. The matcher ranks the
 * receiving university's catalogue for it, and we check whether a course the evaluators really chose is in the
 * top-1 / top-3. The case's own decision is held out: it is never given to the matcher as evidence.
 */

export interface BacktestCase {
  /** External course id (cases are one per external course; several true answers are allowed). */
  externalCourseId: number;
  externalLabel: string; // e.g. "NU CS 2000 - Fundamentals of Computer Science 1"
  facts: ExternalCourseFacts;
  /** Receiving university whose catalogue is searched (hold-out is per target university). */
  targetInstitutionId: number;
  targetCode: string;
  targetName: string;
  /** Receiving-university course ids that past decisions mapped this course to. */
  expectedCourseIds: number[];
}

export interface RankedPick {
  courseId: number;
  code: string;
  title: string;
}

/**
 * EXTENSION POINT: a matcher turns (external course, catalogue, held-out case) into a ranked list.
 * The built-in rules matcher below ignores past decisions entirely, so hold-out is trivially respected.
 * An AI matcher would be added here as another Matcher (e.g. one that calls the model with the catalogue
 * shortlist and, if it uses past decisions as few-shot evidence, must exclude `heldOut`). NOT implemented:
 * the backtest never calls a model.
 */
export type Matcher = (facts: ExternalCourseFacts, catalog: CatalogCourse[], heldOut: BacktestCase) => RankedPick[];

export const rulesBacktestMatcher: Matcher = (facts, catalog) =>
  rulesMatch(facts, catalog, 3).map((c) => ({ courseId: c.courseId, code: c.code, title: c.title }));

export interface BacktestGroup {
  institutionId: number;
  institutionCode: string;
  institutionName: string;
  total: number;
  top1: number;
  top3: number;
  top1Rate: number;
  top3Rate: number;
}

export interface BacktestMiss {
  external: string;
  expected: string;
  got: string;
}

export interface BacktestResult {
  method: string;
  total: number;
  top1: number;
  top3: number;
  top1Rate: number;
  top3Rate: number;
  byUniversity: BacktestGroup[];
  misses: BacktestMiss[];
  missesTotal: number;
}

const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : 0);

export function runBacktest(
  cases: BacktestCase[],
  catalogs: Map<number, CatalogCourse[]>,
  matcher: Matcher = rulesBacktestMatcher,
  method = 'built-in rules',
  maxMisses = 25,
): BacktestResult {
  const groups = new Map<number, BacktestGroup>();
  const misses: BacktestMiss[] = [];
  let top1 = 0;
  let top3 = 0;
  let total = 0;

  for (const c of cases) {
    const catalog = catalogs.get(c.targetInstitutionId) ?? [];
    if (!catalog.length || !c.expectedCourseIds.length) continue;
    const expected = new Set(c.expectedCourseIds);
    const picks = matcher(c.facts, catalog, c).slice(0, 3);
    const hit1 = picks.length > 0 && expected.has(picks[0].courseId);
    const hit3 = picks.some((p) => expected.has(p.courseId));

    total++;
    if (hit1) top1++;
    if (hit3) top3++;

    let g = groups.get(c.targetInstitutionId);
    if (!g) {
      g = { institutionId: c.targetInstitutionId, institutionCode: c.targetCode, institutionName: c.targetName, total: 0, top1: 0, top3: 0, top1Rate: 0, top3Rate: 0 };
      groups.set(c.targetInstitutionId, g);
    }
    g.total++;
    if (hit1) g.top1++;
    if (hit3) g.top3++;

    if (!hit3) {
      const label = (id: number) => catalog.find((x) => x.id === id)?.code ?? `#${id}`;
      misses.push({
        external: c.externalLabel,
        expected: c.expectedCourseIds.map(label).join(', '),
        got: picks.length ? picks.map((p) => p.code).join(', ') : '(no candidate above the minimum score)',
      });
    }
  }

  const byUniversity = [...groups.values()]
    .map((g) => ({ ...g, top1Rate: rate(g.top1, g.total), top3Rate: rate(g.top3, g.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    method,
    total,
    top1,
    top3,
    top1Rate: rate(top1, total),
    top3Rate: rate(top3, total),
    byUniversity,
    misses: misses.slice(0, maxMisses),
    missesTotal: misses.length,
  };
}
