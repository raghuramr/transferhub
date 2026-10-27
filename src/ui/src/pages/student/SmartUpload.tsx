import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, FileText, Info, Lock, Pause, RefreshCw, UploadCloud } from 'lucide-react';
import { documentsApi, getErrorMessage, type ExtractedDocument, type IntakeItem } from '../../lib/api';
import { DocumentEditor } from '../../components/documents/DocumentEditor';
import { ConfidenceBar, StatusChip } from '../../components/documents/StatusChip';
import { cn } from '../../lib/cn';

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function DocumentCard({ item, docTypes, aiEnabled, rules }: { item: IntakeItem; docTypes: { key: string; label: string }[]; aiEnabled: boolean; rules: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(item.status === 'needs_review');
  const [msg, setMsg] = useState('');
  const confirmed = item.status === 'confirmed';
  const busy = item.status === 'uploaded' || item.status === 'reading';
  const refresh = () => qc.invalidateQueries({ queryKey: ['documents', 'intakes'] });

  const detail = useQuery({
    queryKey: ['documents', 'intake', item.id, item.status, item.docType],
    queryFn: async () => (await documentsApi.get(item.id)).data,
    enabled: open && !busy,
  });

  const typeMut = useMutation({
    mutationFn: (docType: string) => documentsApi.update(item.id, { docType }),
    onSuccess: refresh,
    onError: (e) => setMsg(getErrorMessage(e, 'Could not change the type')),
  });
  const saveMut = useMutation({
    mutationFn: (extracted: ExtractedDocument) => documentsApi.update(item.id, { extracted }),
    onSuccess: () => { setMsg('Changes saved.'); refresh(); },
    onError: (e) => setMsg(getErrorMessage(e, 'Could not save your changes')),
  });
  const retryMut = useMutation({ mutationFn: () => documentsApi.retry(item.id), onSuccess: refresh, onError: (e) => setMsg(getErrorMessage(e, 'Could not retry')) });
  const confirmMut = useMutation({
    mutationFn: async () => (await documentsApi.confirm(item.id)).data,
    onSuccess: (res) => {
      setMsg(res.applied.education || res.applied.profile ? 'Confirmed - your profile was updated.' : 'Confirmed.');
      refresh();
    },
    onError: (e) => setMsg(getErrorMessage(e, 'Could not confirm the document')),
  });

  const label = docTypes.find((d) => d.key === item.docType)?.label ?? item.docType;
  const canPickType = !confirmed && !busy && (!aiEnabled || rules || item.status === 'skipped' || item.status === 'failed' || item.status === 'needs_review');

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={cn('rounded-xl border bg-white shadow-sm', confirmed ? 'border-green-200' : 'border-gray-200')}>
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className={cn('rounded-lg p-2', confirmed ? 'bg-green-50 text-green-700' : 'bg-brand-50 text-brand-800')}>{confirmed ? <Check size={18} /> : <FileText size={18} />}</span>
        <div className="min-w-[10rem] flex-1">
          <p className="break-all font-medium text-gray-900 sm:break-normal sm:truncate">{item.fileName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusChip status={item.status} />
            {label && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">{label}</span>}
            <ConfidenceBar value={item.confidence} />
          </div>
          {item.summary && <p className="mt-1 text-sm text-gray-500">{item.summary}</p>}
          {item.error && <p className="mt-1 text-sm text-red-600">{item.error}</p>}
        </div>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          {canPickType && (
            <select
              value={item.docType ?? ''}
              onChange={(e) => e.target.value && typeMut.mutate(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label="Document type"
            >
              <option value="">Choose type…</option>
              {docTypes.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          )}
          {item.status === 'failed' && aiEnabled && (
            <button type="button" onClick={() => retryMut.mutate()} disabled={retryMut.isPending} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              <RefreshCw size={13} className={retryMut.isPending ? 'animate-spin' : ''} /> Retry
            </button>
          )}
          {!busy && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label={open ? 'Hide details' : 'Show details'}>
              <ChevronDown size={18} className={cn('transition-transform', open && 'rotate-180')} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && !busy && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-gray-100">
            <div className="space-y-4 p-4">
              {detail.isLoading && <p className="text-sm text-gray-400">Loading details…</p>}
              {detail.data && (
                <DocumentEditor detail={detail.data} readOnly={confirmed} saving={saveMut.isPending} onSave={(x) => saveMut.mutate(x)} />
              )}
              {msg && <p className="text-sm text-gray-600">{msg}</p>}
              {!confirmed && item.docType && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-400">
                    <Check size={15} /> {confirmMut.isPending ? 'Confirming…' : 'Confirm document'}
                  </button>
                </div>
              )}
              {item.docType === 'transcript' && (confirmed || confirmMut.isSuccess) && (
                <button type="button" onClick={() => navigate(`/student/upload?intake=${item.id}`)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900">
                  Use for evaluation
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function SmartUpload() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');

  const status = useQuery({ queryKey: ['documents', 'status'], queryFn: async () => (await documentsApi.status()).data, staleTime: 60_000 });
  const list = useQuery({
    queryKey: ['documents', 'intakes'],
    queryFn: async () => (await documentsApi.list()).data,
    refetchInterval: (q) => ((q.state.data ?? []).some((i) => i.status === 'uploaded' || i.status === 'reading') ? 2000 : false),
  });
  const items = list.data ?? [];
  const docTypes = status.data?.docTypes ?? [];
  const reader = status.data?.reader;
  const rules = reader === 'rules';
  // A reader (AI or built-in) will actually run unless the reader is 'paused'.
  const aiEnabled = reader ? reader !== 'paused' : true;

  const upload = useMutation({
    mutationFn: (files: File[]) => documentsApi.upload(files),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', 'intakes'] }),
    onError: (e) => setError(getErrorMessage(e, 'Upload failed. Please try again.')),
  });

  const pick = useCallback((fl: FileList | File[]) => {
    setError('');
    const files = Array.from(fl);
    if (files.length === 0) return;
    if (files.length > 5) return setError('Upload up to 5 documents at a time.');
    const bad = files.find((f) => !ALLOWED.includes(f.type) || f.size > MAX_BYTES);
    if (bad) return setError(`"${bad.name}" is not allowed. Use a PDF, JPG, PNG or WebP under 15 MB.`);
    upload.mutate(files);
  }, [upload]);

  return (
    <div className="w-[95%] mx-auto p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Smart upload</h1>
      <p className="mt-1 mb-5 text-gray-500">Drop your transcripts and other documents. We read them, work out what each one is and fill in the details for you to check.</p>

      {rules && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>Your documents are read by our built-in reader. It is less accurate than AI reading, so please check every field before you confirm. Scanned PDFs and photos cannot be read automatically - for those, choose the type and fill in the details yourself.</span>
        </div>
      )}
      {reader === 'paused' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <Pause size={16} className="mt-0.5 shrink-0" />
          <span>Automatic reading is paused - choose each document type yourself.{status.data?.reason ? ` (${status.data.reason})` : ''}</span>
        </div>
      )}
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <motion.div
        animate={{ scale: drag ? 1.01 : 1 }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        className={cn('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors', drag ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-white hover:border-brand-400')}
      >
        <UploadCloud className={cn('mb-2', upload.isPending ? 'animate-pulse text-brand-700' : 'text-brand-800')} size={34} />
        <p className="font-medium text-gray-900">{upload.isPending ? 'Uploading…' : 'Drag documents here or click to choose'}</p>
        <p className="mt-1 text-xs text-gray-500">PDF, JPG, PNG or WebP · up to 5 files · 15 MB each</p>
        <input ref={inputRef} type="file" multiple accept=".pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { if (e.target.files) pick(e.target.files); e.target.value = ''; }} />
      </motion.div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400"><Lock size={12} /> Documents are stored privately in your profile folder.</p>

      <h2 className="mb-3 mt-8 font-semibold text-gray-900">Your documents</h2>
      {list.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!list.isLoading && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Nothing here yet. Upload a transcript to get started - we will do the typing for you.
        </p>
      )}
      <div className="space-y-3">
        {items.map((it) => <DocumentCard key={it.id} item={it} docTypes={docTypes} aiEnabled={aiEnabled} rules={rules} />)}
      </div>
    </div>
  );
}
