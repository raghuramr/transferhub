import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileText, HardDrive, Plus, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

interface Student { id: string; name: string; email: string; studentId: string | null; requests: number; courses: number; fromCollege: string | null; targetUniversity: string | null }
interface Kind { kind: string; label: string }
interface StorageStatus { provider: string; connected: boolean; privateContainer: string; publicContainer: string; publicReadable: boolean; publicUrlExample: string | null; assetBaseUrl: string | null; problem: string | null }
interface University { id: number; code: string; name: string; calendar: string | null }
interface Institution { id: number; name: string }
interface Program { id: number; name: string; area: string | null }

interface ManualCourse { code: string; title: string; credits: string; grade: string; term: string; topics: string }

const BLANK_COURSE: ManualCourse = { code: '', title: '', credits: '3', grade: 'A', term: 'Fall 2024', topics: '' };

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

const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm';
const Label = ({ children }: { children: React.ReactNode }) => <span className="block text-xs font-medium text-gray-600 mb-1">{children}</span>;

export default function DemoDocuments() {
  const [mode, setMode] = useState<'students' | 'manual'>('students');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Set<string>>(new Set(['transcript', 'id_document', 'english_test', 'syllabus', 'enrollment_letter']));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ── manual ("type the details") form ──
  const [m, setM] = useState({
    firstName: '', lastName: '', email: '', studentId: '', dateOfBirth: '', country: 'United States', city: '', state: '',
    idType: 'student_id', passportNumber: '', program: '', expectedGraduation: '', targetUniversity: '', targetProgram: '',
    englishType: 'TOEFL', englishTotal: '', englishR: '', englishL: '', englishS: '', englishW: '',
    instName: '', instCode: '', calendar: 'semester', school: '',
  });
  const [universityId, setUniversityId] = useState<number | ''>('');
  const [courses, setCourses] = useState<ManualCourse[]>([{ ...BLANK_COURSE }]);
  const set = (k: keyof typeof m) => (e: { target: { value: string } }) => setM((x) => ({ ...x, [k]: e.target.value }));
  const setCourse = (i: number, k: keyof ManualCourse, v: string) => setCourses((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));

  const students = useQuery<Student[]>({ queryKey: ['demo-docs', 'students', q], queryFn: async () => (await api.get('/demo/documents/students', { params: { q } })).data, enabled: mode === 'students' });
  const kindList = useQuery<Kind[]>({ queryKey: ['demo-docs', 'kinds'], queryFn: async () => (await api.get('/demo/documents/kinds')).data });
  const storage = useQuery<StorageStatus>({ queryKey: ['demo-docs', 'storage'], queryFn: async () => (await api.get('/demo/storage-status')).data });
  const universities = useQuery<University[]>({ queryKey: ['demo-docs', 'universities'], queryFn: async () => (await api.get('/universities')).data, enabled: mode === 'manual' });
  const institutions = useQuery<Institution[]>({
    queryKey: ['demo-docs', 'institutions', universityId], enabled: mode === 'manual' && universityId !== '',
    queryFn: async () => (await api.get('/institutions', { params: { universityId } })).data,
  });
  const programs = useQuery<Program[]>({
    queryKey: ['demo-docs', 'programs', universityId], enabled: mode === 'manual' && universityId !== '',
    queryFn: async () => (await api.get('/courses/programs', { params: { institutionId: universityId } })).data,
  });

  const list = students.data ?? [];
  const allShown = useMemo(() => list.length > 0 && list.every((s) => selected.has(s.id)), [list, selected]);
  const toggle = (s: Set<string>, id: string) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; };

  /** Mirrors DemoDocumentsService.validateManual so the form can say what is missing before the download. */
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!kinds.size) out.push('Pick at least one document type.');
    if (!m.firstName.trim()) out.push('First name is required.');
    if (!m.lastName.trim()) out.push('Last name is required.');
    const needsInst = ['transcript', 'syllabus', 'enrollment_letter'].some((k) => kinds.has(k));
    if (needsInst && !m.instName.trim()) out.push('University / college name is required for a transcript, syllabi or an enrolment letter.');
    const rows = courses.filter((c) => c.code.trim() || c.title.trim());
    const usable = courses.filter((c) => c.code.trim() && c.title.trim());
    if (['transcript', 'syllabus'].some((k) => kinds.has(k))) {
      if (!rows.length) out.push('Add at least one course for a transcript or syllabi.');
      else if (!usable.length) out.push('Every course needs a code and a title.');
      else if (usable.length < rows.length) out.push(`${rows.length - usable.length} course row(s) have no code or title and will be left out.`);
    }
    if (m.dateOfBirth.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(m.dateOfBirth.trim())) out.push('Date of birth must be yyyy-mm-dd.');
    return out;
  }, [kinds, m, courses]);
  const blocking = missing.filter((x) => !x.includes('will be left out'));

  const manualBody = () => ({
    kinds: [...kinds],
    student: {
      firstName: m.firstName, lastName: m.lastName, email: m.email, studentId: m.studentId, dateOfBirth: m.dateOfBirth,
      country: m.country, city: m.city, state: m.state, idType: m.idType, passportNumber: m.passportNumber,
      program: m.program, expectedGraduation: m.expectedGraduation, targetUniversity: m.targetUniversity, targetProgram: m.targetProgram,
      english: m.englishTotal || m.englishR || m.englishL || m.englishS || m.englishW
        ? { type: m.englishType, total: m.englishTotal, r: m.englishR, l: m.englishL, s: m.englishS, w: m.englishW }
        : null,
    },
    institution: { name: m.instName, code: m.instCode, calendar: m.calendar, school: m.school },
    courses: courses.filter((c) => c.code.trim() && c.title.trim()).map((c) => ({
      code: c.code, title: c.title, credits: c.credits, grade: c.grade, term: c.term,
      topics: c.topics.split(/\r?\n|\|/).map((t) => t.trim()).filter(Boolean),
    })),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const r = mode === 'students'
        ? await api.post('/demo/documents/generate', { studentIds: [...selected], kinds: [...kinds] }, { responseType: 'blob' })
        : await api.post('/demo/documents/generate-manual', manualBody(), { responseType: 'blob' });
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

  const canGenerate = mode === 'students' ? !!selected.size && !!kinds.size : !blocking.length;
  const st = storage.data;

  return (
    <div className="w-[95%] max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileText size={24} className="text-brand-800" /> Demo documents</h1>
          <Badge tone="purple">Presenter tool</Badge>
        </div>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          Sample PDFs with a real text layer, so Smart Upload can read them: transcripts, a passport page and an ID card, an English
          test report, one syllabus per course and an enrolment letter. Pick students and build the documents from their own records, or
          type the details yourself. Anything a record does not hold (coursework, test scores, date of birth) is filled in with sensible
          sample data rather than skipped, and the ZIP&apos;s README says where that happened.
        </p>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {([['students', 'Pick from the list', <Users size={15} key="u" />], ['manual', 'Type the details', <UserPlus size={15} key="p" />]] as const).map(([k, label, icon]) => (
          <button
            key={k}
            onClick={() => { setMode(k as 'students' | 'manual'); setMsg(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${mode === k ? 'border-brand-800 text-brand-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {mode === 'students' ? (
          <Card className="lg:col-span-2 p-4 space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              <div className="relative flex-1 min-w-[12rem]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or student ID" className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
              </div>
              <Button variant="outline" onClick={() => setSelected((s) => { const n = new Set(s); if (allShown) list.forEach((x) => n.delete(x.id)); else for (const x of list) { if (n.size >= 25) break; n.add(x.id); } return n; })}>{allShown ? 'Clear shown' : 'Select first 25'}</Button>
              {selected.size ? <Button variant="outline" onClick={() => setSelected(new Set())}>Clear all ({selected.size})</Button> : null}
            </div>
            <p className="text-xs text-gray-500">{list.length} student{list.length === 1 ? '' : 's'}{q ? ' match' : ' (all active students)'} · {selected.size} selected (up to 25 per download)</p>
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
                      {s.courses ? `${s.courses} course${s.courses === 1 ? '' : 's'} from ${s.fromCollege ?? 'a previous college'}` : 'No submitted courses - sample coursework is used'}
                      {s.targetUniversity ? ` · target ${s.targetUniversity}` : ''}
                    </div>
                  </div>
                  {s.courses ? <Badge tone="green">{s.requests} request{s.requests === 1 ? '' : 's'}</Badge> : <Badge tone="gray">no coursework</Badge>}
                </label>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="lg:col-span-2 p-4 space-y-5">
            <section className="space-y-3">
              <h2 className="font-semibold text-gray-900 text-sm">Student</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label><Label>First name *</Label><input className={field} value={m.firstName} onChange={set('firstName')} placeholder="Maya" /></label>
                <label><Label>Last name *</Label><input className={field} value={m.lastName} onChange={set('lastName')} placeholder="Rivera" /></label>
                <label><Label>Email</Label><input className={field} value={m.email} onChange={set('email')} placeholder="maya@example.edu" /></label>
                <label><Label>Student / passport ID</Label><input className={field} value={m.studentId} onChange={set('studentId')} placeholder="left blank: derived from the name" /></label>
                <label><Label>Date of birth (yyyy-mm-dd)</Label><input className={field} value={m.dateOfBirth} onChange={set('dateOfBirth')} placeholder="2003-05-02" /></label>
                <label><Label>Country / nationality</Label><input className={field} value={m.country} onChange={set('country')} /></label>
                <label><Label>City</Label><input className={field} value={m.city} onChange={set('city')} /></label>
                <label><Label>State / region</Label><input className={field} value={m.state} onChange={set('state')} /></label>
                <label><Label>ID type</Label>
                  <select className={field} value={m.idType} onChange={set('idType')}>
                    <option value="student_id">Student ID card</option>
                    <option value="passport">Passport</option>
                    <option value="national_id">National identity card</option>
                  </select>
                </label>
                <label><Label>Passport number (if different)</Label><input className={field} value={m.passportNumber} onChange={set('passportNumber')} placeholder="left blank: derived from the name" /></label>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="font-semibold text-gray-900 text-sm">University, institution and program</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label><Label>Pick a university (optional)</Label>
                  <select
                    className={field} value={universityId}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : '';
                      setUniversityId(id);
                      const u = (universities.data ?? []).find((x) => x.id === id);
                      if (u) setM((x) => ({ ...x, instName: u.name, instCode: u.code, calendar: u.calendar === 'quarter' ? 'quarter' : 'semester' }));
                    }}
                  >
                    <option value="">- type it below instead -</option>
                    {(universities.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                  </select>
                </label>
                <label><Label>Calendar</Label>
                  <select className={field} value={m.calendar} onChange={set('calendar')}>
                    <option value="semester">Semester</option>
                    <option value="quarter">Quarter</option>
                  </select>
                </label>
                <label><Label>University / college name *</Label><input className={field} value={m.instName} onChange={set('instName')} placeholder="Bay State Community College" /></label>
                <label><Label>Code</Label><input className={field} value={m.instCode} onChange={set('instCode')} placeholder="left blank: from the name" /></label>
                <label><Label>Institution (school / college)</Label>
                  <input className={field} value={m.school} onChange={set('school')} list="demo-institutions" placeholder="School of Business" />
                  <datalist id="demo-institutions">{(institutions.data ?? []).map((i) => <option key={i.id} value={i.name} />)}</datalist>
                </label>
                <label><Label>Program</Label>
                  <input className={field} value={m.program} onChange={set('program')} list="demo-programs" placeholder="Computer Science" />
                  <datalist id="demo-programs">{(programs.data ?? []).map((p) => <option key={p.id} value={p.name} />)}</datalist>
                </label>
                <label><Label>Transferring to (university)</Label><input className={field} value={m.targetUniversity} onChange={set('targetUniversity')} placeholder="Boston University" /></label>
                <label><Label>Target program</Label><input className={field} value={m.targetProgram} onChange={set('targetProgram')} /></label>
                <label><Label>Expected graduation year</Label><input className={field} value={m.expectedGraduation} onChange={set('expectedGraduation')} placeholder="2027" /></label>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-semibold text-gray-900 text-sm">Courses <span className="font-normal text-gray-500">(transcript rows and one syllabus each)</span></h2>
                <Button variant="outline" icon={<Plus size={14} />} onClick={() => setCourses((c) => [...c, { ...BLANK_COURSE }])}>Add course</Button>
              </div>
              <div className="space-y-3">
                {courses.map((c, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2 bg-gray-50/60">
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                      <label className="col-span-1"><Label>Code *</Label><input className={field} value={c.code} onChange={(e) => setCourse(i, 'code', e.target.value)} placeholder="CSC 110" /></label>
                      <label className="col-span-2"><Label>Title *</Label><input className={field} value={c.title} onChange={(e) => setCourse(i, 'title', e.target.value)} placeholder="Introduction to Programming" /></label>
                      <label><Label>Credits</Label><input className={field} value={c.credits} onChange={(e) => setCourse(i, 'credits', e.target.value)} /></label>
                      <label><Label>Grade</Label><input className={field} value={c.grade} onChange={(e) => setCourse(i, 'grade', e.target.value)} /></label>
                      <label><Label>Term</Label><input className={field} value={c.term} onChange={(e) => setCourse(i, 'term', e.target.value)} placeholder="Fall 2024" /></label>
                    </div>
                    <div className="flex gap-2 items-end">
                      <label className="flex-1"><Label>Topics (one per line, optional)</Label>
                        <textarea className={`${field} min-h-[3rem]`} value={c.topics} onChange={(e) => setCourse(i, 'topics', e.target.value)} placeholder="Variables and expressions&#10;Control flow" />
                      </label>
                      <Button variant="outline" icon={<Trash2 size={14} />} onClick={() => setCourses((cs) => (cs.length > 1 ? cs.filter((_, j) => j !== i) : [{ ...BLANK_COURSE }]))}>Remove</Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="font-semibold text-gray-900 text-sm">English test <span className="font-normal text-gray-500">(left blank, sample scores are derived from the name)</span></h2>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <label><Label>Test</Label>
                  <select className={field} value={m.englishType} onChange={set('englishType')}><option value="TOEFL">TOEFL</option><option value="IELTS">IELTS</option></select>
                </label>
                <label><Label>Total / band</Label><input className={field} value={m.englishTotal} onChange={set('englishTotal')} /></label>
                <label><Label>Reading</Label><input className={field} value={m.englishR} onChange={set('englishR')} /></label>
                <label><Label>Listening</Label><input className={field} value={m.englishL} onChange={set('englishL')} /></label>
                <label><Label>Speaking</Label><input className={field} value={m.englishS} onChange={set('englishS')} /></label>
                <label><Label>Writing</Label><input className={field} value={m.englishW} onChange={set('englishW')} /></label>
              </div>
            </section>

            {missing.length ? (
              <div className="text-sm rounded-lg p-3 bg-amber-50 text-amber-900">
                <div className="font-medium flex items-center gap-2"><AlertTriangle size={16} /> Before generating:</div>
                <ul className="list-disc ml-6 mt-1">{missing.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            ) : <p className="text-sm text-green-700 flex items-center gap-2"><CheckCircle2 size={16} /> Ready to generate.</p>}
          </Card>
        )}

        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <h2 className="font-semibold text-gray-900 text-sm">Documents to generate</h2>
            {(kindList.data ?? []).map((k) => (
              <label key={k.kind} className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-1" checked={kinds.has(k.kind)} onChange={() => setKinds((x) => toggle(x, k.kind))} />
                <span>{k.label}</span>
              </label>
            ))}
            <Button icon={<Download size={16} />} disabled={generate.isPending || !canGenerate} onClick={() => { setMsg(null); generate.mutate(); }}>
              {generate.isPending ? 'Generating...' : mode === 'students' ? `Download for ${selected.size || 'no'} student${selected.size === 1 ? '' : 's'}` : 'Generate documents'}
            </Button>
            <p className="text-xs text-gray-500">
              One document downloads as a PDF; several download as a ZIP (one folder per student, plus a README of what was made and of
              anything that was filled in or skipped). Up to 25 students at a time.
            </p>
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
