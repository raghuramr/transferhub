import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Pencil, Plus, Power, X } from 'lucide-react';
import { api, coursesApi, universitiesApi } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/cn';

type RuleType = 'max_transfer_at_level' | 'min_at_home' | 'required_at_home' | 'substitution' | 'not_principal' | 'residency_courses_count';

interface ProgramRule {
  id: number;
  institutionId: number;
  institutionCode?: string | null;
  institutionName?: string | null;
  programId: number | null;
  programName?: string | null;
  ruleCode?: string | null;
  ruleType: RuleType;
  levelMin: number | null;
  maxCount: number | null;
  minCount: number | null;
  courseCodePattern: string | null;
  substituteFor: string | null;
  params: Record<string, unknown>;
  description: string;
  isActive: boolean;
}

const TYPES: { value: RuleType; label: string; help: string }[] = [
  { value: 'required_at_home', label: 'Required course (must be taken at the university)', help: 'Transfer credit cannot satisfy these courses; a transferred match goes to department review.' },
  { value: 'max_transfer_at_level', label: 'Maximum transferred at a level', help: 'For example at most 4 transferred courses at 200+ level. When there are more, they go to review.' },
  { value: 'min_at_home', label: 'Minimum taken at the university', help: 'At least N courses of a department must be taken at the university, optionally beyond some listed courses.' },
  { value: 'residency_courses_count', label: 'Courses required in residency', help: 'The programme needs this many courses counted toward it (explained to the reviewer).' },
  { value: 'not_principal', label: 'Not a principal course', help: 'These courses do not count as principal courses of the programme (explained to the reviewer).' },
  { value: 'substitution', label: 'Substitution', help: 'Courses that may stand in for a required course (explained to the reviewer).' },
];
const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label ?? t;

const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50';
const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

/** One-line, human summary of a rule's parameters. */
function summary(r: ProgramRule): string {
  const bits: string[] = [];
  if (r.ruleType === 'max_transfer_at_level') bits.push(`max ${r.maxCount ?? '?'} at ${r.levelMin ?? '?'}+ level`);
  if (r.ruleType === 'min_at_home') bits.push(`at least ${r.minCount ?? '?'} ${r.courseCodePattern ?? ''} at the university`);
  if (r.ruleType === 'required_at_home' && r.courseCodePattern) bits.push(r.courseCodePattern.split('|').join(', '));
  if (r.ruleType === 'not_principal' && r.courseCodePattern) bits.push(r.courseCodePattern.split('|').join(', '));
  if (r.ruleType === 'substitution') bits.push(`${r.courseCodePattern?.split('|').join(r.params?.allOf ? ' + ' : ' or ') ?? '?'} for ${r.substituteFor ?? '?'}`);
  if (r.ruleType === 'residency_courses_count') bits.push([r.minCount != null ? `min ${r.minCount}` : '', r.maxCount != null ? `max ${r.maxCount}` : '', r.courseCodePattern ?? ''].filter(Boolean).join(' '));
  return bits.join(' · ');
}

interface Draft {
  id: number | null;
  institutionId: string;
  programId: string;
  ruleCode: string;
  ruleType: RuleType;
  levelMin: string;
  maxCount: string;
  minCount: string;
  courseCodePattern: string;
  substituteFor: string;
  excludeCodes: string;
  allOf: boolean;
  infoOnly: boolean;
  description: string;
}

const blank = (institutionId: string, programId: string): Draft => ({
  id: null, institutionId, programId, ruleCode: '', ruleType: 'required_at_home', levelMin: '', maxCount: '', minCount: '',
  courseCodePattern: '', substituteFor: '', excludeCodes: '', allOf: false, infoOnly: false, description: '',
});

const toDraft = (r: ProgramRule): Draft => ({
  id: r.id,
  institutionId: String(r.institutionId),
  programId: r.programId == null ? '' : String(r.programId),
  ruleCode: r.ruleCode ?? '',
  ruleType: r.ruleType,
  levelMin: r.levelMin == null ? '' : String(r.levelMin),
  maxCount: r.maxCount == null ? '' : String(r.maxCount),
  minCount: r.minCount == null ? '' : String(r.minCount),
  courseCodePattern: r.courseCodePattern ?? '',
  substituteFor: r.substituteFor ?? '',
  excludeCodes: Array.isArray(r.params?.excludeCodes) ? (r.params.excludeCodes as string[]).join(', ') : '',
  allOf: r.params?.allOf === true,
  infoOnly: r.params?.enforcement === 'info',
  description: r.description,
});

