/**
 * Pure helpers for the "scan a transcript" view: given the text items of a document (with positions) and the
 * fields the reader extracted, work out WHERE on the page each value was found.
 *
 * No browser or DOM code in here on purpose, so it is unit tested from src/api/scripts/test-scan-match.ts.
 * Coordinates are normalised to 0..1 of the page (top-left origin), so overlays are resolution independent.
 * Matching is tolerant (case, spacing, punctuation, diacritics, date formats) but never invents a position:
 * a value that is not found simply has no box.
 */

export interface TextItem {
  page: number;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FieldEntry {
  key: string;
  label: string;
  value: string;
  group: string;
  /** Set for fields that belong to a course row. */
  courseIndex?: number;
}

export interface Highlight {
  key: string;
  boxes: Box[];
}

export interface CourseLike {
  courseCode?: unknown;
  courseTitle?: unknown;
  credits?: unknown;
  grade?: unknown;
  term?: unknown;
}

export interface MatchResult {
  fields: FieldEntry[];
  highlights: Highlight[];
}

// ── text normalisation ──────────────────────────────────────

/** Lower-case letters and digits only (any script): "CS 1800", "cs-1800" and "CS1800" all become "cs1800". */
export function squash(s: string): string {
  return squashChars(s).join('');
}

function squashChars(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    const n = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (n) out.push(n);
  }
  return out;
}

// ── lines and words ─────────────────────────────────────────

interface Word {
  text: string;
  box: Box;
}

interface Line {
  page: number;
  items: TextItem[];
  words: Word[];
  box: Box;
}

function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { page: boxes[0].page, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** A slice of one text item, assuming characters are about equally wide (good enough for highlighting). */
function sliceItem(it: TextItem, from: number, to: number): Box {
  const len = Math.max(it.str.length, 1);
  return { page: it.page, x: it.x + (it.w * from) / len, y: it.y, w: (it.w * (to - from)) / len, h: it.h };
}

/** Groups items into visual lines (same page, similar vertical centre), left to right. */
export function buildLines(items: TextItem[]): Line[] {
  const usable = items.filter((i) => i.str.trim() && i.w > 0 && i.h > 0);
  usable.sort((a, b) => a.page - b.page || a.y + a.h / 2 - (b.y + b.h / 2));
  const groups: { page: number; cy: number; h: number; items: TextItem[] }[] = [];
  for (const it of usable) {
    const cy = it.y + it.h / 2;
    const g = groups[groups.length - 1];
    if (g && g.page === it.page && Math.abs(cy - g.cy) <= 0.5 * Math.max(g.h, it.h)) {
      g.items.push(it);
      g.cy = (g.cy * (g.items.length - 1) + cy) / g.items.length;
      g.h = Math.max(g.h, it.h);
    } else {
      groups.push({ page: it.page, cy, h: it.h, items: [it] });
    }
  }
  return groups.map((g) => {
    const its = [...g.items].sort((a, b) => a.x - b.x);
    const words: Word[] = [];
    for (const it of its) {
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(it.str))) words.push({ text: m[0], box: sliceItem(it, m.index, m.index + m[0].length) });
    }
    return { page: g.page, items: its, words, box: unionBox(its.map((i) => ({ page: i.page, x: i.x, y: i.y, w: i.w, h: i.h })))! };
  });
}

interface Unit {
  lines: Line[];
  sq: string;
  map: { line: number; item: number; raw: number }[];
}

function buildUnit(lines: Line[]): Unit {
  let sq = '';
  const map: Unit['map'] = [];
  lines.forEach((ln, li) => {
    ln.items.forEach((it, ii) => {
      let raw = 0;
      for (const ch of it.str) {
        for (const c of squashChars(ch)) {
          sq += c;
          map.push({ line: li, item: ii, raw });
        }
        raw += ch.length;
      }
    });
  });
  return { lines, sq, map };
}

/** Boxes (one per line involved) for squashed range [a, b) of a unit. */
function boxesForRange(u: Unit, a: number, b: number): Box[] {
  const per = new Map<string, { it: TextItem; min: number; max: number }>();
  for (let i = a; i < b; i++) {
    const m = u.map[i];
    const k = `${m.line}:${m.item}`;
    const it = u.lines[m.line].items[m.item];
    const cur = per.get(k);
    if (cur) { cur.min = Math.min(cur.min, m.raw); cur.max = Math.max(cur.max, m.raw); } else per.set(k, { it, min: m.raw, max: m.raw });
  }
  const byLine = new Map<number, Box[]>();
  for (const [k, v] of per) {
    const li = Number(k.split(':')[0]);
    const arr = byLine.get(li) ?? [];
    arr.push(sliceItem(v.it, v.min, v.max + 1));
    byLine.set(li, arr);
  }
  return [...byLine.values()].map((arr) => unionBox(arr)!).filter(Boolean);
}

