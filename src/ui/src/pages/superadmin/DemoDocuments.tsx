import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileText, HardDrive, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

interface Student { id: string; name: string; email: string; studentId: string | null; requests: number; courses: number; fromCollege: string | null; targetUniversity: string | null }
interface Kind { kind: string; label: string }
interface StorageStatus { provider: string; connected: boolean; privateContainer: string; publicContainer: string; publicReadable: boolean; publicUrlExample: string | null; assetBaseUrl: string | null; problem: string | null }

const errText = (e: unknown) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m ?? 'The request failed.';
};

/** The blob error body comes back as a Blob; read the message out of it. */
async function blobError(e: unknown): Promise<string> {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try { const j = JSON.parse(await data.text()); return Array.isArray(j.message) ? j.message.join(', ') : j.message ?? 'The request failed.'; } catch { /* fall through */ }
  }
  return errText(e);
}

export default function DemoDocuments() {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Set<string>>(new Set(['transcript', 'id_document', 'english_test', 'syllabus']));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const students = useQuery<Student[]>({ queryKey: ['demo-docs', 'students', q], queryFn: async () => (await api.get('/demo/documents/students', { params: { q } })).data });
  const kindList = useQuery<Kind[]>({ queryKey: ['demo-docs', 'kinds'], queryFn: async () => (await api.get('/demo/documents/kinds')).data });
  const storage = useQuery<StorageStatus>({ queryKey: ['demo-docs', 'storage'], queryFn: async () => (await api.get('/demo/storage-status')).data });

  const list = students.data ?? [];
  const allShown = useMemo(() => list.length > 0 && list.every((s) => selected.has(s.id)), [list, selected]);
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };

  const generate = useMutation({
    mutationFn: async () => {
      const r = await api.post('/demo/documents/generate', { studentIds: [...selected], kinds: [...kinds] }, { responseType: 'blob' });
      const cd = String(r.headers['content-disposition'] ?? '');
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
      let name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? 'Demo documents.zip';
      if (star) { try { name = decodeURIComponent(star); } catch { /* keep ascii name */ } }
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return name;
    },
    onSuccess: (name) => setMsg({ kind: 'ok', text: `Downloaded ${name}. Upload the PDFs under Student > Documents (Smart upload) to test reading.` }),
    onError: async (e) => setMsg({ kind: 'err', text: await blobError(e) }),
  });

  const st = storage.data;
  return (
    <div className="w-[95%] max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileText size={24} className="text-brand-800" /> Demo documents</h1>
          <Badge tone="purple">Presenter tool</Badge>
        </div>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          Pick students and document types, then download sample PDFs built from each student&apos;s own records: transcripts for the colleges they submitted
          (their real courses, credits and grades), ID or passport, English test for international students, one syllabus per course (using the catalogue
          description and topics when the course is known), and an enrolment letter. The files are synthetic and have a text layer, so Smart Upload can read them.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-4 space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[12rem]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or student ID" className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
            </div>
            <Button variant="outline" onClick={() => setSelected((s) => { const n = new Set(s); list.forEach((x) => (allShown ? n.delete(x.id) : n.add(x.id))); return n; })}>{allShown ? 'Clear shown' : 'Select shown'}</Button>
            {selected.size ? <Button variant="outline" onClick={() => setSelected(new Set())}>Clear all ({selected.size})</Button> : null}
          </div>
          <div className="max-h-[28rem] overflow-y-auto divide-y border rounded-lg">
            {students.isLoading ? <div className="p-4 text-sm text-gray-500">Loading...</div> : null}
            {students.error ? <div className="p-4 text-sm text-red-700">Could not load students. {errText(students.error)}</div> : null}
            {!students.isLoading && !list.length ? <div className="p-4 text-sm text-gray-500">No students match.</div> : null}
            {list.map((s) => (
              <label key={s.id} className="flex items-start gap-3 p-3 text-sm cursor-pointer hover:bg-gray-50">
                <input type="checkbox" className="mt-1" checked={selected.has(s.id)} onChange={() => setSelected((x) => toggle(x, s.id))} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900">{s.name} <span className="text-xs font-normal text-gray-500">{s.email}</span></div>
                  <div className="text-xs text-gray-500">
                    {s.courses ? `${s.courses} course${s.courses === 1 ? '' : 's'} from ${s.fromCollege ?? 'a previous college'}` : 'No submitted courses (ID / letter only)'}
                    {s.targetUniversity ? ` · target ${s.targetUniversity}` : ''}
                  </div>
                </div>
                {s.courses ? <Badge tone="green">{s.requests} request{s.requests === 1 ? '' : 's'}</Badge> : <Badge tone="gray">no coursework</Badge>}
              </label>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <h2 className="font-semibold text-gray-900 text-sm">Documents to generate</h2>
            {(kindList.data ?? []).map((k) => (
              <label key={k.kind} className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-1" checked={kinds.has(k.kind)} onChange={() => setKinds((x) => toggle(x, k.kind))} />
                <span>{k.label}</span>
              </label>
            ))}
            <Button icon={<Download size={16} />} disabled={generate.isPending || !selected.size || !kinds.size} onClick={() => { setMsg(null); generate.mutate(); }}>
              {generate.isPending ? 'Generating...' : `Download for ${selected.size || 'no'} student${selected.size === 1 ? '' : 's'}`}
            </Button>
            <p className="text-xs text-gray-500">One document downloads as a PDF; several download as a ZIP (one folder per student, plus a README of what was made or skipped). Up to 25 students at a time.</p>
            {msg ? (
              <div className={`text-sm rounded-lg p-3 flex gap-2 ${msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                {msg.kind === 'ok' ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="shrink-0 mt-0.5" />}{msg.text}
              </div>
            ) : null}
          </Card>

          <Card className="p-4 space-y-2">
            <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><HardDrive size={16} /> File storage check</h2>
            {storage.isLoading ? <p className="text-xs text-gray-500">Checking...</p> : null}
            {storage.error ? <p className="text-xs text-red-700">{errText(storage.error)}</p> : null}
            {st ? (
              <div className="text-xs space-y-1.5 text-gray-700">
                <div className="flex gap-2 items-center flex-wrap">Provider: <Badge tone={st.provider === 'blob' ? 'green' : 'amber'}>{st.provider === 'blob' ? 'Azure Blob Storage' : 'Server disk (not for production)'}</Badge></div>
                <div>Private container: <code>{st.privateContainer}</code> (student documents)</div>
                <div className="flex gap-2 items-center flex-wrap">Public container: <code>{st.publicContainer}</code> <Badge tone={st.publicReadable ? 'green' : 'amber'}>{st.publicReadable ? 'images load straight from Storage' : 'images served via the API'}</Badge></div>
                {st.assetBaseUrl ? <div>Public base URL override: <code>{st.assetBaseUrl}</code></div> : null}
                {st.problem ? <div className="text-amber-800 bg-amber-50 rounded-lg p-2">{st.problem}</div> : <div className="text-green-700">Storage looks healthy.</div>}
                <button className="underline text-brand-800" onClick={() => storage.refetch()}>Check again</button>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
