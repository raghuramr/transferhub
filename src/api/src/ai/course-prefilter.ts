/**
 * Deterministic, zero-token shortlist: instead of sending the receiving
 * university's whole catalogue to the model for every external course, rank
 * it lexically here and send only the top N. The model then only has to
 * choose among plausible candidates.
 */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'into', 'from', 'this', 'that', 'course', 'courses', 'introduction', 'intro',
  'topics', 'including', 'study', 'students', 'covers', 'cover', 'basic', 'principles', 'fundamentals', 'to', 'of', 'in', 'on', 'an', 'is', 'are',
]);

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of (text || '').toLowerCase().split(/[^a-z0-9+#]+/)) {
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

export interface CatalogCourse {
  id: number;
  code: string;
  title: string;
  credits: number;
  programArea: string | null;
  description: string | null;
  topics: string[];
}

export interface ExternalCourseFacts {
  code: string;
  title: string;
  credits: number | null;
  text: string; // description + topic titles, when known
}

function deptPrefix(code: string): string {
  return (code.match(/[A-Za-z]+/)?.[0] ?? '').toLowerCase();
}

function levelDigit(code: string): string | null {
  return code.match(/\d/)?.[0] ?? null;
}

export function scoreCourse(ext: ExternalCourseFacts, c: CatalogCourse): number {
  const a = tokenize(`${ext.title} ${ext.title} ${ext.text}`);
  const b = tokenize(`${c.title} ${c.title} ${c.programArea ?? ''} ${c.topics.join(' ')} ${c.description ?? ''}`);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  let score = a.size && b.size ? inter / Math.sqrt(a.size * b.size) : 0;

  const prefix = deptPrefix(ext.code);
  if (prefix.length >= 2) {
    const codeTokens = c.code.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (codeTokens.some((t) => t === prefix || t.startsWith(prefix) || (t.length >= 2 && prefix.startsWith(t)))) score += 0.15;
  }
  if (ext.credits != null && Math.abs(ext.credits - c.credits) <= 0.5) score += 0.05;
  const lvl = levelDigit(ext.code);
  if (lvl && lvl === levelDigit(c.code.replace(/^[A-Za-z\s]+/, ''))) score += 0.05;
  return score;
}

export function shortlist(ext: ExternalCourseFacts, catalog: CatalogCourse[], topN: number): CatalogCourse[] {
  if (topN <= 0 || catalog.length <= topN) return catalog;
  return catalog
    .map((c) => ({ c, s: scoreCourse(ext, c) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, topN)
    .map((x) => x.c);
}

export function normalizeKey(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