export interface Index {
  lines: Line[];
  units: Unit[];
}

export function buildIndex(items: TextItem[]): Index {
  const lines = buildLines(items);
  const units: Unit[] = lines.map((l) => buildUnit([l]));
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].page === lines[i + 1].page) units.push(buildUnit([lines[i], lines[i + 1]]));
  }
  return { lines, units };
}

/** Finds the first occurrence of `target` (squashed, so tolerant of spacing/case/punctuation); null when absent. */
export function findText(index: Index, target: string | string[], minLen = 3): Box[] | null {
  const targets = (Array.isArray(target) ? target : [target]).map(squash).filter((t) => t.length >= minLen);
  if (!targets.length) return null;
  for (const u of index.units) {
    for (const t of targets) {
      const at = u.sq.indexOf(t);
      if (at >= 0) return boxesForRange(u, at, at + t.length);
    }
  }
  return null;
}

// ── dates ───────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Other ways a document may print an ISO date ("2021-09-01"): "Sep 1, 2021", "01/09/2021", "September 2021"... */
export function dateVariants(value: string): string[] {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim());
  if (!m) return [value];
  const [, y, mo, d] = m;
  const mi = Number(mo) - 1;
  if (mi < 0 || mi > 11) return [value];
  const long = MONTHS[mi];
  const short = long.slice(0, 3);
  if (!d) return [value, `${long} ${y}`, `${short} ${y}`, `${mo}/${y}`];
  const dn = String(Number(d));
  return [
    value,
    `${long} ${dn}, ${y}`, `${short} ${dn}, ${y}`, `${dn} ${long} ${y}`, `${dn} ${short} ${y}`, `${d} ${short} ${y}`, `${d} ${long} ${y}`,
    `${mo}/${d}/${y}`, `${Number(mo)}/${dn}/${y}`, `${d}/${mo}/${y}`, `${dn}/${Number(mo)}/${y}`,
  ];
}

// ── fields ──────────────────────────────────────────────────

export function humanize(key: string): string {
  const s = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Flattens extracted fields into labelled entries; transcript courses become per-course entries. */
export function flattenFields(fields: Record<string, unknown>): FieldEntry[] {
  const out: FieldEntry[] = [];
  const walk = (v: unknown, path: string[], group: string) => {
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...path, String(i)], group));
      return;
    }
    if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, [...path, k], group || humanize(path[0] ?? k));
      return;
    }
    if (typeof v === 'boolean') return;
    const label = path.length > 1 && !/^\d+$/.test(path[path.length - 1]) && !/^\d+$/.test(path[0])
      ? `${humanize(path[0])} - ${humanize(path[path.length - 1])}`
      : humanize(path.filter((p) => !/^\d+$/.test(p)).slice(-1)[0] ?? path[0]);
    out.push({ key: path.join('.'), label, value: String(v), group: group || 'Details' });
  };
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'courses') continue;
    walk(v, [k], isObj(v) ? humanize(k) : 'Details');
  }
  const courses = Array.isArray(fields.courses) ? (fields.courses as CourseLike[]) : [];
  courses.forEach((c, i) => {
    const code = String(c.courseCode ?? '').trim();
    const title = String(c.courseTitle ?? '').trim();
    const credits = c.credits === null || c.credits === undefined || c.credits === '' ? '' : String(c.credits);
    const grade = String(c.grade ?? '').trim();
    const g = `Course ${i + 1}`;
    if (code) out.push({ key: `course.${i}.code`, label: 'Code', value: code, group: g, courseIndex: i });
    if (title) out.push({ key: `course.${i}.title`, label: 'Title', value: title, group: g, courseIndex: i });
    if (credits) out.push({ key: `course.${i}.credits`, label: 'Credits', value: credits, group: g, courseIndex: i });
    if (grade) out.push({ key: `course.${i}.grade`, label: 'Grade', value: grade, group: g, courseIndex: i });
  });
  return out;
}

