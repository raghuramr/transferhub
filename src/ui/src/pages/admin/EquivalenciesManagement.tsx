import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Power } from 'lucide-react';
import type { AxiosError } from 'axios';
import { coursesApi, equivalenciesApi } from '../../lib/api';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { usePermissions } from '../../hooks/usePermissions';
import type { ApiError } from '../../types';

interface Equivalency {
  id: number;
  externalCourseId: number;
  buCourseId: number;
  outcome: string;
  buCredits: number | null;
  matchLevel: string | null;
  rationale: string | null;
  source: string | null;
  isActive: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: 'current' | 'upcoming' | 'expired' | 'inactive';
  buCourse: { code: string; title: string; institutionCode: string };
  externalCourse: { code: string; title: string; institutionCode: string };
}
interface University { id: number; code: string; name: string }
interface CourseOption { id: number; code: string; title: string }

const OUTCOMES = [
  { value: 'equivalent', label: 'Equivalent' },
  { value: 'elective', label: 'Elective credit' },
  { value: 'no_credit', label: 'No credit' },
  { value: 'bu_only', label: 'Receiving-only' },
];
const STATUS_STYLE: Record<Equivalency['status'], string> = {
  current: 'bg-green-100 text-green-700',
  upcoming: 'bg-blue-100 text-blue-700',
  expired: 'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-100 text-gray-600',
};
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function errorText(e: unknown) {
  const m = (e as AxiosError<ApiError>)?.response?.data?.message;
  return (Array.isArray(m) ? m.join(' ') : m) ?? 'Something went wrong. Please try again.';
}

function CoursePicker({ label, universities, value, onChange }: {
  label: string;
  universities: University[];
  value: string;
  onChange: (courseId: string) => void;
}) {
  const [uni, setUni] = useState('');
  const { data } = useQuery({
    queryKey: ['courses-by-institution', uni],
    queryFn: () => coursesApi.byInstitution(Number(uni)),
    enabled: !!uni,
  });
  const courses = (data?.data as CourseOption[]) ?? [];
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select className={inputCls} value={uni} onChange={(e) => { setUni(e.target.value); onChange(''); }}>
          <option value="">University…</option>
          {universities.map((u) => <option key={u.id} value={u.id}>{u.code} - {u.name}</option>)}
        </select>
        <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} disabled={!uni}>
          <option value="">Course…</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.title}</option>)}
        </select>
      </div>
    </div>
  );
}

