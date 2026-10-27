import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, Check, FilePlus2, FileQuestion, Loader2, Paperclip, Send, Upload, X } from 'lucide-react';
import { transfersApi } from '../../lib/transfersApi';
import { downloadUpload } from '../workflow/RequestPanels';
import { formatDateTime } from '../workflow/RequestTimeline';
import { cn } from '../../lib/cn';
import type { DocumentRequestRow, ExchangeData, Party } from '../../types/transfers';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};

const PARTY_STYLE: Record<Party, string> = {
  student: 'bg-sky-50 text-sky-800 border-sky-200',
  source_university: 'bg-amber-50 text-amber-800 border-amber-200',
  target_university: 'bg-brand-50 text-brand-800 border-brand-200',
};
const PARTY_SHORT: Record<Party, string> = { student: 'Student', source_university: 'From University 1', target_university: 'From University 2' };

export function partyLabel(p: Party, d: ExchangeData): string {
  if (p === 'student') return 'Student';
  return p === 'source_university' ? `${d.transfer.source.name ?? 'University 1'} (sending)` : `${d.transfer.target.name ?? 'University 2'} (receiving)`;
}

export function PartyBadge({ party, text }: { party: Party; text?: string }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', PARTY_STYLE[party])}>{text ?? PARTY_SHORT[party]}</span>;
}

const STATUS_STYLE: Record<DocumentRequestRow['status'], string> = {
  open: 'bg-amber-100 text-amber-800',
  fulfilled: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600',
  declined: 'bg-red-100 text-red-700',
};

export function useExchange(transcriptId: string, enabled = true) {
  return useQuery({
    queryKey: ['exchange', transcriptId],
    queryFn: async () => (await transfersApi.detail(transcriptId)).data,
    refetchInterval: 30_000,
    retry: false,
    enabled,
  });
}

const fmtSize = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** A prominent strip listing what is being asked of the viewer; renders nothing when nothing is open. */
export function OpenRequestsBanner({ transcriptId, anchor = '#exchange' }: { transcriptId: string; anchor?: string }) {
  const { data } = useExchange(transcriptId);
  const mine = data?.requests.filter((r) => r.status === 'open' && r.canFulfil) ?? [];
  if (!data || !mine.length) return null;
  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4" role="status">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <FileQuestion size={16} /> {mine.length === 1 ? 'A document is needed from you' : `${mine.length} documents are needed from you`}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-amber-900">
        {mine.map((r) => (
          <li key={r.id}>
            <span className="font-medium">{r.title}</span> <span className="text-amber-800/80">- asked by {r.byName}{r.dueDate ? `, by ${fmtDate(r.dueDate)}` : ''}{r.overdue ? ' (overdue)' : ''}</span>
          </li>
        ))}
      </ul>
      <a href={anchor} className="mt-2 inline-block text-sm font-medium text-amber-900 underline">Respond below</a>
    </div>
  );
}