function numEq(a: string, b: number): boolean {
  const n = Number(a.replace(/[^\d.]/g, ''));
  return a.trim() !== '' && Number.isFinite(n) && Math.abs(n - b) < 1e-9;
}

function locateLeaf(index: Index, value: string): Box[] | null {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    // Numbers: exact word match only (a "4" must not light up inside "1341"); short ones are too ambiguous.
    if (v.replace(/[^\d]/g, '').length < 3 && !v.includes('.')) return null;
    const n = Number(v);
    for (const ln of index.lines) {
      const w = ln.words.find((x) => numEq(x.text, n) && (x.text.includes('.') === v.includes('.') || x.text.replace(/\D/g, '') === v.replace(/\D/g, '')));
      if (w) return [w.box];
    }
    return null;
  }
  return findText(index, /^\d{4}-\d{2}(-\d{2})?$/.test(v) ? dateVariants(v) : v);
}

interface CourseHit {
  row: Box;
  code?: Box;
  title?: Box;
  credits?: Box;
  grade?: Box;
}

function locateCourse(index: Index, c: CourseLike, used: Set<number>): CourseHit | null {
  const code = squash(String(c.courseCode ?? ''));
  const title = String(c.courseTitle ?? '');
  const titleTokens = title.split(/\s+/).map(squash).filter((t) => t.length >= 3);
  let best = -1;
  let bestScore = 0;
  const lineUnits = index.units.filter((u) => u.lines.length === 1);
  lineUnits.forEach((u, li) => {
    if (used.has(li)) return;
    let score = 0;
    if (code.length >= 3 && u.sq.includes(code)) score += 2;
    else if (code.length >= 3) return;
    if (titleTokens.length) score += titleTokens.filter((t) => u.sq.includes(t)).length / titleTokens.length;
    if (code.length < 3 && score < 0.99) return;
    if (score > bestScore) { bestScore = score; best = li; }
  });
  if (best < 0) return null;
  used.add(best);
  const unit = lineUnits[best];
  const line = unit.lines[0];
  const sub = (t: string, min = 3): Box | undefined => {
    const s = squash(t);
    if (s.length < min) return undefined;
    const at = unit.sq.indexOf(s);
    return at >= 0 ? boxesForRange(unit, at, at + s.length)[0] : undefined;
  };
  const hit: CourseHit = { row: line.box };
  hit.code = sub(String(c.courseCode ?? ''));
  hit.title = sub(title, 4);
  if (!hit.title && titleTokens.length) {
    const parts = titleTokens.map((t) => sub(t)).filter((b): b is Box => !!b);
    const u = unionBox(parts);
    if (u) hit.title = u;
  }
  const after = hit.code ? hit.code.x : -1;
  const credits = c.credits === null || c.credits === undefined || c.credits === '' ? null : Number(c.credits);
  if (credits !== null && Number.isFinite(credits)) {
    const w = line.words.find((x) => x.box.x >= after && numEq(x.text, credits) && !x.text.includes('%'));
    if (w) hit.credits = w.box;
  }
  const grade = String(c.grade ?? '').trim().toLowerCase();
  if (grade) {
    const ws = line.words.filter((x) => x.text.toLowerCase().replace(/[(),;]/g, '') === grade && x.box.x >= after && x.box !== hit.credits);
    if (ws.length) hit.grade = ws[ws.length - 1].box;
  }
  return hit;
}

/** Locates every extracted value on the document. `items` may be empty (no text layer) - then nothing is highlighted. */
export function matchFields(items: TextItem[], fields: Record<string, unknown>): MatchResult {
  const entries = flattenFields(fields ?? {});
  const highlights: Highlight[] = [];
  if (!items.length) return { fields: entries, highlights };
  const index = buildIndex(items);

  for (const e of entries) {
    if (e.courseIndex !== undefined) continue;
    const boxes = locateLeaf(index, e.value);
    if (boxes && boxes.length) highlights.push({ key: e.key, boxes });
  }

  const courses = Array.isArray(fields?.courses) ? (fields.courses as CourseLike[]) : [];
  const used = new Set<number>();
  courses.forEach((c, i) => {
    if (!isObj(c)) return;
    const hit = locateCourse(index, c, used);
    if (!hit) return;
    highlights.push({ key: `course.${i}`, boxes: [hit.row] });
    for (const part of ['code', 'title', 'credits', 'grade'] as const) {
      const b = hit[part];
      if (b) highlights.push({ key: `course.${i}.${part}`, boxes: [b] });
    }
  });
  return { fields: entries, highlights };
}
