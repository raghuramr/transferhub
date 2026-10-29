import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Images, UploadCloud, Copy, Check, ExternalLink, Pencil, Trash2, RefreshCw, Search, FileText, X, ClipboardList, Info,
} from 'lucide-react';
import { assetUrl, galleryApi, getErrorMessage, type GalleryItem } from '../../lib/api';
import { cn } from '../../lib/cn';

/** Absolute URL for a gallery item: direct Azure Storage URLs are already absolute; API-served ones get this site's origin. */
function absoluteUrl(item: GalleryItem) {
  return item.url.startsWith('http') ? item.url : new URL(assetUrl(item.url), window.location.origin).href;
}

const isImage = (item: GalleryItem) => (item.mimeType ?? '').startsWith('image/');
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label = 'Copy URL' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
        done ? 'bg-green-50 text-green-700' : 'bg-brand-800 text-white hover:bg-brand-900',
      )}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? 'Copied' : label}
    </button>
  );
}

function GalleryCard({ item, categories, version }: { item: GalleryItem; categories: string[]; version: number }) {
  const qc = useQueryClient();
  const replaceRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? '');
  const url = absoluteUrl(item);
  const refresh = () => qc.invalidateQueries({ queryKey: ['gallery'] });

  const save = useMutation({
    mutationFn: () => galleryApi.update(item.id, { name: name.trim(), category: category.trim() || null }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const replace = useMutation({ mutationFn: (file: File) => galleryApi.replace(item.id, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => galleryApi.remove(item.id), onSuccess: refresh });
  const error = save.error || replace.error || remove.error;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
      <a href={url} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] overflow-hidden bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
        {isImage(item) ? (
          // ?v= busts the browser cache after "Replace file" (the URL itself never changes)
          <img src={`${url}${url.includes('?') ? '&' : '?'}v=${version}`} alt={item.name} className="absolute inset-0 h-full w-full object-contain" loading="lazy" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-gray-400">
            <FileText size={32} />
            <span className="text-xs uppercase">{item.name.split('.').pop()}</span>
          </div>
        )}
        {replace.isPending && <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs text-gray-600">Replacing…</div>}
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {editing ? (
          <div className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" aria-label="Name" />
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="gallery-categories"
              placeholder="Category (optional)"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              aria-label="Category"
            />
            <datalist id="gallery-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <div className="flex gap-2">
              <button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()} className="rounded-md bg-brand-800 px-3 py-1 text-xs font-medium text-white disabled:bg-brand-400">
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setName(item.name); setCategory(item.category ?? ''); }} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900" title={item.name}>{item.name}</p>
            <p className="text-xs text-gray-400">
              {item.category && <span className="mr-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-brand-800">{item.category}</span>}
              {fmtSize(item.sizeBytes)} · {new Date(item.createdAt).toLocaleDateString()}
            </p>
          </div>
        )}

        <input readOnly value={url} onFocus={(e) => e.target.select()} className="w-full truncate rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[11px] text-gray-600" aria-label="Public URL" />

        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <CopyButton text={url} />
          <a href={url} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100" title="Open"><ExternalLink size={14} /></a>
          <button onClick={() => setEditing((v) => !v)} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100" title="Rename / change category"><Pencil size={14} /></button>
          <button onClick={() => replaceRef.current?.click()} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100" title="Replace file (keeps the same URL)"><RefreshCw size={14} /></button>
          <input
            ref={replaceRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) replace.mutate(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => window.confirm(`Delete "${item.name}"? Anything that links to its URL will stop showing it.`) && remove.mutate()}
            disabled={remove.isPending}
            className="ml-auto rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{getErrorMessage(error, 'That did not work. Please try again.')}</p>}
      </div>
    </div>
  );
}

