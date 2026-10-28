import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, CheckCircle2, ImagePlus, Loader2, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { getErrorMessage, type IntakeItem } from '../../lib/api';
import { uploadSmartDocuments } from '../../lib/api-scan';
import { buildPdf } from '../../lib/capture-pdf';
import { formatBytes, moveItem, removeAt } from '../../lib/capture-logic';
import { prepareImage, type PreparedImage } from '../../lib/image-prep';
import { canTransition, type CaptureState } from '../../lib/retry';
import { CameraModal, cameraSupported } from './CameraModal';
import { cn } from '../../lib/cn';

const MAX_BYTES = 15 * 1024 * 1024;

interface Page extends PreparedImage {
  id: string;
}

interface Props {
  /** The student's current document list (kept fresh by the parent) - used to follow "reading" to "review". */
  intakes: IntakeItem[];
  /** Called after the files were stored, so the parent can refresh the list. */
  onUploaded: (items: IntakeItem[]) => void;
}

let seq = 0;

/**
 * Camera-first capture: take or choose photos, tidy them on the phone (rotate, downscale, optional contrast),
 * combine pages into one PDF, upload with progress and automatic retries, then follow the reading until review.
 */
export function CaptureFlow({ intakes, onUploaded }: Props) {
  const [pages, setPages] = useState<Page[]>([]);
  const [state, setState] = useState<CaptureState>('capturing');
  const [percent, setPercent] = useState(0);
  const [retryNote, setRetryNote] = useState('');
  const [error, setError] = useState('');
  const [enhance, setEnhance] = useState(true);
  const [asPdf, setAsPdf] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busyPrep, setBusyPrep] = useState(0);
  const [uploadedIds, setUploadedIds] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const ctl = useRef<AbortController | null>(null);
  const lastFiles = useRef<File[]>([]);
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages;

  const go = useCallback((to: CaptureState) => setState((from) => (canTransition(from, to) ? to : from)), []);

  useEffect(() => () => { pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)); ctl.current?.abort(); }, []);

  // Follow the uploaded documents until none is still being read.
  useEffect(() => {
    if (state !== 'reading' || uploadedIds.length === 0) return;
    const mine = intakes.filter((i) => uploadedIds.includes(i.id));
    if (mine.length === uploadedIds.length && mine.every((i) => i.status !== 'uploaded' && i.status !== 'reading')) go('review');
  }, [state, intakes, uploadedIds, go]);

  const addFiles = useCallback(async (files: Blob[]) => {
    setError('');
    setBusyPrep((n) => n + files.length);
    for (const f of files) {
      try {
        const prepared = await prepareImage(f, { enhance });
        setPages((p) => [...p, { ...prepared, id: `pg${++seq}` }]);
      } catch {
        setError('One of the photos could not be read. Try taking it again.');
      } finally {
        setBusyPrep((n) => n - 1);
      }
    }
    setState((s) => (s === 'review' || s === 'failed' ? 'capturing' : s));
  }, [enhance]);

  const onChosen = (fl: FileList | null) => {
    if (!fl) return;
    const list = Array.from(fl);
    const pdf = list.find((f) => f.type === 'application/pdf');
    if (pdf) {
      // A ready-made PDF is uploaded as it is; only photos go through the page tools.
      void uploadReady([pdf]);
      return;
    }
    const images = list.filter((f) => f.type.startsWith('image/'));
    if (!images.length) { setError('Choose photos or a PDF.'); return; }
    void addFiles(images);
  };

  const remove = (i: number) => {
    setPages((p) => { URL.revokeObjectURL(p[i].url); return removeAt(p, i); });
  };

  async function uploadReady(files: File[]) {
    const big = files.find((f) => f.size > MAX_BYTES);
    if (big) { setError(`"${big.name}" is over 15 MB. Take fewer pages or lower the quality.`); return; }
    lastFiles.current = files;
    setError('');
    setRetryNote('');
    setPercent(0);
    setState('uploading');
    ctl.current = new AbortController();
    try {
      const items = await uploadSmartDocuments(files, {
        signal: ctl.current.signal,
        onProgress: setPercent,
        onRetry: (attempt, wait) => setRetryNote(`Connection hiccup - retrying (${attempt}/3) in ${Math.ceil(wait / 1000)}s…`),
      });
      setRetryNote('');
      setUploadedIds(items.map((i) => i.id));
      onUploaded(items);
      pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
      setPages([]);
      const reading = items.some((i) => i.status === 'uploaded' || i.status === 'reading');
      go(reading ? 'reading' : 'review');
    } catch (e) {
      setError(ctl.current?.signal.aborted ? 'Upload cancelled.' : getErrorMessage(e, 'Upload failed. Check your connection and try again.'));
      setRetryNote('');
      go('failed');
    }
  }

  async function submitPages() {
    if (!pages.length) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    try {
      let files: File[];
      if (pages.length > 1 && asPdf) {
        const jpegs = await Promise.all(pages.map(async (p) => ({ bytes: new Uint8Array(await p.blob.arrayBuffer()), width: p.width, height: p.height })));
        const pdf = await buildPdf(jpegs);
        files = [new File([pdf.buffer as ArrayBuffer], `scan-${stamp}.pdf`, { type: 'application/pdf' })];
      } else {
        files = pages.map((p, i) => new File([p.blob], `scan-${stamp}${pages.length > 1 ? `-p${i + 1}` : ''}.jpg`, { type: 'image/jpeg' }));
      }
      if (files.length > 5) { setError('Combine the pages into one PDF, or upload up to 5 files at a time.'); return; }
      await uploadReady(files);
    } catch {
      setError('Could not prepare the pages for upload. Please try again.');
      go('failed');
    }
  }

  const totalBytes = pages.reduce((n, p) => n + p.blob.size, 0);
  const uploading = state === 'uploading';
  const stateLabel: Record<CaptureState, string> = {
    capturing: 'Capture', uploading: 'Uploading', reading: 'Reading', review: 'Review', failed: 'Upload',
  };
  const steps: CaptureState[] = ['capturing', 'uploading', 'reading', 'review'];
  const stepIdx = state === 'failed' ? 1 : steps.indexOf(state);

  return (
    <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" aria-label="Scan with your camera">
      <div className="mb-3 flex items-start gap-3">
        <span className="rounded-xl bg-brand-50 p-2.5 text-brand-800"><Camera size={22} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-900">Scan with your camera</h2>
          <p className="text-sm text-gray-500">Photograph each page of your transcript. We tidy the photos and combine them into one document.</p>
        </div>
      </div>

      <ol className="mb-3 flex items-center gap-1 text-[11px] font-medium text-gray-500" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className={cn('flex flex-1 items-center gap-1', i <= stepIdx && 'text-brand-800')}>
            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]', i < stepIdx ? 'bg-brand-800 text-white' : i === stepIdx ? (state === 'failed' ? 'bg-red-600 text-white' : 'bg-brand-100 text-brand-800 ring-2 ring-brand-600') : 'bg-gray-200')}>
              {i < stepIdx ? '✓' : i + 1}
            </span>
            <span className="truncate">{state === 'failed' && i === 1 ? 'Failed' : stateLabel[s]}</span>
            {i < steps.length - 1 && <span className={cn('h-px flex-1', i < stepIdx ? 'bg-brand-800' : 'bg-gray-200')} />}
          </li>
        ))}
      </ol>

      {(state === 'capturing' || state === 'failed' || state === 'review') && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => (cameraSupported() ? setCameraOpen(true) : nativeCamera.current?.click())}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-800 px-4 text-sm font-semibold text-white hover:bg-brand-900"
          >
            <Camera size={18} /> {pages.length ? 'Add another page' : 'Open camera'}
          </button>
          <button type="button" onClick={() => nativeCamera.current?.click()} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50">
            <Camera size={18} /> Phone camera app
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50">
            <ImagePlus size={18} /> Gallery or PDF
          </button>
          <input ref={nativeCamera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onChosen(e.target.files); e.target.value = ''; }} />
          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { onChosen(e.target.files); e.target.value = ''; }} />
        </div>
      )}

      {busyPrep > 0 && <p className="mt-3 flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Tidying {busyPrep} photo{busyPrep === 1 ? '' : 's'}…</p>}

      {pages.length > 0 && !uploading && state !== 'reading' && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-gray-800">{pages.length} page{pages.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}</p>
          <ul className="flex gap-3 overflow-x-auto pb-2" aria-label="Captured pages">
            {pages.map((p, i) => (
              <li key={p.id} className="w-28 shrink-0">
                <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50" style={{ aspectRatio: '3 / 4' }}>
                  <img src={p.url} alt={`Page ${i + 1}`} className="h-full w-full object-contain" />
                  <span className="absolute left-1 top-1 rounded bg-black/65 px-1.5 text-[11px] font-semibold text-white">{i + 1}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <button type="button" disabled={i === 0} onClick={() => setPages((a) => moveItem(a, i, i - 1))} className="flex h-11 w-9 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30" aria-label={`Move page ${i + 1} earlier`}><ArrowLeft size={16} /></button>
                  <button type="button" onClick={() => remove(i)} className="flex h-11 w-9 items-center justify-center rounded text-red-600 hover:bg-red-50" aria-label={`Delete page ${i + 1}`}><Trash2 size={16} /></button>
                  <button type="button" disabled={i === pages.length - 1} onClick={() => setPages((a) => moveItem(a, i, i + 1))} className="flex h-11 w-9 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30" aria-label={`Move page ${i + 1} later`}><ArrowRight size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-700">
            <label className="inline-flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} className="h-4 w-4" /> <Wand2 size={14} /> Boost contrast on new photos</label>
            {pages.length > 1 && <label className="inline-flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={asPdf} onChange={(e) => setAsPdf(e.target.checked)} className="h-4 w-4" /> Combine into one PDF</label>}
          </div>
          <button type="button" onClick={() => void submitPages()} disabled={busyPrep > 0} className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-brand-800 px-4 text-sm font-semibold text-white hover:bg-brand-900 disabled:bg-brand-400 sm:w-auto">
            {state === 'failed' ? <><RefreshCw size={16} /> Try the upload again</> : <>Upload {pages.length > 1 && asPdf ? 'as one document' : pages.length > 1 ? `${pages.length} files` : 'page'}</>}
          </button>
        </div>
      )}

      {uploading && (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="mb-1 flex justify-between text-sm text-gray-700"><span>{retryNote || 'Uploading…'}</span><span className="font-medium">{percent}%</span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-gray-200"><div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${percent}%` }} /></div>
          <button type="button" onClick={() => { ctl.current?.abort(); }} className="mt-2 min-h-[44px] text-sm text-gray-500 underline">Cancel</button>
        </div>
      )}
      {state === 'failed' && pages.length === 0 && lastFiles.current.length > 0 && (
        <button type="button" onClick={() => void uploadReady(lastFiles.current)} className="mt-3 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-brand-800 px-4 text-sm font-semibold text-white hover:bg-brand-900"><RefreshCw size={16} /> Try the upload again</button>
      )}
      {state === 'reading' && (
        <p className="mt-4 flex items-center gap-2 text-sm text-brand-800" role="status"><Loader2 size={16} className="animate-spin" /> Uploaded. Reading your document - this takes a few seconds…</p>
      )}
      {state === 'review' && pages.length === 0 && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status"><CheckCircle2 size={16} /> Done reading. Check the details in your document list below, then confirm.</p>
      )}
      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <CameraModal
        open={cameraOpen}
        pageCount={pages.length + busyPrep}
        onCapture={(b) => void addFiles([b])}
        onClose={() => setCameraOpen(false)}
      />
    </section>
  );
}