function DetailFields({ form, onChange }: {
  form: { outcome: string; buCredits: string; matchLevel: string; rationale: string; effectiveFrom: string; effectiveTo: string };
  onChange: (next: typeof form) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Outcome</label>
          <select className={inputCls} value={form.outcome} onChange={(e) => onChange({ ...form, outcome: e.target.value })}>
            {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Credits awarded (optional)</label>
          <input className={inputCls} inputMode="decimal" value={form.buCredits} onChange={(e) => onChange({ ...form, buCredits: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Match level (optional)</label>
          <input className={inputCls} value={form.matchLevel} onChange={(e) => onChange({ ...form, matchLevel: e.target.value })} placeholder="Likely equivalent" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Effective from</label>
          <input type="date" className={inputCls} value={form.effectiveFrom} onChange={(e) => onChange({ ...form, effectiveFrom: e.target.value })} />
          <p className="text-xs text-gray-400 mt-1">Courses taken on or after this date. Leave empty for no start limit.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Effective to</label>
          <input type="date" className={inputCls} value={form.effectiveTo} onChange={(e) => onChange({ ...form, effectiveTo: e.target.value })} />
          <p className="text-xs text-gray-400 mt-1">Courses taken on or before this date. Leave empty for no end limit.</p>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Rationale (optional)</label>
        <textarea className={inputCls} rows={2} value={form.rationale} onChange={(e) => onChange({ ...form, rationale: e.target.value })} />
      </div>
    </div>
  );
}

const emptyDetail = { outcome: 'equivalent', buCredits: '', matchLevel: '', rationale: '', effectiveFrom: '', effectiveTo: '' };

export default function EquivalenciesManagement() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const [showCreate, setShowCreate] = useState(false);
  const [extId, setExtId] = useState('');
  const [buId, setBuId] = useState('');
  const [createDetail, setCreateDetail] = useState(emptyDetail);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['equivalencies'], queryFn: () => equivalenciesApi.list() });
  const rows: Equivalency[] = (data?.data as Equivalency[]) ?? [];
  const { data: unisData } = useQuery({ queryKey: ['course-institutions'], queryFn: () => coursesApi.institutions() });
  const universities: University[] = (unisData?.data as University[]) ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['equivalencies'] });
  const payload = (d: typeof emptyDetail) => ({
    outcome: d.outcome,
    buCredits: d.buCredits ? Number(d.buCredits) : undefined,
    matchLevel: d.matchLevel || undefined,
    rationale: d.rationale || undefined,
    effectiveFrom: d.effectiveFrom || undefined,
    effectiveTo: d.effectiveTo || undefined,
  });

  const createMutation = useMutation({
    mutationFn: () => equivalenciesApi.create({ externalCourseId: Number(extId), buCourseId: Number(buId), ...payload(createDetail) }),
    onSuccess: () => {
      refresh();
      setShowCreate(false);
      setExtId('');
      setBuId('');
      setCreateDetail(emptyDetail);
      setError('');
    },
    onError: (e) => setError(errorText(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, d }: { id: number; d: typeof emptyDetail }) =>
      equivalenciesApi.update(id, {
        outcome: d.outcome,
        buCredits: d.buCredits ? Number(d.buCredits) : null,
        matchLevel: d.matchLevel || null,
        rationale: d.rationale || null,
        effectiveFrom: d.effectiveFrom || null,
        effectiveTo: d.effectiveTo || null,
      }),
    onSuccess: () => { refresh(); setError(''); },
    onError: (e) => setError(errorText(e)),
  });

  const setActive = useMutation({
    mutationFn: ({ ids, isActive }: { ids: number[]; isActive: boolean }) =>
      Promise.all(ids.map((id) => equivalenciesApi.update(id, { isActive }))),
    onSuccess: refresh,
  });

  const columns: DataTableColumn<Equivalency>[] = [
    { key: 'ext', header: 'Transfers in', sortValue: (r) => `${r.externalCourse.institutionCode} ${r.externalCourse.code}`, render: (r) => (
      <span><span className="font-medium">{r.externalCourse.institutionCode} {r.externalCourse.code}</span> <span className="text-gray-500">{r.externalCourse.title}</span></span>
    ) },
    { key: 'bu', header: 'Maps to', sortValue: (r) => `${r.buCourse.institutionCode} ${r.buCourse.code}`, render: (r) => (
      <span><span className="font-medium">{r.buCourse.institutionCode} {r.buCourse.code}</span> <span className="text-gray-500">{r.buCourse.title}</span></span>
    ) },
    { key: 'outcome', header: 'Outcome', render: (r) => OUTCOMES.find((o) => o.value === r.outcome)?.label ?? r.outcome },
    { key: 'buCredits', header: 'Credits', align: 'right', render: (r) => r.buCredits ?? '-' },
    { key: 'effectiveFrom', header: 'From', render: (r) => r.effectiveFrom ?? 'Always' },
    { key: 'effectiveTo', header: 'To', render: (r) => r.effectiveTo ?? 'Open' },
    { key: 'status', header: 'Status', render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span> },
    { key: 'actions', header: 'Actions', render: (r) => (
      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {r.isActive && can('courses', 'delete') && (
          <button onClick={() => setActive.mutate({ ids: [r.id], isActive: false })} className="flex items-center gap-1 text-xs text-red-500 hover:underline"><Power size={12} /> Deactivate</button>
        )}
        {!r.isActive && can('courses', 'edit') && (
          <button onClick={() => setActive.mutate({ ids: [r.id], isActive: true })} className="flex items-center gap-1 text-xs text-green-600 hover:underline"><Power size={12} /> Activate</button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="p-4 sm:p-6 w-[95%] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="text-brand-800" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Equivalencies</h1>
            <p className="text-sm text-gray-500">Which outside courses map to which receiving courses, and for which dates the mapping holds</p>
          </div>
        </div>
        {can('courses', 'create') && (
          <button onClick={() => setShowCreate((s) => !s)} className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900">
            <Plus size={16} /> Add equivalency
          </button>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {showCreate && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 space-y-4 max-w-3xl">
          <h2 className="font-semibold text-gray-900">Add equivalency</h2>
          <CoursePicker label="Course that transfers in" universities={universities} value={extId} onChange={setExtId} />
          <CoursePicker label="Receiving course it maps to" universities={universities} value={buId} onChange={setBuId} />
          <DetailFields form={createDetail} onChange={setCreateDetail} />
          <div className="flex gap-3">
            <button onClick={() => { setShowCreate(false); setError(''); }} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !extId || !buId}
              className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400">
              {createMutation.isPending ? 'Saving…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <DataTable<Equivalency>
        columns={columns}
        rows={rows}
        isLoading={isLoading}
        searchPlaceholder="Search courses…"
        searchKeys={['outcome', 'matchLevel']}
        filters={[
          { key: 'status', label: 'Status', options: (['current', 'upcoming', 'expired', 'inactive'] as const).map((s) => ({ value: s, label: s })) },
        ]}
        bulkActions={[
          ...(can('courses', 'edit') ? [{ label: 'Activate', onClick: (sel: Equivalency[]) => setActive.mutate({ ids: sel.map((r) => r.id), isActive: true }) }] : []),
          ...(can('courses', 'delete') ? [{ label: 'Deactivate', onClick: (sel: Equivalency[]) => setActive.mutate({ ids: sel.map((r) => r.id), isActive: false }), danger: true }] : []),
        ]}
        showExport={false}
        emptyMessage="No equivalencies found."
        renderExpanded={(r) => <EditRow row={r} canEdit={can('courses', 'edit')} saving={updateMutation.isPending} onSave={(d) => updateMutation.mutate({ id: r.id, d })} />}
      />
    </div>
  );
}

function EditRow({ row, canEdit, saving, onSave }: { row: Equivalency; canEdit: boolean; saving: boolean; onSave: (d: typeof emptyDetail) => void }) {
  const [d, setD] = useState({
    outcome: row.outcome,
    buCredits: row.buCredits != null ? String(row.buCredits) : '',
    matchLevel: row.matchLevel ?? '',
    rationale: row.rationale ?? '',
    effectiveFrom: row.effectiveFrom ?? '',
    effectiveTo: row.effectiveTo ?? '',
  });
  return (
    <div className="p-4 bg-gray-50 space-y-3 max-w-3xl">
      <DetailFields form={d} onChange={setD} />
      {canEdit && (
        <button onClick={() => onSave(d)} disabled={saving} className="px-4 py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      )}
    </div>
  );
}
