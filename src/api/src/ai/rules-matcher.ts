import { CatalogCourse, ExternalCourseFacts, scoreCourse, tokenize } from './course-prefilter';

export interface RulesCandidate {
  courseId: number;
  code: string;
  title: string;
  rank: number;
  confidence: number;
  rationale: string;
}

/** Rules never claim more than this, so they are never auto-promoted past the "likely" threshold on their own. */
export const RULES_MAX_CONFIDENCE = 0.7;
const MIN_SCORE = 0.12;

function sharedWords(a: string, b: string, limit = 5): string[] {
  const tb = tokenize(b);
  return [...tokenize(a)].filter((t) => tb.has(t)).slice(0, limit);
}

/**
 * Zero-AI course matcher: ranks the receiving university's catalogue with the same lexical score used to
 * shortlist for the model, then turns the best few into candidates with a plain-language rationale.
 */
export function rulesMatch(ext: ExternalCourseFacts, catalog: CatalogCourse[], max = 3): RulesCandidate[] {
  const ranked = catalog
    .map((c) => ({ c, s: scoreCourse(ext, c) }))
    .filter((x) => x.s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s)
    .slice(0, max);

  return ranked.map(({ c, s }, i) => {
    const confidence = Math.round(Math.min(RULES_MAX_CONFIDENCE, s * 0.8) * 1000) / 1000;
    const reasons: string[] = [];
    const words = sharedWords(ext.title, `${c.title} ${c.topics.join(' ')}`);
    if (words.length) reasons.push(`title/topic words in common: ${words.join(', ')}`);
    const textWords = ext.text ? sharedWords(ext.text, `${c.description ?? ''} ${c.topics.join(' ')}`, 4) : [];
    if (textWords.length) reasons.push(`description overlap: ${textWords.join(', ')}`);
    if (ext.credits != null && Math.abs(ext.credits - c.credits) <= 0.5) reasons.push(`credits are close (${ext.credits} vs ${c.credits})`);
    if (!reasons.length) reasons.push('similar course code/level');
    return {
      courseId: c.id,
      code: c.code,
      title: c.title,
      rank: i + 1,
      confidence,
      rationale: `[Built-in rules] ${reasons.join('; ')}. Please verify against the syllabus.`.slice(0, 600),
    };
  });
}