function RequestCard({ r, d, onData }: { r: DocumentRequestRow; d: ExchangeData; onData: (x: ExchangeData) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [remindMsg, setRemindMsg] = useState('');
  const [remindOpen, setRemindOpen] = useState(false);
  const id = d.transfer.id;

  const run = async (key: string, fn: () => Promise<ExchangeData>) => {
    setBusy(key);
    setError('');
    try {
      onData(await fn());
      setRemindOpen(false);
      setNote('');
      setRemindMsg('');
    } catch (e) {
      setError(errMsg(e, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className={cn('rounded-lg border p-3 text-sm', r.status === 'open' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{r.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            <PartyBadge party={r.byParty} text={r.byName} /> <span aria-hidden>→</span> <PartyBadge party={r.fromParty} text={r.fromName} />
            {r.docTypeLabel && <span>· {r.docTypeLabel}</span>}
          </p>
        </div>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', STATUS_STYLE[r.status])}>{r.status}</span>
      </div>
      {r.message && <p className="mt-2 rounded-md bg-white/70 px-2.5 py-1.5 text-gray-700">{r.message}</p>}
      <p className="mt-1.5 text-xs text-gray-500">
        Asked {formatDateTime(r.createdAt)}{r.byUser ? ` by ${r.byUser}` : ''}
        {r.dueDate && <span className={cn(r.overdue && 'font-medium text-red-600')}> · due {fmtDate(r.dueDate)}{r.overdue ? ' (overdue)' : ''}</span>}
        {r.fulfilledAt && <> · sent {formatDateTime(r.fulfilledAt)}</>}
      </p>
      {r.resolutionNote && <p className="mt-1 text-xs italic text-gray-600">“{r.resolutionNote}”</p>}
      {r.status === 'fulfilled' && r.fulfilledUploadId && (
        <button type="button" onClick={() => void downloadUpload(r.fulfilledUploadId!, `${r.title}`)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline">
          <Paperclip size={12} /> Download the file
        </button>
      )}

      {r.status === 'open' && (r.canFulfil || r.canCancel || r.canDecline || r.canRemind || r.remindBlockedUntil) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-amber-100 pt-2">
          {r.canFulfil && (
            <>
              <input ref={fileRef} type="file" className="hidden" aria-label={`File for ${r.title}`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void run('fulfil', async () => (await transfersApi.fulfil(id, r.id, f)).data.exchange);
                }} />
              <button type="button" disabled={busy !== null} onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-900 disabled:opacity-50">
                {busy === 'fulfil' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload the document
              </button>
            </>
          )}
          {r.canRemind && (
            <button type="button" disabled={busy !== null} onClick={() => setRemindOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              <Bell size={13} /> Send reminder
            </button>
          )}
          {!r.canRemind && r.remindBlockedUntil && <span className="text-xs text-gray-500">Reminder sent. Next possible {formatDateTime(r.remindBlockedUntil)}.</span>}
          {r.canDecline && (
            <button type="button" disabled={busy !== null} onClick={() => void run('decline', async () => (await transfersApi.declineRequest(id, r.id, note || undefined)).data)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">Decline</button>
          )}
          {r.canCancel && (
            <button type="button" disabled={busy !== null} onClick={() => void run('cancel', async () => (await transfersApi.cancelRequest(id, r.id, note || undefined)).data)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">Cancel request</button>
          )}
        </div>
      )}
      {r.status === 'open' && (r.canDecline || r.canCancel) && (
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional note when declining / cancelling"
          className="mt-2 w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400" />
      )}
      {remindOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={remindMsg} onChange={(e) => setRemindMsg(e.target.value)} maxLength={500} placeholder="Add a message (optional)"
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400" />
          <button type="button" disabled={busy !== null}
            onClick={() => void run('remind', async () => (await transfersApi.remind(id, { toParty: r.fromParty, party: r.byParty, documentRequestId: r.id, message: remindMsg || undefined })).data.exchange)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-900 disabled:opacity-50">
            {busy === 'remind' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
          </button>
        </div>
      )}
      {error && <p className="mt-2 flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={12} /> {error}</p>}
    </li>
  );
}

function ActingAs({ d, value, onChange }: { d: ExchangeData; value: Party; onChange: (p: Party) => void }) {
  if (d.viewer.parties.length < 2) return null;
  return (
    <label className="block text-xs font-medium text-gray-500">
      Acting for
      <select value={value} onChange={(e) => onChange(e.target.value as Party)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800">
        {d.viewer.parties.map((p) => <option key={p} value={p}>{partyLabel(p, d)}</option>)}
      </select>
    </label>
  );
}

const others = (p: Party): Party[] => (['student', 'source_university', 'target_university'] as Party[]).filter((x) => x !== p);

function AskForm({ d, onData }: { d: ExchangeData; onData: (x: ExchangeData) => void }) {
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState<Party>(d.viewer.defaultParty ?? 'target_university');
  const [from, setFrom] = useState<Party>(others(d.viewer.defaultParty ?? 'target_university')[0]);
  const [docType, setDocType] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = others(party);
  const effectiveFrom = choices.includes(from) ? from : choices[0];

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      onData((await transfersApi.createRequest(d.transfer.id, {
        fromParty: effectiveFrom, party, docTypeKey: docType || undefined, title: title.trim() || undefined, message: message.trim() || undefined, dueDate: due || undefined,
      })).data);
      setOpen(false); setTitle(''); setMessage(''); setDue(''); setDocType('');
    } catch (e) {
      setError(errMsg(e, 'Could not send the request.'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50">
        <FilePlus2 size={15} /> Ask for a document
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ActingAs d={d} value={party} onChange={setParty} />
        <label className="block text-xs font-medium text-gray-500">
          Ask
          <select value={effectiveFrom} onChange={(e) => setFrom(e.target.value as Party)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800">
            {choices.map((p) => <option key={p} value={p}>{partyLabel(p, d)}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-500">
          Document type
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800">
            <option value="">Something else (describe below)</option>
            {d.documentTypes.map((t) => <option key={t.docTypeKey} value={t.docTypeKey}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-500">
          What exactly {docType ? '(optional)' : ''}
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Final transcript with Spring grades"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400" />
        </label>
        <label className="block text-xs font-medium text-gray-500 sm:col-span-2">
          Message (optional)
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={2}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400" />
        </label>
        <label className="block text-xs font-medium text-gray-500">
          Needed by (optional)
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || (!docType && !title.trim())} onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send request
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Close</button>
        <span className="text-xs text-gray-500">They are notified by e-mail.</span>
      </div>
      {error && <p className="mt-2 flex items-center gap-1 text-sm text-red-600"><AlertTriangle size={14} /> {error}</p>}
    </div>
  );
}

function AddFile({ d, onData }: { d: ExchangeData; onData: (x: ExchangeData) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [party, setParty] = useState<Party>(d.viewer.defaultParty ?? 'student');
  const [docType, setDocType] = useState('other');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async (f: File) => {
    setBusy(true);
    setError('');
    try {
      onData((await transfersApi.upload(d.transfer.id, f, { party, documentType: docType, note: note.trim() || undefined })).data.exchange);
      setNote('');
    } catch (e) {
      setError(errMsg(e, 'Upload failed.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActingAs d={d} value={party} onChange={setParty} />
        <label className="block text-xs font-medium text-gray-500">
          Document type
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800">
            {d.documentTypes.map((t) => <option key={t.docTypeKey} value={t.docTypeKey}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-500">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400" />
        </label>
      </div>
      <input ref={ref} type="file" className="hidden" aria-label="Choose a file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void go(f); }} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Add a file to this transfer
      </button>
      {error && <p className="mt-2 flex items-center gap-1 text-sm text-red-600"><AlertTriangle size={14} /> {error}</p>}
    </div>
  );
}

function RemindForm({ d, onData }: { d: ExchangeData; onData: (x: ExchangeData) => void }) {
  const [party, setParty] = useState<Party>(d.viewer.defaultParty ?? 'student');
  const choices = others(party);
  const [to, setTo] = useState<Party>(choices[0]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const toEff = choices.includes(to) ? to : choices[0];
  const blockedUntil = d.blocked[`${party}>${toEff}:`];
  const send = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      const r = (await transfersApi.remind(d.transfer.id, { toParty: toEff, party, message: message.trim() || undefined })).data;
      onData(r.exchange);
      setMessage('');
      setDone(r.emailConfigured ? 'Reminder sent.' : 'Reminder recorded (e-mail is not configured on this server).');
    } catch (e) {
      setError(errMsg(e, 'Could not send the reminder.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ActingAs d={d} value={party} onChange={setParty} />
        <label className="block text-xs font-medium text-gray-500">
          Remind
          <select value={toEff} onChange={(e) => setTo(e.target.value as Party)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800">
            {choices.map((p) => <option key={p} value={p}>{partyLabel(p, d)}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-500 sm:col-span-2">
          Message (optional)
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="e.g. We still need the final transcript before registration."
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !!blockedUntil} onClick={() => void send()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />} Send reminder
        </button>
        {blockedUntil && <span className="text-xs text-gray-500">Already reminded. Next possible {formatDateTime(blockedUntil)}.</span>}
        {done && <span className="flex items-center gap-1 text-sm text-emerald-700"><Check size={14} /> {done}</span>}
      </div>
      {error && <p className="mt-2 flex items-center gap-1 text-sm text-red-600"><AlertTriangle size={14} /> {error}</p>}
    </div>
  );
}

/**
 * Everything the three parties exchange on one transfer: document requests, files (kept in the
 * student's folder, tagged with who uploaded them) and reminders. Used on the Transfers detail page,
 * the staff request review page and the student's status page.
 */
export default function ExchangePanel({ transcriptId, className }: { transcriptId: string; className?: string }) {
  const qc = useQueryClient();
  const { data: d, isLoading } = useExchange(transcriptId);
  const setData = (x: ExchangeData) => qc.setQueryData(['exchange', transcriptId], x);

  if (isLoading) return <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-400">Loading exchange…</div>;
  if (!d) return null;
  if (!d.ready) {
    if (d.viewer.isStudentSide) return null;
    return <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500">Document requests between universities become available once the latest database update (migration 022) is applied.</div>;
  }
  const canAct = d.viewer.parties.length > 0;
  const open = d.requests.filter((r) => r.status === 'open');
  const closed = d.requests.filter((r) => r.status !== 'open');

  return (
    <section id="exchange" className={cn('space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5', className)}>
      <header>
        <h2 className="text-base font-semibold text-gray-900">{d.viewer.isStudentSide ? 'Documents and reminders' : 'Collaboration between the parties'}</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          {d.viewer.isStudentSide
            ? 'Your documents, and anything a university has asked you for.'
            : `${d.transfer.source.name ?? 'University 1'} → ${d.transfer.target.name ?? 'University 2'}. Both universities and the student see the files below.`}
        </p>
      </header>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
          Document requests {open.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{open.length} open</span>}
        </h3>
        {d.requests.length === 0 ? <p className="text-sm text-gray-500">No documents have been requested on this transfer.</p> : (
          <ul className="space-y-2">
            {[...open, ...closed].map((r) => <RequestCard key={r.id} r={r} d={d} onData={setData} />)}
          </ul>
        )}
        {canAct && <div className="mt-3"><AskForm d={d} onData={setData} /></div>}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-800">Files on this transfer</h3>
        {d.uploads.length === 0 ? <p className="mb-3 text-sm text-gray-500">No files have been added through the exchange yet.</p> : (
          <ul className="mb-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {d.uploads.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                {u.party && <PartyBadge party={u.party} text={u.party === 'student' ? 'Student' : `${PARTY_SHORT[u.party]}${u.institutionName ? ` · ${u.institutionName}` : ''}`} />}
                <button type="button" onClick={() => void downloadUpload(u.id, u.fileName)} className="inline-flex min-w-0 items-center gap-1 font-medium text-brand-800 hover:underline">
                  <Paperclip size={13} className="shrink-0" /> <span className="truncate">{u.fileName}</span>
                </button>
                <span className="text-xs text-gray-500">{u.documentTypeLabel ?? u.documentType} · {fmtSize(u.sizeBytes)} · {formatDateTime(u.createdAt)}{u.uploaderName ? ` · ${u.uploaderName}` : ''}</span>
                {u.note && <span className="w-full text-xs italic text-gray-600">“{u.note}”</span>}
              </li>
            ))}
          </ul>
        )}
        {canAct && <AddFile d={d} onData={setData} />}
      </div>

      {canAct && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Send a reminder</h3>
          <RemindForm d={d} onData={setData} />
        </div>
      )}
      {d.reminders.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Reminders sent</h3>
          <ul className="space-y-1.5 text-sm">
            {d.reminders.map((r) => (
              <li key={r.id} className="rounded-md bg-gray-50 px-3 py-2 text-gray-700">
                <span className="font-medium">{r.fromName}</span> reminded <span className="font-medium">{r.toName}</span>
                {r.documentRequestId ? ` about "${d.requests.find((x) => x.id === r.documentRequestId)?.title ?? 'a document request'}"` : ''}
                <span className="text-xs text-gray-500"> · {formatDateTime(r.createdAt)}{r.sentBy ? ` · ${r.sentBy}` : ''}{!r.emailed ? ' · e-mail not delivered' : ''}</span>
                {r.message && <p className="text-xs italic text-gray-600">“{r.message}”</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.viewer.readOnly && <p className="flex items-center gap-1.5 text-xs text-gray-500"><X size={12} /> You can see this transfer as the sending university. Approving it is up to the receiving university.</p>}
    </section>
  );
}