function problems(d: Draft): string[] {
  const e: string[] = [];
  if (!d.institutionId) e.push('Choose a university.');
  if (!d.description.trim()) e.push('Add a description.');
  if (d.ruleType === 'max_transfer_at_level') {
    if (d.maxCount === '') e.push('Set the maximum number of courses.');
    if (d.levelMin === '') e.push('Set the level, for example 200.');
  }
  if (d.ruleType === 'min_at_home') {
    if (d.minCount === '') e.push('Set the minimum number of courses.');
    if (!d.courseCodePattern.trim()) e.push('Name the department (for example BI) or the courses.');
  }
  if ((d.ruleType === 'required_at_home' || d.ruleType === 'not_principal') && !d.courseCodePattern.trim()) e.push('List the course codes.');
  if (d.ruleType === 'substitution') {
    if (!d.courseCodePattern.trim()) e.push('List the courses that may substitute.');
    if (!/\d/.test(d.substituteFor)) e.push('Give the course being substituted for, for example EC 203.');
  }
  if (d.ruleType === 'residency_courses_count' && d.minCount === '' && d.maxCount === '') e.push('Set a minimum or a maximum number of courses.');
  for (const [label, v] of [['Level', d.levelMin], ['Maximum', d.maxCount], ['Minimum', d.minCount]] as const) {
    if (v !== '' && (!Number.isInteger(Number(v)) || Number(v) < 0)) e.push(`${label} must be a whole number of 0 or more.`);
  }
  return e;
}

function payload(d: Draft) {
  const params: Record<string, unknown> = {};
  const ex = d.excludeCodes.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
  if (d.ruleType === 'min_at_home' && ex.length) params.excludeCodes = ex;
  if (d.ruleType === 'substitution' && d.allOf) params.allOf = true;
  if (d.ruleType === 'required_at_home' && d.infoOnly) params.enforcement = 'info';
  const t = d.ruleType;
  return {
    institutionId: Number(d.institutionId),
    programId: d.programId ? Number(d.programId) : null,
    ruleCode: d.ruleCode.trim() || null,
    ruleType: t,
    levelMin: t === 'max_transfer_at_level' || t === 'min_at_home' ? numOrNull(d.levelMin) : null,
    maxCount: t === 'max_transfer_at_level' || t === 'residency_courses_count' ? numOrNull(d.maxCount) : null,
    minCount: t === 'min_at_home' || t === 'residency_courses_count' ? numOrNull(d.minCount) : null,
    courseCodePattern: d.courseCodePattern.trim() || null,
    substituteFor: t === 'substitution' ? d.substituteFor.trim() || null : null,
    params,
    description: d.description.trim(),
  };
}

