import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ExternalLink, FileText, Info, Loader2, Paperclip, School, Upload } from 'lucide-react';
import { api, getErrorMessage, uploadsApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import { UniversityCompareColumn } from '../../components/student/UniversityCompareColumn';
import { fmtCredits, type ApplyResult, type CompareResult, type JourneyOverview, type JourneyUniversity } from '../../components/student/journeyTypes';

interface UploadRow { id: string; entityType: string; documentType: string; originalFileName: string; mimeType: string | null; sizeBytes: number | null; createdAt: string }

const STEPS = [
  { n: 1, label: 'Your courses' },
  { n: 2, label: 'Documents' },
  { n: 3, label: 'Compare' },
  { n: 4, label: 'Apply' },
] as const;

/** A guided, step-by-step flow: confirm your courses, add optional documents, compare up to 3 universities, then apply to one or more at once (each tracked as its own request). */
export default function Explore() {
  const qc = useQueryClient();
  const unis = useQuery({ queryKey: ['student', 'universities'], queryFn: async () => (await api.get<JourneyUniversity[]>('/student/universities')).data });
  const overview = useQuery({ queryKey: ['student', 'overview'], queryFn: async () => (await api.get<JourneyOverview>('/student/overview')).data });
  const docs = useQuery({ queryKey: ['student', 'explore-docs'], queryFn: async () => (await uploadsApi.list()).data as UploadRow[] });

  const [step, setStep] = useState(1);
  const [slots, setSlots] = useState<(number | null)[]>([null, null, null]);
  const [seeded, setSeeded] = useState(false);
  const [applySel, setApplySel] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<ApplyResult[] | null>(null);

  // Default the first slot to the student's target once both lists have loaded.
  useEffect(() => {
    if (seeded || !unis.data || overview.isLoading) return;
    const t = overview.data?.target?.institutionId;
    const first = t && unis.data.some((u) => u.id === t) ? t : null;
    setSlots([first, null, null]);
    setSeeded(true);
  }, [seeded, unis.data, overview.data, overview.isLoading]);

  const ids = slots.filter((x): x is number => x != null);
  const cmp = useQuery({
    queryKey: ['student', 'compare', ids.join(',')],
    queryFn: async () => (await api.get<CompareResult>('/student/compare', { params: { ids: ids.join(',') } })).data,
    enabled: ids.length > 0,
  });

  // Entering the Apply step, default every compared university to selected.
  useEffect(() => {
    if (step === 4) setApplySel(new Set(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const setSlot = (i: number, v: number | null) => { setResults(null); setSlots((s) => s.map((x, j) => (j === i ? v : x))); };
  const target = overview.data?.target ?? null;
  const myCredits = overview.data?.totals.convertedCredits ?? 0;
  const courses = overview.data?.courses ?? [];
  const hasCourses = courses.length > 0;

  const applyMut = useMutation({
    mutationFn: async (institutionIds: number[]) => (await api.post<ApplyResult[]>('/student/apply', { institutionIds })).data,
    onSuccess: (res) => {
      setResults(res);
      qc.invalidateQueries({ queryKey: ['student', 'overview'] });
      qc.invalidateQueries({ queryKey: ['progress'] });
      qc.invalidateQueries({ queryKey: ['transcripts'] });
    },
  });

  return (
    <div className="mx-auto w-[95%] max-w-6xl p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Explore &amp; apply</h1>
        <p className="mt-1 text-gray-500">See which of your courses count where, compare up to three universities, then apply to one or more in a few guided steps.</p>
      </div>

      <Stepper step={step} onJump={(n) => { setResults(null); setStep(n); }} />

      <div className="mt-5">
        {step === 1 && (
          <StepYourCourses loading={overview.isLoading} error={overview.isError} courses={courses} totalCredits={myCredits} institution={overview.data?.institution?.name ?? null} />
        )}
        {step === 2 && (
          <StepDocuments docs={docs.data ?? []} loading={docs.isLoading} onUploaded={() => qc.invalidateQueries({ queryKey: ['student', 'explore-docs'] })} />
        )}
        {step === 3 && (
          <StepCompare
            note={cmp.data?.note}
            unisData={unis.data ?? []}
            unisError={unis.isError}
            noCourses={cmp.data != null && cmp.data.studentCourses.length === 0}
            slots={slots}
            ids={ids}
            cmp={cmp}
            setSlot={setSlot}
            target={target}
            myCredits={myCredits}
          />
        )}
        {step === 4 && (
          <StepApply
            ids={ids}
            unis={unis.data ?? []}
            cmp={cmp.data}
            hasCourses={hasCourses}
            selected={applySel}
            toggle={(id) => setApplySel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
            onApply={() => applyMut.mutate([...applySel])}
            pending={applyMut.isPending}
            errorMsg={applyMut.isError ? getErrorMessage(applyMut.error, 'Could not submit your applications.') : null}
            results={results}
          />
        )}
      </div>

      {/* Wizard navigation */}
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
        <button
          onClick={() => { setResults(null); setStep((s) => Math.max(1, s - 1)); }}
          disabled={step === 1}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <ArrowLeft size={16} /> Back
        </button>
        {step < 4 ? (
          <button
            onClick={() => { setResults(null); setStep((s) => Math.min(4, s + 1)); }}
            disabled={step === 3 && ids.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-gray-200 disabled:text-gray-500"
          >
            {step === 3 ? 'Continue to apply' : 'Continue'} <ArrowRight size={16} />
          </button>
        ) : (
          <span className="text-xs text-gray-400">Each application is tracked as its own request.</span>
        )}
      </div>
    </div>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────

function Stepper({ step, onJump }: { step: number; onJump: (n: number) => void }) {
  return (
    <ol className="flex items-center gap-1 sm:gap-2">
      {STEPS.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <li key={s.n} className="flex min-w-0 flex-1 items-center">
            <button onClick={() => onJump(s.n)} className="flex min-w-0 items-center gap-2 text-left">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                active ? 'bg-brand-800 text-white' : done ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-400')}>
                {done ? <Check size={16} /> : s.n}
              </span>
              <span className={cn('truncate text-sm font-medium', active ? 'text-brand-900' : 'text-gray-500', !active && 'hidden sm:inline')}>{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={cn('mx-1 h-0.5 flex-1 rounded sm:mx-2', done ? 'bg-brand-200' : 'bg-gray-100')} />}
          </li>
        );
      })}
    </ol>
  );
}

// ── Step 1: your courses ───────────────────────────────────────────────────

function StepYourCourses({ loading, error, courses, totalCredits, institution }:
  { loading: boolean; error: boolean; courses: JourneyOverview['courses']; totalCredits: number; institution: string | null }) {
  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load your courses. Please try again.</p>;

  if (!courses.length) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 text-sm text-amber-900">
        <p className="font-medium">You have no courses on file yet.</p>
        <p className="mt-1">Add your coursework first so we can match it to each university. Then come back and compare.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/student/documents" className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"><FileText size={15} /> Smart upload a transcript</Link>
          <Link to="/student/upload" className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50"><Upload size={15} /> Enter courses manually</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Your current courses</h2>
          {institution && <p className="text-xs text-gray-500">From {institution}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold leading-none text-brand-800">{fmtCredits(totalCredits)}</p>
          <p className="text-[11px] text-gray-500">{courses.length} course{courses.length === 1 ? '' : 's'}, total credits</p>
        </div>
      </div>
      <ul className="divide-y divide-gray-100">
        {courses.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-20 shrink-0 font-medium text-gray-800">{c.code}</span>
            <span className="min-w-0 flex-1 truncate text-gray-600">{c.title}</span>
            {c.grade && <span className="shrink-0 text-xs text-gray-400">{c.grade}</span>}
            <span className="shrink-0 tabular-nums text-gray-700">{fmtCredits(c.convertedCredits)} cr</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">These are copied into each application you submit. To change them, edit your transcript.</p>
    </div>
  );
}

// ── Step 2: documents (optional) ───────────────────────────────────────────

function StepDocuments({ docs, loading, onUploaded }: { docs: UploadRow[]; loading: boolean; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const uploadMut = useMutation({
    mutationFn: async (file: File) => (await uploadsApi.upload(file, { entityType: 'transcript', documentType: 'supporting' })).data,
    onSuccess: () => { setMsg({ ok: true, text: 'Uploaded. It is saved to your documents.' }); onUploaded(); },
    onError: (e) => setMsg({ ok: false, text: getErrorMessage(e, 'Upload failed.') }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
        <Info size={16} className="mt-0.5 shrink-0 text-gray-400" />
        <p>Optional. Add documents that support your applications (transcripts, syllabi, test scores). This step never blocks you &mdash; you can skip it and apply anyway.</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-4">
          <h2 className="text-sm font-semibold text-gray-900">Your documents</h2>
          <button onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50">
            {uploadMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />} Upload a document
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setMsg(null); uploadMut.mutate(f); } e.target.value = ''; }} />
        </div>
        {loading ? (
          <div className="space-y-2 p-4">{[0, 1].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}</div>
        ) : docs.length ? (
          <ul className="divide-y divide-gray-100">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <FileText size={16} className="shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate text-gray-700">{d.originalFileName}</span>
                <span className="shrink-0 text-xs text-gray-400">{d.documentType}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-gray-400">No documents yet. Upload one above, or skip this step.</p>
        )}
        {msg && <p role="status" className={cn('px-4 pb-3 text-xs', msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</p>}
      </div>
    </div>
  );
}

// ── Step 3: compare ────────────────────────────────────────────────────────

function StepCompare({ note, unisData, unisError, noCourses, slots, ids, cmp, setSlot, target, myCredits }: {
  note?: string; unisData: JourneyUniversity[]; unisError: boolean; noCourses: boolean;
  slots: (number | null)[]; ids: number[]; cmp: ReturnType<typeof useQuery<CompareResult>>;
  setSlot: (i: number, v: number | null) => void; target: JourneyOverview['target']; myCredits: number;
}) {
  return (
    <div>
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>{note ?? 'This is a preview, not a guarantee. Matches come from existing equivalencies and built-in rules; the official evaluation happens after you are admitted.'}</p>
      </div>
      {unisError && <p className="mb-4 text-sm text-red-600">Could not load the list of universities.</p>}
      {noCourses && (
        <p className="mb-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">You have no courses yet, so there is nothing to match. Add coursework in step 1 to see real matches here.</p>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <UniversityCompareColumn
            key={i}
            index={i}
            optional={i > 0}
            universities={unisData}
            value={slots[i]}
            onChange={(v) => setSlot(i, v)}
            takenIds={ids}
            data={cmp.data?.universities.find((u) => u.institutionId === slots[i])}
            loading={cmp.isLoading || (cmp.isFetching && !cmp.data?.universities.some((u) => u.institutionId === slots[i]))}
            error={cmp.isError}
            targetInstitutionId={target?.institutionId ?? null}
            targetProgramId={target?.programId ?? null}
            myTotalCredits={myCredits}
          />
        ))}
      </div>
    </div>
  );
}

// ── Step 4: apply ──────────────────────────────────────────────────────────

function StepApply({ ids, unis, cmp, hasCourses, selected, toggle, onApply, pending, errorMsg, results }: {
  ids: number[]; unis: JourneyUniversity[]; cmp: CompareResult | undefined; hasCourses: boolean;
  selected: Set<number>; toggle: (id: number) => void; onApply: () => void; pending: boolean; errorMsg: string | null; results: ApplyResult[] | null;
}) {
  if (!ids.length) {
    return <p className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">Go back to the Compare step and pick at least one university first.</p>;
  }
  const nameOf = (id: number) => unis.find((u) => u.id === id)?.name ?? `University ${id}`;
  const transferOf = (id: number) => cmp?.universities.find((u) => u.institutionId === id)?.summary.transferableCredits ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Choose where to apply</h2>
        <p className="mt-1 text-sm text-gray-500">Each selected university becomes its own request, tracked separately, using the courses from step 1.</p>
      </div>

      {!hasCourses && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900">You have no courses on file, so you cannot apply yet. Add coursework in step 1 first.</p>
      )}

      <ul className="space-y-2">
        {ids.map((id) => {
          const checked = selected.has(id);
          const tc = transferOf(id);
          return (
            <li key={id}>
              <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3', checked ? 'border-brand-300 bg-brand-50/60' : 'border-gray-200 bg-white')}>
                <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="h-4 w-4 shrink-0 accent-brand-800" />
                <School size={18} className="shrink-0 text-brand-700" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{nameOf(id)}</span>
                  {tc != null && <span className="text-xs text-gray-500">{fmtCredits(tc)} credits could transfer</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <button
        onClick={onApply}
        disabled={pending || !hasCourses || selected.size === 0}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-gray-200 disabled:text-gray-500"
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        {pending ? 'Submitting...' : `Apply to ${selected.size} selected`}
      </button>
      {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

      {results && (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Results</h3>
          <ul className="space-y-2">
            {results.map((r) => (
              <li key={r.institutionId} className="flex items-start gap-2 text-sm">
                {r.status === 'created' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <Info size={16} className={cn('mt-0.5 shrink-0', r.status === 'skipped' ? 'text-amber-600' : 'text-red-500')} />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-gray-900">{r.institutionName ?? nameOf(r.institutionId)}</span>
                  {r.status === 'created' && r.transcriptId ? (
                    <> &mdash; <Link to={`/student/transcript/${r.transcriptId}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">request created <ExternalLink size={12} /></Link></>
                  ) : (
                    <span className={cn('ml-1', r.status === 'skipped' ? 'text-amber-700' : 'text-red-600')}>&mdash; {r.reason ?? (r.status === 'skipped' ? 'Skipped.' : 'Could not create.')}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {results.some((r) => r.status === 'created') && (
            <Link to="/student" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Go to your dashboard to track them</Link>
          )}
        </div>
      )}
    </div>
  );
}
