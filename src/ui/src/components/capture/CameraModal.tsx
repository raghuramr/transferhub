import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, RotateCcw, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
}

/** Human wording for the ways getUserMedia fails. */
export function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow the camera for this site in your browser settings, or use your phone\'s camera app below.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Choose a photo from your gallery instead.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'The camera could not be started. You can still take a photo with your phone\'s camera app.';
}

interface Props {
  open: boolean;
  /** Pages captured so far in this session (for the badge). */
  pageCount: number;
  onCapture: (photo: Blob) => void;
  onClose: () => void;
  /** Called when the camera cannot be used; the parent shows its file-input fallback. */
  onUnavailable?: () => void;
}

type Phase = 'starting' | 'live' | 'review' | 'error';

/**
 * In-page camera: rear camera, live preview, framing guide, tap to capture, retake, and keep adding pages
 * until "Done". Falls back gracefully (message + native file input) when permission is denied or the API is missing.
 */
export function CameraModal({ open, pageCount, onCapture, onClose, onUnavailable }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [added, setAdded] = useState(0);
  const fallbackInput = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase('starting');
    setError('');
    if (!cameraSupported()) {
      setError('This browser cannot open the camera from the page. Use your phone\'s camera app below.');
      setPhase('error');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      stream.current = s;
      const v = video.current;
      if (v) {
        v.srcObject = s;
        await v.play().catch(() => undefined);
      }
      setPhase('live');
    } catch (e) {
      stop();
      setError(cameraErrorMessage(e));
      setPhase('error');
    }
  }, [stop]);

  useEffect(() => {
    if (!open) return;
    setAdded(0);
    setShot(null);
    void start();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      stop();
    };
  }, [open, start, stop]);

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  if (!open) return null;

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      setShot({ blob: b, url: URL.createObjectURL(b) });
      setPhase('review');
    }, 'image/jpeg', 0.92);
  };

  const usePhoto = () => {
    if (!shot) return;
    onCapture(shot.blob);
    setAdded((n) => n + 1);
    setShot(null);
    setPhase('live');
  };
  const retake = () => { setShot(null); setPhase('live'); };

  const corner = 'absolute h-8 w-8 border-white';
  return (
    <div role="dialog" aria-modal="true" aria-label="Camera" className="fixed inset-0 z-[60] flex flex-col bg-black text-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center justify-between px-4 py-2">
        <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10" aria-label="Close camera"><X size={20} /></button>
        <p className="text-sm font-medium" aria-live="polite">{added + pageCount > 0 ? `${added + pageCount} page${added + pageCount === 1 ? '' : 's'} captured` : 'Position the page inside the frame'}</p>
        <span className="w-11" />
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted autoPlay className={cn('absolute inset-0 h-full w-full object-cover', phase !== 'live' && phase !== 'starting' && 'invisible')} />
        {phase === 'review' && shot && <img src={shot.url} alt="Captured page" className="absolute inset-0 h-full w-full bg-black object-contain" />}

        {phase === 'live' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6" aria-hidden>
            <div className="relative h-full max-h-[78%] w-full max-w-md" style={{ aspectRatio: '3 / 4' }}>
              <span className={cn(corner, 'left-0 top-0 rounded-tl-lg border-l-4 border-t-4')} />
              <span className={cn(corner, 'right-0 top-0 rounded-tr-lg border-r-4 border-t-4')} />
              <span className={cn(corner, 'bottom-0 left-0 rounded-bl-lg border-b-4 border-l-4')} />
              <span className={cn(corner, 'bottom-0 right-0 rounded-br-lg border-b-4 border-r-4')} />
            </div>
          </div>
        )}
        {phase === 'starting' && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting the camera…</div>}
        {phase === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <Camera size={36} className="text-white/60" />
            <p className="max-w-sm text-sm text-white/90">{error}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => void start()} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/40 px-4 text-sm"><RotateCcw size={15} /> Try again</button>
              <button type="button" onClick={() => fallbackInput.current?.click()} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-medium text-gray-900"><ImagePlus size={15} /> Use phone camera app</button>
            </div>
            <input
              ref={fallbackInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) { onCapture(f); setAdded((n) => n + 1); onUnavailable?.(); onClose(); }
              }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-6 pt-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        {phase === 'review' ? (
          <>
            <button type="button" onClick={retake} className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full border border-white/40 px-5 text-sm font-medium"><RotateCcw size={16} /> Retake</button>
            <button type="button" onClick={usePhoto} className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full bg-white px-5 text-sm font-semibold text-gray-900"><Check size={16} /> Use this page</button>
          </>
        ) : (
          <>
            <span className="w-24 text-xs text-white/60">{phase === 'live' ? 'Tap to capture' : ''}</span>
            <button
              type="button"
              onClick={capture}
              disabled={phase !== 'live'}
              aria-label="Take photo"
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
            >
              <span className="h-14 w-14 rounded-full bg-white" />
            </button>
            <button type="button" onClick={onClose} className="inline-flex min-h-[48px] w-24 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold">
              Done{added + pageCount > 0 ? ` (${added + pageCount})` : ''}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
