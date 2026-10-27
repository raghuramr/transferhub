import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Code2, Download, FileJson, FileSpreadsheet, History, Loader2, LogOut, Send, UploadCloud } from 'lucide-react';
import { cn } from '../../lib/cn';
import { LogoFull } from '../../components/shared/Logo';
import { partnerApi, type PartnerIdentity, type SubmissionBody, type SubmissionResult } from '../../lib/partnerApi';
import { countRows, downloadJsonExample, downloadTemplate, parseExcel, parseJsonFile, type ParsedFile } from '../../lib/importFile';

const KEY_STORE = 'th_partner_key';
const readKey = () => { try { return sessionStorage.getItem(KEY_STORE); } catch { return null; } };
const writeKey = (k: string | null) => { try { if (k) sessionStorage.setItem(KEY_STORE, k); else sessionStorage.removeItem(KEY_STORE); } catch { /* private mode */ } };
const when = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700', partial: 'bg-blue-50 text-blue-700', imported: 'bg-green-50 text-green-700', rejected: 'bg-gray-100 text-gray-600',
  created: 'bg-green-50 text-green-700', updated: 'bg-green-50 text-green-700', failed: 'bg-red-50 text-red-700',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for review', partial: 'Partly processed', imported: 'Processed', rejected: 'Not accepted', created: 'Added', updated: 'Updated', failed: 'Failed',
};
const Pill = ({ s }: { s: string }) => <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[s] ?? 'bg-gray-100 text-gray-600')}>{STATUS_LABEL[s] ?? s}</span>;

function SignIn({ onSignedIn }: { onSignedIn: (key: string, who: PartnerIdentity) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const who = await partnerApi.me(key.trim());
      onSignedIn(key.trim(), who);
    } catch (e) {
      setError((e as Error).message || 'That key was not accepted.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto mt-16 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-bold text-gray-900">Partner data portal</h1>
      <p className="mt-1 text-sm text-gray-500">Send your university's catalogue to TransferHub. Sign in with the API key your TransferHub contact gave you.</p>
      <label className="mt-6 block text-sm font-medium text-gray-700">API key
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key.trim() && void go()}
          placeholder="th_live_…" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </label>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={!key.trim() || busy} onClick={() => void go()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-300">
        {busy && <Loader2 size={15} className="animate-spin" />} Continue
      </button>
      <p className="mt-4 text-xs text-gray-400">Your key stays in this browser tab only and is cleared when you close it.</p>
    </div>
  );
}

function PreviewTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  if (!rows.length) return null;
  const cols = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))].filter((c) => c !== 'topics').slice(0, 7);
  return (
    <div className="mb-4">
      <div className="mb-1 text-sm font-semibold text-gray-800">{title} <span className="font-normal text-gray-400">({rows.length})</span></div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-gray-500"><tr>{cols.map((c) => <th key={c} className="px-3 py-1.5 font-medium">{c}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rows.slice(0, 8).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="max-w-[14rem] truncate px-3 py-1.5 text-gray-700">{String(r[c] ?? '')}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      {rows.length > 8 && <div className="mt-1 text-xs text-gray-400">…and {rows.length - 8} more</div>}
    </div>
  );
}

