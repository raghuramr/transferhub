import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Eye, Loader2, RefreshCw, ScanLine } from 'lucide-react';
import { fetchUploadBlob, type ScanLayout } from '../../lib/api-scan';
import { disposePages, renderImage, renderPdf, type RenderedPage } from '../../lib/pdf-render';
import { matchFields, type Box, type FieldEntry, type Highlight } from '../../lib/scan-match';
import { cn } from '../../lib/cn';

interface Props {
  uploadId: string;
  mimeType: string;
  /** What the reader extracted (may carry `layout` word positions from an OCR reader). Null while still reading. */
  extracted: { fields: Record<string, unknown>; layout?: ScanLayout } | null;
  /** Document is still being read: show only the page with a looping scan line. */
  reading?: boolean;
  /** Smaller, page only (used in the card while a document is being read). */
  compact?: boolean;
}

const SCAN_MS = 3200;

/** Reveal moment (0..1 of the sweep) for each field: where its highlight sits on the page, else spread by order. */
function revealTimes(fields: FieldEntry[], highlights: Highlight[], pages: RenderedPage[]): number[] {
  const n = pages.length || 1;
  const byKey = new Map(highlights.map((h) => [h.key, h]));
  return fields.map((f, i) => {
    const h = byKey.get(f.key);
    const b = h?.boxes[0];
    if (b) return Math.min(0.98, (b.page + b.y) / n);
    return Math.min(0.98, (i + 1) / (fields.length + 1));
  });
}

