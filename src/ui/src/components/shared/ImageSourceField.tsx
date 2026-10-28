import { useRef, useState } from 'react';
import { Upload, Loader2, Link as LinkIcon, X } from 'lucide-react';
import { assetUrl, uploadsApi } from '../../lib/api';

/**
 * A Logo/Hero image field that lets an admin either upload a file (stored
 * publicly — see uploads module / CLAUDE.md "Uploads subsystem") or paste
 * an external image URL. Stores a single string value: `/uploads/public/:id`
 * or an external `https://...` URL.
 */
export function ImageSourceField({
  label,
  value,
  onChange,
  entityType,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  entityType: string;
}) {
  const [mode, setMode] = useState<'upload' | 'url'>(value && !value.startsWith('/uploads/') ? 'url' : 'upload');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadsApi.upload(file, { isPublic: true, entityType });
      onChange((res.data as { url: string }).url);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center gap-3 mb-2 text-xs">
        <button
          type="button"
          onClick={() => setMode('upload')}
          className={`px-2 py-1 rounded-md ${mode === 'upload' ? 'bg-brand-800 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          Upload a file
        </button>
        <button
          type="button"
          onClick={() => setMode('url')}
          className={`px-2 py-1 rounded-md ${mode === 'url' ? 'bg-brand-800 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          Paste an image URL
        </button>
      </div>

      {mode === 'upload' ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-sm px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Uploading…' : 'Choose image'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          {value && (
            <div className="flex items-center gap-2">
              <img src={assetUrl(value)} alt="" className="h-10 w-10 rounded object-contain bg-white border border-gray-200" />
              <button type="button" onClick={() => onChange('')} className="text-gray-400 hover:text-red-500">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <LinkIcon size={14} className="text-gray-400 shrink-0" />
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      )}
    </div>
  );
}
