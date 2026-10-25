import { useState } from 'react';
import { Bell, CheckCircle2, Circle, FileDown, Loader2, Lock, Paperclip, Send, Trash2, Eye } from 'lucide-react';
import { api, requestsApi, uploadsApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { RequestTimeline } from '../../types/workflow';
import { formatDateTime } from './RequestTimeline';

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
    ? [(e as { response: { data: { message: string | string[] } } }).response.data.message].flat().join(' ')
    : fallback;

export async function downloadUpload(uploadId: string, fileName: string) {
  const res = await api.get(`/uploads/${uploadId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Notes ─────────────────────────────────────────────────────

export function NoteComposer({ requestId, timeline, onUpdated }: { requestId: string; timeline: RequestTimeline; onUpdated: (t: RequestTimeline) => void }) {
  const p = timeline.permissions;
  const canInternal = p.canNoteInternal;
  const [audience, setAudience] = useState<'internal' | 'student'>(canInternal ? 'internal' : 'student');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const post = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await requestsApi.addNote(requestId, { audience, body: body.trim() });
      onUpdated(res.data);
      setBody('');
    } catch (e) {
      setError(errMsg(e, 'Could not save the note.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-800">{p.isStaff ? 'Add a note' : 'Message the reviewers'}</h3>
      {p.isStaff && (
        <div className="mb-2 inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
          {canInternal && (
            <button
              type="button"
              onClick={() => setAudience('internal')}
              className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium', audience === 'internal' ? 'bg-amber-100 text-amber-800' : 'text-gray-500')}
            >
              <Lock size={12} /> Internal (this stage's team)
            </button>
          )}
          <button
            type="button"
            onClick={() => setAudience('student')}
            className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium', audience === 'student' ? 'bg-sky-100 text-sky-800' : 'text-gray-500')}
          >
            <Eye size={12} /> Visible to student
          </button>
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder={audience === 'internal' ? 'Only approvers of this stage and admins will see this…' : p.isStaff ? 'The student will see this…' : 'Ask a question or add context for the reviewers…'}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={post}
          disabled={busy || !body.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-300"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Post
        </button>
      </div>
    </div>
  );
}

// ── Documents ─────────────────────────────────────────────────

export function DocumentsPanel({
  requestId,
  timeline,
  courses,
  onUpdated,
}: {
  requestId: string;
  timeline: RequestTimeline;
  courses?: { id: string; label: string }[];
  onUpdated: (t: RequestTimeline) => void;
}) {
  const { checklist, uploaded } = timeline.documents;
  const [docType, setDocType] = useState(checklist.find((c) => c.uploaded === 0 && c.required)?.docTypeKey ?? checklist[0]?.docTypeKey ?? 'other');
  const [courseId, setCourseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = checklist.find((c) => c.docTypeKey === docType);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const up = await uploadsApi.upload(file, { entityType: 'transcript_document', entityId: requestId });
      const res = await requestsApi.addDocument(requestId, {
        docTypeKey: docType,
        uploadId: (up.data as { id: string }).id,
        transcriptCourseId: selected?.perCourse && courseId ? courseId : undefined,
      });
      onUpdated(res.data);
    } catch (err) {
      setError(errMsg(err, 'Upload failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (docId: number) => {
    try {
      onUpdated((await requestsApi.removeDocument(requestId, docId)).data);
    } catch (err) {
      setError(errMsg(err, 'Could not remove that document.'));
    }
  };

  if (!timeline.transcript.workflow) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-800">Documents</h3>
      <ul className="mb-3 space-y-1.5">
        {checklist.map((c) => (
          <li key={c.docTypeKey} className="flex items-center gap-2 text-sm">
            {c.uploaded > 0 ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Circle size={15} className={c.required ? 'text-red-400' : 'text-gray-300'} />}
            <span className={c.uploaded > 0 ? 'text-gray-700' : 'text-gray-600'}>{c.label}</span>
            {c.required && c.uploaded === 0 && <span className="rounded-full bg-red-50 px-1.5 text-xs text-red-600">required</span>}
            {c.uploaded > 0 && <span className="text-xs text-gray-400">{c.uploaded} added</span>}
          </li>
        ))}
      </ul>

      {uploaded.length > 0 && (
        <ul className="mb-3 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {uploaded.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <button type="button" onClick={() => downloadUpload(d.uploadId, d.fileName)} className="flex min-w-0 items-center gap-1.5 text-left text-brand-800 hover:underline">
                <FileDown size={14} className="shrink-0" />
                <span className="truncate">{d.fileName}</span>
              </button>
              <span className="shrink-0 text-xs text-gray-400">
                {d.label}{d.courseCode ? ` · ${d.courseCode}` : ''}
              </span>
              <button type="button" onClick={() => remove(d.id)} className="shrink-0 text-gray-400 hover:text-red-500" aria-label="Remove">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm">
          {checklist.map((c) => <option key={c.docTypeKey} value={c.docTypeKey}>{c.label}</option>)}
        </select>
        {selected?.perCourse && courses && courses.length > 0 && (
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm">
            <option value="">All courses</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
          {busy ? 'Uploading…' : 'Add file'}
          <input type="file" className="hidden" onChange={onFile} disabled={busy} accept=".pdf,image/*,.doc,.docx" />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ── Reminder ──────────────────────────────────────────────────

export function ReminderPanel({ requestId, timeline, onSent }: { requestId: string; timeline: RequestTimeline; onSent: () => void }) {
  const r = timeline.reminders;
  const staff = timeline.permissions.isStaff;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const available = staff ? r.canSendUpdate : r.canNudge;
  const last = staff ? r.lastUpdateAt : r.lastNudgeAt;

  if (timeline.transcript.workflowStatus !== 'active') return null;
  if (staff && !r.canSendUpdate && !r.lastUpdateAt) return null;

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await requestsApi.remind(requestId, message.trim() || undefined);
      setResult({
        ok: true,
        text: res.data.emailConfigured
          ? staff ? 'Status update emailed to the student.' : `Reminder sent to ${res.data.sent} reviewer(s).`
          : 'Logged, but email is not configured on this server so nothing was sent.',
      });
      setMessage('');
      onSent();
    } catch (e) {
      setResult({ ok: false, text: errMsg(e, 'Could not send the reminder.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <Bell size={14} /> {staff ? 'Email the student a status update' : 'Ask for an update'}
      </h3>
      <p className="mb-2 text-xs text-gray-500">
        {staff ? 'Sends the current stage and your latest student-facing comment.' : 'Sends a reminder email to whoever is reviewing your request right now.'}
        {last && <> Last sent {formatDateTime(last)}.</>}
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        maxLength={500}
        disabled={!available}
        placeholder="Optional message…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={cn('text-xs', result?.ok ? 'text-emerald-600' : 'text-red-600')}>{result?.text}</span>
        <button
          type="button"
          onClick={send}
          disabled={!available || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-gray-300"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
          {available ? 'Send' : staff ? 'Sent recently' : 'Already asked today'}
        </button>
      </div>
    </div>
  );
}