export default function ScanViewer({ uploadId, mimeType, extracted, reading, compact }: Props) {
  const reduce = !!useReducedMotion();
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0); // 0..1 sweep position
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [run, setRun] = useState(0); // bumped to replay the sweep
  const scroller = useRef<HTMLDivElement>(null);
  const layout = extracted?.layout;

  // Load and render the document (pdf.js is imported on demand, so this chunk only loads when a scan is shown).
  useEffect(() => {
    let dead = false;
    const ctl = new AbortController();
    let rendered: RenderedPage[] = [];
    setLoading(true);
    setError('');
    (async () => {
      try {
        const blob = await fetchUploadBlob(uploadId, ctl.signal);
        const isPdf = mimeType === 'application/pdf' || blob.type === 'application/pdf';
        rendered = isPdf ? await renderPdf(blob, layout) : await renderImage(blob, layout);
        if (dead) { disposePages(rendered); return; }
        setPages(rendered);
      } catch (e) {
        if (!dead && !ctl.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the document');
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; ctl.abort(); disposePages(rendered); };
  }, [uploadId, mimeType, layout]);

  // The sweep. Reduced motion: everything is shown at once, no moving line.
  useEffect(() => {
    if (loading || !pages.length) return;
    if (reduce && !reading) { setProgress(1); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = ((now - t0) % (reading ? SCAN_MS : Infinity)) / SCAN_MS;
      if (!reading && now - t0 >= SCAN_MS) { setProgress(1); return; }
      setProgress(Math.min(1, p));
      raf = requestAnimationFrame(tick);
    };
    setProgress(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loading, pages.length, reading, reduce, run]);

  const match = useMemo(() => {
    const items = pages.flatMap((p) => p.items);
    return matchFields(items, extracted?.fields ?? {});
  }, [pages, extracted]);
  const times = useMemo(() => revealTimes(match.fields, match.highlights, pages), [match, pages]);
  const hlByKey = useMemo(() => new Map(match.highlights.map((h) => [h.key, h])), [match]);
  const located = match.fields.filter((f) => hlByKey.has(f.key)).length;
  const source = pages.find((p) => p.source !== 'none')?.source ?? 'none';

  const active = hover ?? pinned;
  const courseOf = (k: string | null) => (k ? /^course\.(\d+)/.exec(k)?.[1] ?? null : null);
  const activeCourse = courseOf(active);

  const visibleAt = (key: string): boolean => {
    const i = match.fields.findIndex((f) => f.key === key);
    return i < 0 ? true : progress >= times[i];
  };

  const pinField = useCallback((key: string) => {
    setPinned((p) => (p === key ? null : key));
    // Bring the highlighted spot into view inside the page scroller (not the whole page).
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-hl="${CSS.escape(key)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    });
  }, [reduce]);

  const emphasised = (h: Highlight): boolean => {
    if (!active) return false;
    if (h.key === active) return true;
    if (activeCourse !== null && /^course\.\d+$/.test(active)) return h.key.startsWith(`course.${activeCourse}.`);
    return false;
  };
  const rowVisible = (h: Highlight): boolean => {
    // The whole-row box only appears for the course being hovered/selected.
    const m = /^course\.(\d+)$/.exec(h.key);
    return !m || activeCourse === m[1];
  };

  const boxStyle = (b: Box): React.CSSProperties => ({
    left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
  });

  const pagePanel = (
    <div
      ref={scroller}
      className={cn('relative overflow-auto rounded-xl border border-gray-200 bg-gray-100 p-2', compact ? 'max-h-64' : 'max-h-[55vh] lg:max-h-[70vh]')}
    >
      {loading && (
        <div className="flex h-48 items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="animate-spin" size={16} /> Opening the document…</div>
      )}
      {error && !loading && (
        <div className="flex items-start gap-2 p-4 text-sm text-amber-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> We could not show a preview of this file ({error}). You can still check and edit the fields.</div>
      )}
      {!loading && !error && (
        <div className="relative mx-auto w-full max-w-[820px]">
          <div className="space-y-2">
            {pages.map((p, i) => (
              <div key={i} className="relative overflow-hidden rounded bg-white shadow" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                <img src={p.url} alt={`Document page ${i + 1}`} className="absolute inset-0 h-full w-full select-none" draggable={false} />
                {!reading && match.highlights.map((h) => {
                  if (!rowVisible(h) || !visibleAt(h.key)) return null;
                  const boxes = h.boxes.filter((b) => b.page === i);
                  const on = emphasised(h);
                  const isRow = /^course\.\d+$/.test(h.key);
                  return boxes.map((b, bi) => (
                    <button
                      type="button"
                      key={`${h.key}-${bi}`}
                      data-hl={h.key}
                      aria-label={`Highlight: ${match.fields.find((f) => f.key === h.key)?.label ?? 'course row'}`}
                      onMouseEnter={() => setHover(h.key)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setPinned((pp) => (pp === h.key ? null : h.key))}
                      style={boxStyle(b)}
                      className={cn(
                        'absolute rounded-sm border transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
                        isRow ? 'border-brand-500 bg-brand-500/10' : on ? 'z-10 border-brand-700 bg-brand-500/35 shadow-[0_0_0_3px_rgba(119,8,22,0.25)]' : 'border-amber-500/70 bg-amber-300/30 hover:bg-amber-300/50',
                        !reduce && !on && !isRow && 'animate-[scanpop_.35s_ease-out]',
                      )}
                    />
                  ));
                })}
              </div>
            ))}
          </div>
          {/* The scanning line sweeps the whole stack of pages. */}
          {!reduce && (reading || progress < 1) && (
            <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: `${progress * 100}%` }} aria-hidden>
              <div className="h-0.5 bg-brand-600 shadow-[0_0_12px_3px_rgba(207,58,83,0.6)]" />
              <div className="-mt-10 h-10 bg-gradient-to-b from-transparent to-brand-500/15" />
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-brand-800"><ScanLine size={14} /> Reading this document…</div>
        {pagePanel}
      </div>
    );
  }

  // Group fields for the list (header facts first, then one group per course).
  const groups: { name: string; fields: FieldEntry[] }[] = [];
  for (const f of match.fields) {
    const g = groups[groups.length - 1];
    if (g && g.name === f.group) g.fields.push(f); else groups.push({ name: f.group, fields: [f] });
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900"><Eye size={16} className="text-brand-800" /> How we read it</p>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {!loading && match.fields.length > 0 && <span>{located} of {match.fields.length} values found on the page</span>}
          <button type="button" onClick={() => { setPinned(null); setRun((r) => r + 1); }} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gray-300 px-2.5 text-gray-700 hover:bg-gray-50">
            <RefreshCw size={12} /> Replay
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {pagePanel}
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white p-3">
          {match.fields.length === 0 && <p className="text-sm text-gray-500">Nothing was extracted from this document yet.</p>}
          {groups.map((g, gi) => {
            const ci = g.fields[0].courseIndex;
            const rowKey = ci !== undefined ? `course.${ci}` : null;
            return (
              <div key={`${gi}-${g.name}`} className="mb-3 last:mb-0">
                <button
                  type="button"
                  disabled={!rowKey || !hlByKey.has(rowKey)}
                  onMouseEnter={() => rowKey && hlByKey.has(rowKey) && setHover(rowKey)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => rowKey && pinField(rowKey)}
                  className={cn('mb-1 w-full min-h-[28px] text-left text-xs font-semibold uppercase tracking-wide', rowKey && hlByKey.has(rowKey) ? 'text-brand-800' : 'text-gray-500 cursor-default')}
                >
                  {g.name}
                </button>
                <ul className="space-y-1">
                  {g.fields.map((f) => {
                    const i = match.fields.indexOf(f);
                    const shown = progress >= times[i];
                    const found = hlByKey.has(f.key);
                    const on = active === f.key || (rowKey !== null && active === rowKey);
                    return (
                      <motion.li
                        key={f.key}
                        initial={reduce ? false : { opacity: 0, x: 8 }}
                        animate={shown ? { opacity: 1, x: 0 } : { opacity: 0.12, x: 8 }}
                        transition={{ duration: 0.25 }}
                      >
                        <button
                          type="button"
                          onMouseEnter={() => found && setHover(f.key)}
                          onMouseLeave={() => setHover(null)}
                          onClick={() => found && pinField(f.key)}
                          aria-pressed={on}
                          className={cn(
                            'flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm sm:min-h-[36px]',
                            on ? 'bg-brand-50 ring-1 ring-brand-300' : 'hover:bg-gray-50',
                            !found && 'cursor-default',
                          )}
                        >
                          <span className={cn('h-2 w-2 shrink-0 rounded-full', found ? 'bg-amber-500' : 'bg-gray-300')} title={found ? 'Found on the page' : 'Not located on the page'} />
                          <span className="w-24 shrink-0 text-xs text-gray-500 sm:w-28">{f.label}</span>
                          <span className="min-w-0 flex-1 break-words font-medium text-gray-900">{f.value}</span>
                        </button>
                      </motion.li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {!loading && !error && source === 'none' && match.fields.length > 0 && (
            <p className="mt-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">
              This file has no readable text layer (a photo or scan), so values cannot be pinpointed on the page. They are still listed here for you to check.
            </p>
          )}
          {!loading && !error && source !== 'none' && match.fields.length > 0 && located === 0 && (
            <p className="mt-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">None of the values could be matched to a spot on the page.</p>
          )}
        </div>
      </div>
    </div>
  );
}