export default function Gallery() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);

  const { data, isLoading, dataUpdatedAt } = useQuery({ queryKey: ['gallery'], queryFn: () => galleryApi.list() });
  const items = data?.data ?? [];
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean) as string[])].sort(), [items]);
  const shown = items.filter(
    (i) => (!filter || i.category === filter) && (!search || `${i.name} ${i.category ?? ''}`.toLowerCase().includes(search.toLowerCase())),
  );
  const viaApi = items.some((i) => !i.direct);

  const uploadAll = async (files: File[]) => {
    if (!files.length) return;
    setProgress({ done: 0, total: files.length, failed: [] });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        await galleryApi.upload(files[i], category.trim() || undefined);
      } catch (e) {
        failed.push(`${files[i].name}: ${getErrorMessage(e, 'upload failed')}`);
      }
      setProgress({ done: i + 1, total: files.length, failed: [...failed] });
    }
    await qc.invalidateQueries({ queryKey: ['gallery'] });
    if (!failed.length) setTimeout(() => setProgress(null), 2500);
  };

  const listText = shown.map((i) => `${i.name}\t${absoluteUrl(i)}`).join('\n');

  return (
    <div className="p-4 sm:p-6 w-[95%] mx-auto">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Images className="text-brand-800" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Gallery</h1>
            <p className="text-sm text-gray-500">Public files in the storage account. Copy a URL to use it anywhere: in the app, pages, emails or outside it.</p>
          </div>
        </div>
        {shown.length > 0 && <CopyButton text={listText} label={`Copy ${shown.length} URL${shown.length === 1 ? '' : 's'}`} />}
      </div>

      {/* Upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadAll(Array.from(e.dataTransfer.files)); }}
        className={cn('mb-6 rounded-xl border-2 border-dashed p-5 transition-colors', dragOver ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-white')}
      >
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <UploadCloud size={28} className="shrink-0 text-brand-700" />
          <div className="flex-1 text-center sm:text-left">
            <p className="text-sm font-medium text-gray-900">Drop files here, or choose them</p>
            <p className="text-xs text-gray-500">Images (JPEG, PNG, WebP, SVG, GIF), PDF and Office files, up to 15 MB each. Photos are resized to 1920 px and saved as WebP.</p>
          </div>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="gallery-upload-categories"
            placeholder="Category, e.g. team, logos"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-56"
            aria-label="Category for new uploads"
          />
          <datalist id="gallery-upload-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <button onClick={() => inputRef.current?.click()} className="w-full rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 sm:w-auto">
            Add files
          </button>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => { void uploadAll(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div>
        {progress && (
          <div className="mt-3 text-xs">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <p className="mt-1 text-gray-500">Uploaded {progress.done} of {progress.total}{progress.failed.length ? ` · ${progress.failed.length} failed` : ''}</p>
            {progress.failed.map((f) => <p key={f} className="text-red-600">{f}</p>)}
            {progress.failed.length > 0 && <button onClick={() => setProgress(null)} className="mt-1 text-gray-500 underline">Dismiss</button>}
          </div>
        )}
      </div>

      {viaApi && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>Some files are served through this site (<code>/api/uploads/public/…</code>) rather than straight from Azure Storage, because the storage
          account's public container is not anonymously readable (or storage is not configured). The links still work without signing in.</span>
        </p>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files…" className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm" />
        </div>
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setFilter(null)} className={cn('rounded-full px-3 py-1 text-xs', !filter ? 'bg-brand-800 text-white' : 'bg-gray-100 text-gray-600')}>All ({items.length})</button>
            {categories.map((c) => (
              <button key={c} onClick={() => setFilter(filter === c ? null : c)} className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs', filter === c ? 'bg-brand-800 text-white' : 'bg-gray-100 text-gray-600')}>
                {c} ({items.filter((i) => i.category === c).length}){filter === c && <X size={11} />}
              </button>
            ))}
          </div>
        )}
        {shown.length > 0 && (
          <button onClick={() => copyText(listText)} className="ml-auto hidden items-center gap-1 text-xs text-gray-500 hover:text-gray-800 sm:inline-flex" title="Name and URL per line">
            <ClipboardList size={13} /> Copy as list
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-400">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-400">
          {items.length ? 'No files match.' : 'No files yet. Add team photos, logos or banners above.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
          {shown.map((item) => <GalleryCard key={item.id} item={item} categories={categories} version={dataUpdatedAt} />)}
        </div>
      )}
    </div>
  );
}