/** Per-university, optionally per-programme requirements (PRG-03..08). They only flag courses for review or explain; they never deny credit. */
export default function ProgrammeRulesTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can('workflows', 'edit');
  const [uni, setUni] = useState('');
  const [prog, setProg] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formErr, setFormErr] = useState<string[]>([]);

  const unis = useQuery({ queryKey: ['md-universities'], queryFn: () => universitiesApi.list({ isActive: true }) });
  const uniList = (unis.data?.data as { id: number; name: string }[] | undefined) ?? [];
  const programsQ = useQuery({
    queryKey: ['rule-programs', uni],
    queryFn: () => coursesApi.programs(Number(uni), true),
    enabled: !!uni,
  });
  const programList = (programsQ.data?.data as { id: number; name: string }[] | undefined) ?? [];
  const draftPrograms = useQuery({
    queryKey: ['rule-programs', draft?.institutionId],
    queryFn: () => coursesApi.programs(Number(draft!.institutionId), true),
    enabled: !!draft?.institutionId,
  });
  const draftProgramList = (draftPrograms.data?.data as { id: number; name: string }[] | undefined) ?? [];

  const list = useQuery({
    queryKey: ['programme-rules', uni, prog, showInactive],
    queryFn: () => api.get<{ ready: boolean; rules: ProgramRule[] }>('/programme-rules', {
      params: { institutionId: uni || undefined, programId: prog || undefined, includeInactive: showInactive || undefined },
    }),
  });
  const rules = list.data?.data.rules ?? [];
  const ready = list.data?.data.ready ?? true;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['programme-rules'] });

  const save = useMutation({
    mutationFn: (d: Draft) => (d.id == null ? api.post('/programme-rules', payload(d)) : api.patch(`/programme-rules/${d.id}`, payload(d))),
    onSuccess: () => { setDraft(null); setFormErr([]); refresh(); },
    onError: (e) => setFormErr([errMsg(e, 'Could not save the rule.')]),
  });
  const toggle = useMutation({
    mutationFn: (r: ProgramRule) => (r.isActive ? api.delete(`/programme-rules/${r.id}`) : api.post(`/programme-rules/${r.id}/activate`)),
    onSuccess: refresh,
  });

  const grouped = useMemo(() => {
    const m = new Map<string, ProgramRule[]>();
    for (const r of rules) {
      const key = `${r.institutionName ?? r.institutionId} / ${r.programName ?? 'All programmes'}`;
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    return [...m.entries()];
  }, [rules]);

  const submit = () => {
    if (!draft) return;
    const e = problems(draft);
    setFormErr(e);
    if (!e.length) save.mutate(draft);
  };
  const set = (p: Partial<Draft>) => { setDraft((d) => (d ? { ...d, ...p } : d)); setFormErr([]); };
  const showLevel = draft && (draft.ruleType === 'max_transfer_at_level' || draft.ruleType === 'min_at_home');
  const showMax = draft && (draft.ruleType === 'max_transfer_at_level' || draft.ruleType === 'residency_courses_count');
  const showMin = draft && (draft.ruleType === 'min_at_home' || draft.ruleType === 'residency_courses_count');

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
        Programme requirements for a university or one of its programmes. They are checked for every transfer request against the student's target programme
        (or all of the university's rules when none is chosen). A rule only <strong>flags</strong> a course for department review or explains something to the reviewer;
        it never denies credit by itself.
      </div>

      {!ready && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Programme rules need database migration 027, which has not been applied yet. Nothing can be saved until it is.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <label className="min-w-[12rem] flex-1 text-sm font-medium text-gray-700">University
          <select value={uni} onChange={(e) => { setUni(e.target.value); setProg(''); }} className={inputCls}>
            <option value="">All universities</option>
            {uniList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="min-w-[12rem] flex-1 text-sm font-medium text-gray-700">Programme
          <select value={prog} onChange={(e) => setProg(e.target.value)} disabled={!uni} className={inputCls}>
            <option value="">All programmes</option>
            {programList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4" /> Show deactivated
        </label>
        {canEdit && (
          <button type="button" disabled={!ready} onClick={() => { setDraft(blank(uni, prog)); setFormErr([]); }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white disabled:bg-brand-300">
            <Plus size={14} /> Add rule
          </button>
        )}
      </div>

      {draft && (
        <div className="rounded-xl border border-brand-200 bg-white p-5" data-testid="rule-form">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">{draft.id == null ? 'New rule' : 'Edit rule'}</h3>
            <button type="button" onClick={() => setDraft(null)} aria-label="Close" className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">University
              <select value={draft.institutionId} onChange={(e) => set({ institutionId: e.target.value, programId: '' })} className={inputCls}>
                <option value="">Choose…</option>
                {uniList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">Programme
              <select value={draft.programId} onChange={(e) => set({ programId: e.target.value })} disabled={!draft.institutionId} className={inputCls}>
                <option value="">All programmes of the university</option>
                {draftProgramList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">Type
              <select value={draft.ruleType} onChange={(e) => set({ ruleType: e.target.value as RuleType })} className={inputCls}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-gray-500">{TYPES.find((t) => t.value === draft.ruleType)?.help}</span>
            </label>
            {showLevel && (
              <label className="text-sm font-medium text-gray-700">Level (for example 200)
                <input type="number" min={0} max={900} value={draft.levelMin} onChange={(e) => set({ levelMin: e.target.value })} className={inputCls} />
              </label>
            )}
            {showMax && (
              <label className="text-sm font-medium text-gray-700">Maximum number of courses
                <input type="number" min={0} value={draft.maxCount} onChange={(e) => set({ maxCount: e.target.value })} className={inputCls} />
              </label>
            )}
            {showMin && (
              <label className="text-sm font-medium text-gray-700">Minimum number of courses
                <input type="number" min={0} value={draft.minCount} onChange={(e) => set({ minCount: e.target.value })} className={inputCls} />
              </label>
            )}
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">
              {draft.ruleType === 'substitution' ? 'Courses that may substitute (separate with |)' : 'Course codes or department (separate with |)'}
              <input value={draft.courseCodePattern} onChange={(e) => set({ courseCodePattern: e.target.value })} className={inputCls} placeholder={draft.ruleType === 'min_at_home' ? 'BI' : 'CS 320|CS 332|CS 350'} />
            </label>
            {draft.ruleType === 'substitution' && (
              <>
                <label className="text-sm font-medium text-gray-700">Substituted for (required course)
                  <input value={draft.substituteFor} onChange={(e) => set({ substituteFor: e.target.value })} className={inputCls} placeholder="EC 203" />
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
                  <input type="checkbox" checked={draft.allOf} onChange={(e) => set({ allOf: e.target.checked })} className="h-4 w-4" /> All of these courses are needed together
                </label>
              </>
            )}
            {draft.ruleType === 'min_at_home' && (
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">Beyond these courses (optional, separate with commas)
                <input value={draft.excludeCodes} onChange={(e) => set({ excludeCodes: e.target.value })} className={inputCls} placeholder="BI 107, BI 108" />
              </label>
            )}
            {draft.ruleType === 'required_at_home' && (
              <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                <input type="checkbox" checked={draft.infoOnly} onChange={(e) => set({ infoOnly: e.target.checked })} className="h-4 w-4" /> Only explain the requirement (do not send transferred matches to review)
              </label>
            )}
            <label className="text-sm font-medium text-gray-700">Reference (optional)
              <input value={draft.ruleCode} maxLength={20} onChange={(e) => set({ ruleCode: e.target.value })} className={inputCls} placeholder="PRG-04" />
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">Description
              <textarea value={draft.description} maxLength={500} rows={2} onChange={(e) => set({ description: e.target.value })} className={inputCls} />
            </label>
          </div>
          {formErr.length > 0 && <ul className="mt-3 space-y-0.5 text-sm text-red-700" role="alert">{formErr.map((m) => <li key={m}>{m}</li>)}</ul>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600">Cancel</button>
            <button type="button" disabled={save.isPending} onClick={submit} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white disabled:bg-brand-300">
              {save.isPending && <Loader2 size={14} className="animate-spin" />} Save rule
            </button>
          </div>
        </div>
      )}

      {list.isLoading ? (
        <p className="text-gray-400">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">No programme rules{uni ? ' for this selection' : ''} yet.</p>
      ) : (
        grouped.map(([scope, items]) => (
          <section key={scope}>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">{scope}</h3>
            <ul className="space-y-2">
              {items.map((r) => (
                <li key={r.id} className={cn('rounded-xl border bg-white p-4', r.isActive ? 'border-gray-200' : 'border-gray-200 opacity-60')}>
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {r.ruleCode && <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-800">{r.ruleCode}</span>}
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">{typeLabel(r.ruleType)}</span>
                        {!r.isActive && <span className="rounded-full bg-gray-200 px-2 py-0.5 font-medium text-gray-600">Deactivated</span>}
                      </div>
                      <p className="mt-1.5 text-sm text-gray-900 break-words">{r.description}</p>
                      {summary(r) && <p className="mt-0.5 text-xs text-gray-500 break-words">{summary(r)}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => { setDraft(toDraft(r)); setFormErr([]); }} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><Pencil size={12} /> Edit</button>
                        <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate(r)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><Power size={12} /> {r.isActive ? 'Deactivate' : 'Activate'}</button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