function SendTab({ apiKey, who, onSent }: { apiKey: string; who: PartnerIdentity; onSent: () => void }) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);

  const load = useCallback(async (file: File) => {
    setError(''); setResult(null); setParsed(null); setParsing(true); setFileName(file.name);
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) setParsed(await parseJsonFile(file));
      else if (lower.endsWith('.xlsx')) setParsed(await parseExcel(file, who.universityCode));
      else throw new Error('Please choose an Excel (.xlsx) or JSON (.json) file. For older .xls or .csv files, save as .xlsx first.');
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.');
    } finally {
      setParsing(false);
    }
  }, [who.universityCode]);

  const counts = parsed ? countRows(parsed.body) : null;
  const total = counts ? counts.universities + counts.programs + counts.courses + counts.students : 0;

  const send = async () => {
    if (!parsed) return;
    setBusy(true); setError('');
    try {
      const body: SubmissionBody = { ...parsed.body, note: note.trim() || parsed.body.note };
      setResult(await partnerApi.submit(apiKey, body));
      setParsed(null); setFileName(''); setNote('');
      onSent();
    } catch (e) {
      setError((e as Error).message || 'The submission was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold text-green-800"><CheckCircle2 size={20} /> Received - reference {result.reference}</div>
        <p className="mt-2 text-sm text-green-900">
          {result.received.universities} universities, {result.received.programs} programs, {result.received.courses} courses and {result.received.students ?? 0} student profiles are waiting for review.
          Automatic checks: {result.validation.valid} clean, {result.validation.warnings} with warnings, {result.validation.errors} with errors.
          {result.validation.errors > 0 && ' Rows with errors cannot be imported until they are fixed - the reviewer may edit them or ask you to resend.'}
        </p>
        <p className="mt-2 text-sm text-green-900">Nothing is added until a TransferHub administrator approves it. Approved student profiles are ready to claim: the student (or you, by marking rows with invite) opens a link and confirms the details before any account exists. You will get an email report when it has been processed; you can also follow it under "My submissions".</p>
        <button type="button" onClick={() => setResult(null)} className="mt-4 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800">Send another file</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-1 flex items-center gap-2 font-semibold text-gray-900"><FileSpreadsheet size={17} className="text-green-700" /> Excel</div>
          <p className="mb-3 text-sm text-gray-500">Fill in our workbook: sheets for Universities, Programs, Courses, Topics, Students and StudentCourses. Delete the example rows you do not need.</p>
          <button type="button" onClick={() => void downloadTemplate(who.universityCode)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><Download size={14} /> Download Excel template</button>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-1 flex items-center gap-2 font-semibold text-gray-900"><FileJson size={17} className="text-amber-600" /> JSON</div>
          <p className="mb-3 text-sm text-gray-500">Already export data from your own systems? Send a JSON file with <code className="rounded bg-gray-100 px-1">universities</code>, <code className="rounded bg-gray-100 px-1">programs</code> and/or <code className="rounded bg-gray-100 px-1">courses</code> and/or <code className="rounded bg-gray-100 px-1">students</code> (student profiles with courses and optional documents).</p>
          <button type="button" onClick={() => downloadJsonExample(who.universityCode)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><Download size={14} /> Download JSON example</button>
        </div>
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void load(f); }}
        className={cn('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition', drag ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-white hover:border-brand-400')}
      >
        {parsing ? <Loader2 className="animate-spin text-brand-700" size={28} /> : <UploadCloud className="text-gray-400" size={32} />}
        <span className="mt-2 text-sm font-medium text-gray-700">{fileName || 'Drop an Excel (.xlsx) or JSON file here, or click to choose'}</span>
        <span className="mt-1 text-xs text-gray-400">Up to 5,000 rows per file</span>
        <input type="file" accept=".xlsx,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
      </label>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {parsed && counts && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-1 font-semibold text-gray-900">Check before sending</h3>
          <p className="mb-4 text-sm text-gray-500">{counts.universities} universities, {counts.programs} programs, {counts.courses} courses, {counts.students} student profiles found in <strong>{fileName}</strong>.</p>
          {parsed.warnings.length > 0 && (
            <ul className="mb-4 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          <PreviewTable title="Universities" rows={parsed.body.universities ?? []} />
          <PreviewTable title="Programs" rows={parsed.body.programs ?? []} />
          <PreviewTable title="Courses" rows={parsed.body.courses ?? []} />
          <PreviewTable
            title="Student profiles"
            rows={(parsed.body.students ?? []).map((r) => ({
              externalId: r.externalId, firstName: r.firstName, lastName: r.lastName, email: r.email, programName: r.programName,
              courses: Array.isArray(r.courses) ? r.courses.length : 0, documents: Array.isArray(r.documents) ? r.documents.length : 0, invite: r.invite ? 'yes' : 'no',
            }))}
          />
          <label className="mt-2 block text-sm font-medium text-gray-700">Note for the reviewer (optional)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="e.g. Fall 2027 catalogue update" />
          </label>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-gray-400">This sends the data for review. Nothing is published yet.</span>
            <button type="button" disabled={busy || total === 0} onClick={() => void send()} className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-300">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send {total} row{total === 1 ? '' : 's'} for review
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MyTab({ apiKey }: { apiKey: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['partner-subs', apiKey], queryFn: () => partnerApi.list(apiKey), refetchInterval: 30_000 });
  const detail = useQuery({ queryKey: ['partner-sub', apiKey, open], queryFn: () => partnerApi.get(apiKey, open!), enabled: !!open });
  const subs = list.data?.submissions ?? [];
  return (
    <div className="space-y-3">
      {list.isLoading && <p className="text-gray-400">Loading…</p>}
      {!list.isLoading && subs.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">You have not sent anything yet.</p>}
      {subs.map((s) => (
        <div key={s.reference} className="rounded-xl border border-gray-200 bg-white">
          <button type="button" onClick={() => setOpen(open === s.reference ? null : s.reference)} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left">
            <div>
              <div className="font-semibold text-gray-900">{s.reference}</div>
              <div className="text-xs text-gray-400">sent {when(s.submittedAt)} · {s.counts.total ?? 0} rows</div>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {(s.counts.created ?? 0) + (s.counts.updated ?? 0) > 0 && <span>{(s.counts.created ?? 0) + (s.counts.updated ?? 0)} added/updated</span>}
              {(s.counts.rejected ?? 0) > 0 && <span>{s.counts.rejected} not accepted</span>}
              <Pill s={s.status} />
            </div>
          </button>
          {open === s.reference && (
            <div className="border-t border-gray-100 p-4">
              {detail.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
              {detail.data?.message && <p className="mb-3 rounded-lg bg-gray-50 p-2 text-sm text-gray-600">Reviewer: {detail.data.message}</p>}
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-400"><tr><th className="py-1 pr-3">#</th><th className="pr-3">Type</th><th className="pr-3">Item</th><th className="pr-3">Result</th><th>Details</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail.data?.rows.map((r) => (
                      <tr key={r.rowNo}><td className="py-1.5 pr-3 text-gray-400">{r.rowNo}</td><td className="pr-3">{r.type === 'students' ? 'student profile' : r.type}</td><td className="max-w-[16rem] truncate pr-3 text-gray-800">{r.item}</td><td className="pr-3"><Pill s={r.status} /></td><td className="text-gray-500">{r.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ApiTab({ who }: { who: PartnerIdentity }) {
  const fmt = useQuery({ queryKey: ['partner-format'], queryFn: () => partnerApi.format() });
  const base = `${window.location.origin}/api/public/v1`;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-gray-900"><Code2 size={17} /> Send data from your own systems</h3>
        <p className="mb-3 text-sm text-gray-600">POST JSON to the endpoint with your API key in the <code className="rounded bg-gray-100 px-1">X-API-Key</code> header. Everything lands in the same review queue as file uploads.</p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`curl -X POST ${base}/submissions \\
  -H "X-API-Key: <your key>" \\
  -H "Content-Type: application/json" \\
  -d '{"note":"Catalogue update","courses":[{"universityCode":"${who.universityCode}","code":"CS101","name":"Intro to Computing","credits":3}]}'`}</pre>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>Check a submission: <code className="rounded bg-gray-100 px-1">GET {base}/submissions/&lt;reference&gt;</code></li>
          <li>You can only send data for your own university code (<strong>{who.universityCode}</strong>); it is filled in if you leave it out.</li>
          <li>Up to 5,000 rows per submission and 60 requests per minute.</li>
          <li><strong>Student profiles</strong> (<code className="rounded bg-gray-100 px-1">students</code>): send each student once with their ID, email and courses. Once approved the profile is ready to claim; set <code className="rounded bg-gray-100 px-1">"invite": true</code> to email the student a link to confirm it. No account is created until the student confirms. Documents are optional base64 PDF/PNG/JPG files up to 2 MB each, so keep submissions with documents small (6 MB request limit).</li>
        </ul>
      </div>
      {fmt.data && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 font-semibold text-gray-900">Field reference</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {Object.entries(fmt.data.schemas).map(([name, s]) => (
              <div key={name}>
                <div className="text-sm font-semibold capitalize text-gray-800">{name}</div>
                <p className="mb-1 text-xs text-gray-500">{s.description}</p>
                <div className="text-xs"><span className="font-medium text-gray-700">Required:</span> {s.requiredFields.join(', ')}</div>
                <div className="text-xs"><span className="font-medium text-gray-700">Optional:</span> {s.optionalFields.join(', ')}</div>
              </div>
            ))}
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-gray-500">{fmt.data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export default function PartnerPortal() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [who, setWho] = useState<PartnerIdentity | null>(null);
  const [tab, setTab] = useState<'send' | 'mine' | 'api'>('send');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = readKey();
    if (!saved) { setChecking(false); return; }
    partnerApi.me(saved).then((w) => { setApiKey(saved); setWho(w); }).catch(() => writeKey(null)).finally(() => setChecking(false));
  }, []);

  const signOut = () => { writeKey(null); setApiKey(null); setWho(null); };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-gray-900"><LogoFull height={56} /> <span className="font-normal text-gray-400">Partner portal</span></div>
          {who && (
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span className="hidden sm:inline">{who.universityName} ({who.universityCode})</span>
              <button type="button" onClick={signOut} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800"><LogOut size={14} /> Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {checking ? <p className="mt-16 text-center text-gray-400">Loading…</p> : !apiKey || !who ? (
          <SignIn onSignedIn={(k, w) => { writeKey(k); setApiKey(k); setWho(w); }} />
        ) : (
          <>
            <div className="mb-6 inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
              {([['send', 'Send data', <UploadCloud key="a" size={14} />], ['mine', 'My submissions', <History key="b" size={14} />], ['api', 'API & guide', <Code2 key="c" size={14} />]] as const).map(([k, label, icon]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={cn('inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 font-medium', tab === k ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-50')}>{icon} {label}</button>
              ))}
            </div>
            {tab === 'send' && <SendTab apiKey={apiKey} who={who} onSent={() => setTab('send')} />}
            {tab === 'mine' && <MyTab apiKey={apiKey} />}
            {tab === 'api' && <ApiTab who={who} />}
          </>
        )}
      </main>
    </div>
  );
}
