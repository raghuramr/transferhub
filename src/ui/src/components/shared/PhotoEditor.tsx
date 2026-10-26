import { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, Move } from 'lucide-react';

const VIEW = 280; // on-screen crop circle (px)
const OUT = 512; // saved image size (px)

/**
 * Pick a picture, drag it to position it and zoom, then save a square JPEG.
 * The crop is baked into the saved image, so what you see in the circle is
 * what shows on your profile.
 */
export function PhotoEditor({
  file,
  onCancel,
  onSave,
  saving,
}: {
  file: File;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
  saving?: boolean;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // image centre offset from circle centre
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Smallest scale that still covers the whole circle.
  const base = img ? Math.max(VIEW / img.width, VIEW / img.height) : 1;
  const scale = base * zoom;

  const clamp = (p: { x: number; y: number }) => {
    if (!img) return p;
    const maxX = Math.max(0, (img.width * scale - VIEW) / 2);
    const maxY = Math.max(0, (img.height * scale - VIEW) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
  };

  useEffect(() => setPos((p) => clamp(p)), [zoom, img]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d')!;
    const k = OUT / VIEW;
    const w = img.width * scale * k;
    const h = img.height * scale * k;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, OUT / 2 + pos.x * k - w / 2, OUT / 2 + pos.y * k - h / 2, w, h);
    canvas.toBlob((b) => b && onSave(b), 'image/jpeg', 0.9);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Adjust your photo</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>
        <div
          className="relative mx-auto touch-none overflow-hidden rounded-full bg-gray-100 ring-2 ring-brand-200"
          style={{ width: VIEW, height: VIEW, maxWidth: '100%' }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setPos(clamp({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }));
          }}
          onPointerUp={() => (drag.current = null)}
        >
          {img && (
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{
                width: img.width * scale,
                height: img.height * scale,
                left: VIEW / 2 + pos.x - (img.width * scale) / 2,
                top: VIEW / 2 + pos.y - (img.height * scale) / 2,
              }}
            />
          )}
        </div>
        <p className="mt-2 flex items-center justify-center gap-1 text-xs text-gray-500"><Move size={12} /> Drag to move the picture</p>
        <label className="mt-3 flex items-center gap-3 text-sm text-gray-600">
          <ZoomIn size={16} />
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" />
        </label>
        <div className="mt-5 flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={!img || saving} className="flex-1 rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-400">
            {saving ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
