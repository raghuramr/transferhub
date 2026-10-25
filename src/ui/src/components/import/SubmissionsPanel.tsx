import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Inbox, Loader2, Mail, Plus, RotateCcw, Search, XCircle } from 'lucide-react';
import { importApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { BatchDetail, BatchRow, BatchSummary, EntityType, ImportRunResult } from '../../types/import';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};
const when = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');
const TYPE_LABEL: Record<EntityType, string> = { universities: 'University', programs: 'Program', courses: 'Course' };
const TYPE_ORDER: EntityType[] = ['universities', 'programs', 'courses'];
const CHUNK = 500;

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  partial: 'bg-blue-50 text-blue-700',
  imported: 'bg-green-50 text-green-700',
  rejected: 'bg-gray-100 text-gray-600',
  created: 'bg-green-50 text-green-700',
  updated: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting', partial: 'Partly done', imported: 'Processed', rejected: 'Rejected', created: 'Added', updated: 'Updated', failed: 'Failed',
};

function Pill({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[kind] ?? 'bg-gray-100 text-gray-600')}>{children}</span>;
}

// ── list ──
function BatchList({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('open');
  const [staging, setStaging] = useState(false);
  const q = useQuery({ queryKey: ['import-batches', filter], queryFn: () => importApi.batches({ status: filter === 'all' ? undefined : filter }), refetchInterval: 30_000 });
  const rows = q.data?.data ?? [];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {[['open', 'Needs review'], ['imported', 'Processed'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-md px-3 py-1.5 font-medium', filter === k ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-50')}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={() => setStaging(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Plus size={15} /> Stage rows yourself
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5">Reference</th><th className="px-4 py-2.5">From</th><th className="px-4 py-2.5">Received</th>
              <th className="px-4 py-2.5">Rows</th><th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((b) => (
              <tr key={b.id} onClick={() => onOpen(b.id)} className="cursor-pointer hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-brand-800">{b.reference}</td>
                <td className="px-4 py-3">
                  {b.partner ? (<><div className="text-gray-900">{b.partner.universityName}</div><div className="text-xs text-gray-400">{b.partner.contactName}</div></>) : <span className="text-gray-500">Staged by staff</span>}
                </td>
                <td className="px-4 py-3 text-gray-600">{when(b.submittedAt)}</td>
                <td className="px-4 py-3 text-gray-700">
                  {b.counts.total ?? 0}
                  <span className="ml-2 text-xs text-gray-400">
                    {b.counts.pending ? `${b.counts.pending} waiting` : ''}
                    {b.counts.errors ? ` · ${b.counts.errors} with errors` : ''}
                  </span>
                </td>
                <td className="px-4 py-3"><Pill kind={b.status}>{STATUS_LABEL[b.status]}</Pill></td>
              </tr>
            ))}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400"><Inbox className="mx-auto mb-2 text-gray-300" size={28} />Nothing here yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {staging && <StageModal onClose={() => setStaging(false)} onStaged={(id) => { setStaging(false); void qc.invalidateQueries({ queryKey: ['import-batches'] }); onOpen(id); }} />}
    </div>
  );
}

function StageModal({ onClose, onStaged }: { onClose: () => void; onStaged: (id: number) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const stage = useMutation({
    mutationFn: (body: Record<string, unknown>) => importApi.stage(body),
    onSuccess: (res) => onStaged(res.data.batchId),
    onError: (e) => setError(errMsg(e, 'Could not stage the rows.')),
  });
  const go = () => {
    setError('');
    try {
      const parsed = JSON.parse(text);
      stage.mutate(parsed);
    } catch {
      setError('That is not valid JSON.');
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-semibold text-gray-900">Stage rows for review</h3>
        <p className="mb-3 text-sm text-gray-500">Paste JSON with any of <code className="rounded bg-gray-100 px-1">universities</code>, <code className="rounded bg-gray-100 px-1">programs</code>, <code className="rounded bg-gray-100 px-1">courses</code>. Rows are checked and queued; nothing is written until you import them.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={'{\n  "courses": [ { "universityCode": "MIT", "code": "6.0001", "name": "Intro to CS", "credits": 3 } ]\n}'} className="w-full rounded-lg border border-gray-300 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand-500" />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancel</button>
          <button type="button" disabled={!text.trim() || stage.isPending} onClick={go} className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white disabled:bg-brand-300">
            {stage.isPending && <Loader2 size={14} className="animate-spin" />} Stage rows
          </button>
        </div>
      </div>
    </div>
  );
}

// ── row editing ──
function RowDetail({ batch, row, onChanged }: { batch: BatchDetail; row: BatchRow; onChanged: () => void }) {
  const editable = row.status === 'pending' || row.status === 'failed' || row.status === 'rejected';
  const [text, setText] = useState(JSON.stringify(row.payload, null, 2));
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => importApi.editRow(batch.id, row.id, payload),
    onSuccess: () => { setError(''); onChanged(); },
    onError: (e) => setError(errMsg(e, 'Could not save.')),
  });
  return (
    <div className="grid gap-4 bg-gray-50 p-4 lg:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Checks</div>
        {row.messages.length === 0 && row.validation === 'valid' && <p className="text-sm text-green-700">No problems found.</p>}
        <ul className="space-y-1 text-sm">
          {row.messages.map((m, i) => (
            <li key={i} className={cn('flex gap-2', row.validation === 'error' && !m.startsWith('Ignored') ? 'text-red-700' : 'text-amber-700')}><AlertTriangle size={14} className="mt-0.5 shrink-0" />{m}</li>
          ))}
        </ul>
        {row.outcomeMessage && <p className="mt-3 text-sm text-gray-600"><span className="font-medium">Result:</span> {row.outcomeMessage}</p>}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Data {editable && '(editable)'}</div>
        <textarea value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} rows={Math.min(14, text.split('\n').length + 1)} className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs" />
        {editable && (
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => { try { save.mutate(JSON.parse(text)); } catch { setError('That is not valid JSON.'); } }}
              className="rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-medium text-white disabled:bg-brand-300"
            >
              {save.isPending ? 'Saving…' : 'Save and re-check'}
            </button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── confirm + run import ──
function ImportDialog({ batch, rows, skippedErrors, onClose, onDone }: {
  batch: BatchDetail; rows: BatchRow[]; skippedErrors: number; onClose: () => void; onDone: (r: ImportRunResult) => void;
}) {
  const [sendReport, setSendReport] = useState(!!batch.partner);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const byType = TYPE_ORDER.map((t) => [t, rows.filter((r) => r.entityType === t).length] as const).filter(([, n]) => n);
  const updates = rows.filter((r) => r.plannedAction === 'update').length;

  const run = async () => {
    setError('');
    const ordered = [...rows].sort((a, b) => TYPE_ORDER.indexOf(a.entityType) - TYPE_ORDER.indexOf(b.entityType) || a.rowNo - b.rowNo);
    const total: ImportRunResult = { created: 0, updated: 0, failed: 0, blocked: 0, reportSent: false };
    try {
      for (let i = 0; i < ordered.length; i += CHUNK) {
        setProgress(i);
        const last = i + CHUNK >= ordered.length;
        const res = await importApi.importRows(batch.id, ordered.slice(i, i + CHUNK).map((r) => r.id), { sendReport: last && sendReport, note: last ? note || undefined : undefined });
        total.created += res.data.created; total.updated += res.data.updated; total.failed += res.data.failed; total.blocked += res.data.blocked;
        total.reportSent = total.reportSent || res.data.reportSent;
      }
      onDone(total);
    } catch (e) {
      setProgress(null);
      setError(errMsg(e, 'The import stopped. Rows already processed keep their result; you can retry the rest.'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-16 w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-3 text-lg font-semibold text-gray-900">Import {rows.length} selected row{rows.length === 1 ? '' : 's'}?</h3>
        <ul className="mb-3 space-y-1 text-sm text-gray-700">
          {byType.map(([t, n]) => <li key={t}>{n} {TYPE_LABEL[t].toLowerCase()}{n === 1 ? '' : 's'}</li>)}
          {updates > 0 && <li className="text-amber-700">{updates} will overwrite existing records.</li>}
          {skippedErrors > 0 && <li className="text-gray-500">{skippedErrors} selected row(s) with errors are left out.</li>}
        </ul>
        {batch.partner && (
          <label className="mb-3 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-800" checked={sendReport} onChange={(e) => setSendReport(e.target.checked)} />
            <span>Email a report to {batch.partner.contactName} ({batch.partner.contactEmail}) when done</span>
          </label>
        )}
        {sendReport && (
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Optional message to include in the report" className="mb-3 w-full rounded-lg border border-gray-300 p-2 text-sm" />
        )}
        {progress !== null && <p className="mb-3 flex items-center gap-2 text-sm text-gray-600"><Loader2 size={14} className="animate-spin" /> Importing… {Math.min(progress + CHUNK, rows.length)} of {rows.length}</p>}
        {error && <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={progress !== null} onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={progress !== null} onClick={() => void run()} className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white disabled:bg-brand-300">Import now</button>
        </div>
      </div>
    </div>
  );
}

// ── detail ──
function BatchView({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['import-batch', id], queryFn: () => importApi.batch(id) });
  const [typeTab, setTypeTab] = useState<'all' | EntityType>('all');
  const [view, setView] = useState<'todo' | 'errors' | 'done' | 'rejected' | 'all'>('todo');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [dialog, setDialog] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [rejectNote, setRejectNote] = useState<string | null>(null);

  const batch = q.data?.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['import-batch', id] });
    void qc.invalidateQueries({ queryKey: ['import-batches'] });
  };

  const rows = useMemo(() => {
    if (!batch) return [];
    const term = search.trim().toLowerCase();
    return batch.rows.filter((r) => {
      if (typeTab !== 'all' && r.entityType !== typeTab) return false;
      if (view === 'todo' && !(r.status === 'pending' || r.status === 'failed')) return false;
      if (view === 'errors' && !(r.validation === 'error' && (r.status === 'pending' || r.status === 'failed'))) return false;
      if (view === 'done' && !(r.status === 'created' || r.status === 'updated')) return false;
      if (view === 'rejected' && r.status !== 'rejected') return false;
      if (term && !`${r.label} ${r.messages.join(' ')}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [batch, typeTab, view, search]);

  const rejectRows = useMutation({
    mutationFn: ({ ids, note }: { ids: number[]; note?: string }) => importApi.rejectRows(id, ids, note),
    onSuccess: (_r, v) => { setSelected(new Set()); setBanner({ kind: 'ok', text: `${v.ids.length} row(s) rejected.` }); refresh(); },
    onError: (e) => setBanner({ kind: 'err', text: errMsg(e, 'Could not reject.') }),
  });
  const restoreRows = useMutation({
    mutationFn: (ids: number[]) => importApi.restoreRows(id, ids),
    onSuccess: () => { setSelected(new Set()); refresh(); },
    onError: (e) => setBanner({ kind: 'err', text: errMsg(e, 'Could not restore.') }),
  });
  const rejectAll = useMutation({
    mutationFn: (note: string) => importApi.rejectBatch(id, note, true),
    onSuccess: () => { setRejectNote(null); setBanner({ kind: 'ok', text: 'Submission rejected.' }); refresh(); },
    onError: (e) => setBanner({ kind: 'err', text: errMsg(e, 'Could not reject.') }),
  });
  const resend = useMutation({
    mutationFn: () => importApi.sendReport(id),
    onSuccess: (r) => { setBanner({ kind: r.data.sent ? 'ok' : 'err', text: r.data.message }); refresh(); },
    onError: (e) => setBanner({ kind: 'err', text: errMsg(e, 'Could not send the report.') }),
  });

  if (q.isLoading || !batch) return <p className="text-gray-400">Loading…</p>;

  const selectable = (r: BatchRow) => r.status === 'pending' || r.status === 'failed' || r.status === 'rejected';
  const selectedRows = batch.rows.filter((r) => selected.has(r.id));
  const importable = selectedRows.filter((r) => (r.status === 'pending' || r.status === 'failed') && r.validation !== 'error');
  const skippedErrors = selectedRows.filter((r) => (r.status === 'pending' || r.status === 'failed') && r.validation === 'error').length;
  const rejectable = selectedRows.filter((r) => r.status === 'pending' || r.status === 'failed');
  const restorable = selectedRows.filter((r) => r.status === 'rejected' || r.status === 'failed');

  const visibleSelectable = rows.filter(selectable);
  const allVisible = visibleSelectable.length > 0 && visibleSelectable.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allVisible ? new Set() : new Set(visibleSelectable.map((r) => r.id)));
  const toggle = (rid: number) => setSelected((s) => { const n = new Set(s); if (n.has(rid)) n.delete(rid); else n.add(rid); return n; });
  const selectReady = () => setSelected(new Set(rows.filter((r) => (r.status === 'pending' || r.status === 'failed') && r.validation !== 'error').map((r) => r.id)));

  const c = batch.counts;
  const typeCount = (t: EntityType) => batch.rows.filter((r) => r.entityType === t).length;

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-800"><ArrowLeft size={15} /> All submissions</button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">{batch.reference}</h2>
            <Pill kind={batch.status}>{STATUS_LABEL[batch.status]}</Pill>
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {batch.partner ? <>From <strong>{batch.partner.universityName}</strong> ({batch.partner.universityCode}) · {batch.partner.contactName} · <a className="text-brand-800 hover:underline" href={`mailto:${batch.partner.contactEmail}`}>{batch.partner.contactEmail}</a></> : 'Staged by staff'}
          </div>
          <div className="text-xs text-gray-400">Received {when(batch.submittedAt)}{batch.reviewedAt && ` · last reviewed ${when(batch.reviewedAt)}${batch.reviewedBy ? ` by ${batch.reviewedBy}` : ''}`}{batch.reportSentAt && ` · report emailed ${when(batch.reportSentAt)}`}</div>
          {batch.note && <p className="mt-2 max-w-2xl rounded-lg bg-gray-50 p-2 text-sm text-gray-600">“{batch.note}”</p>}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {batch.partner && (
            <button type="button" disabled={resend.isPending} onClick={() => resend.mutate()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50"><Mail size={14} /> {batch.reportSentAt ? 'Resend report' : 'Email report'}</button>
          )}
          {(c.pending ?? 0) > 0 && (
            <button type="button" onClick={() => setRejectNote('')} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-red-50 hover:text-red-700"><XCircle size={14} /> Reject remaining</button>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Rows', c.total ?? 0, 'text-gray-900'], ['Waiting', c.pending ?? 0, 'text-amber-600'], ['Added / updated', (c.created ?? 0) + (c.updated ?? 0), 'text-green-700'],
          ['Rejected', c.rejected ?? 0, 'text-gray-600'], ['Need a fix', (c.errors ?? 0) + (c.failed && !c.errors ? c.failed : 0), 'text-red-600'],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{label}</div><div className={cn('text-2xl font-bold', color as string)}>{value as number}</div></div>
        ))}
      </div>

      {banner && (
        <div className={cn('mb-4 flex items-start justify-between rounded-lg p-3 text-sm', banner.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700')}>
          <span>{banner.text}</span><button type="button" onClick={() => setBanner(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          <button type="button" onClick={() => setTypeTab('all')} className={cn('rounded-md px-3 py-1.5 font-medium', typeTab === 'all' ? 'bg-brand-800 text-white' : 'text-gray-600')}>All ({batch.rows.length})</button>
          {TYPE_ORDER.filter(typeCount).map((t) => (
            <button key={t} type="button" onClick={() => setTypeTab(t)} className={cn('rounded-md px-3 py-1.5 font-medium', typeTab === t ? 'bg-brand-800 text-white' : 'text-gray-600')}>{TYPE_LABEL[t]}s ({typeCount(t)})</button>
          ))}
        </div>
        <select value={view} onChange={(e) => setView(e.target.value as typeof view)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
          <option value="todo">To review</option><option value="errors">Have errors</option><option value="done">Imported</option><option value="rejected">Rejected</option><option value="all">Everything</option>
        </select>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows…" className="rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm" />
        </div>
        <button type="button" onClick={selectReady} className="text-sm font-medium text-brand-800 hover:underline">Select all ready ({rows.filter((r) => (r.status === 'pending' || r.status === 'failed') && r.validation !== 'error').length})</button>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-300 bg-brand-50 p-3 shadow">
          <span className="text-sm font-medium text-gray-800">{selected.size} selected</span>
          <button type="button" disabled={!importable.length} onClick={() => setDialog(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white disabled:bg-brand-300"><CheckCircle2 size={14} /> Import {importable.length}</button>
          <button type="button" disabled={!rejectable.length || rejectRows.isPending} onClick={() => rejectRows.mutate({ ids: rejectable.map((r) => r.id) })} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-40"><XCircle size={14} /> Reject {rejectable.length}</button>
          <button type="button" disabled={!restorable.length || restoreRows.isPending} onClick={() => restoreRows.mutate(restorable.map((r) => r.id))} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-40"><RotateCcw size={14} /> Restore {restorable.length}</button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-sm text-gray-500 hover:underline">Clear</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2.5"><input type="checkbox" checked={allVisible} onChange={toggleAll} aria-label="Select all shown" className="h-4 w-4 rounded border-gray-300 text-brand-800" /></th>
              <th className="px-2 py-2.5">#</th><th className="px-2 py-2.5">Type</th><th className="px-2 py-2.5">Item</th>
              <th className="px-2 py-2.5">Will</th><th className="px-2 py-2.5">Checks</th><th className="px-2 py-2.5">Status</th><th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <RowLine key={r.id} row={r} batch={batch} checked={selected.has(r.id)} selectable={selectable(r)} expanded={open === r.id}
                onToggle={() => toggle(r.id)} onExpand={() => setOpen(open === r.id ? null : r.id)} onChanged={refresh} />
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No rows in this view.</td></tr>}
          </tbody>
        </table>
      </div>

      {dialog && (
        <ImportDialog batch={batch} rows={importable} skippedErrors={skippedErrors} onClose={() => setDialog(false)}
          onDone={(r) => {
            setDialog(false); setSelected(new Set()); refresh();
            const parts = [`${r.created} added`, `${r.updated} updated`];
            if (r.failed + r.blocked) parts.push(`${r.failed + r.blocked} failed (see their rows)`);
            setBanner({ kind: r.failed + r.blocked ? 'err' : 'ok', text: `Import finished: ${parts.join(', ')}.${r.reportSent ? ' Report emailed.' : batch.partner ? ' No report email was sent.' : ''}` });
          }} />
      )}
      {rejectNote !== null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4">
          <div className="mt-24 w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-gray-900">Reject everything still waiting?</h3>
            <p className="mb-3 text-sm text-gray-500">{batch.partner ? 'This reason is emailed to the sender.' : 'Give a reason for the record.'}</p>
            <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={3} maxLength={1000} className="w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="e.g. Credits look wrong; please recheck and resend." />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setRejectNote(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancel</button>
              <button type="button" disabled={rejectNote.trim().length < 3 || rejectAll.isPending} onClick={() => rejectAll.mutate(rejectNote)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:bg-red-300">Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RowLine({ row, batch, checked, selectable, expanded, onToggle, onExpand, onChanged }: {
  row: BatchRow; batch: BatchDetail; checked: boolean; selectable: boolean; expanded: boolean;
  onToggle: () => void; onExpand: () => void; onChanged: () => void;
}) {
  return (
    <>
      <tr className={cn('hover:bg-gray-50', checked && 'bg-brand-50/50')}>
        <td className="px-3 py-2"><input type="checkbox" disabled={!selectable} checked={checked} onChange={onToggle} className="h-4 w-4 rounded border-gray-300 text-brand-800 disabled:opacity-30" aria-label={`Select row ${row.rowNo}`} /></td>
        <td className="px-2 py-2 text-gray-400">{row.rowNo}</td>
        <td className="px-2 py-2 text-gray-600">{TYPE_LABEL[row.entityType]}</td>
        <td className="max-w-[22rem] truncate px-2 py-2 font-medium text-gray-900" title={row.label}>{row.label}</td>
        <td className="px-2 py-2 text-gray-600">{row.validation === 'error' ? '—' : row.plannedAction === 'update' ? 'Update' : 'Add'}</td>
        <td className="px-2 py-2">
          {row.validation === 'valid' && <span className="text-green-600">✓ Clean</span>}
          {row.validation === 'warning' && <span className="text-amber-600" title={row.messages.join('\n')}>⚠ {row.messages.length} warning{row.messages.length === 1 ? '' : 's'}</span>}
          {row.validation === 'error' && <span className="text-red-600" title={row.messages.join('\n')}>✕ {row.messages.filter((m) => !m.startsWith('Ignored')).length} error(s)</span>}
        </td>
        <td className="px-2 py-2"><Pill kind={row.status}>{STATUS_LABEL[row.status]}</Pill></td>
        <td className="px-2 py-2"><button type="button" onClick={onExpand} className="text-gray-400 hover:text-gray-700" aria-label="Details">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td>
      </tr>
      {expanded && <tr><td colSpan={8} className="p-0"><RowDetail batch={batch} row={row} onChanged={onChanged} /></td></tr>}
    </>
  );
}

export default function SubmissionsPanel() {
  const [openId, setOpenId] = useState<number | null>(null);
  return openId === null ? <BatchList onOpen={setOpenId} /> : <BatchView id={openId} onBack={() => setOpenId(null)} />;
}

export type { BatchSummary };
