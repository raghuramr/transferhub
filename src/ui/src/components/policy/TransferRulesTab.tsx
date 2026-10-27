import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save } from 'lucide-react';
import { policiesApi, universitiesApi } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/cn';
import type { TransferPolicy } from '../../types/policy';
import ExamCreditRulesCard from './ExamCreditRulesCard';

const GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];
const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50';
const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};

/** Per-university transfer-credit rules (BU's published policy is the global default). */
export default function TransferRulesTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can('workflows', 'edit');
  const list = useQuery({ queryKey: ['policies'], queryFn: () => policiesApi.list() });
  const unis = useQuery({ queryKey: ['md-universities'], queryFn: () => universitiesApi.list({ isActive: true }) });
  const [scope, setScope] = useState<number | null>(null);
  const [draft, setDraft] = useState<TransferPolicy | null>(null);
  const [msg, setMsg] = useState('');
  const [newUni, setNewUni] = useState('');

  const rows = list.data?.data ?? [];
  const overrides = rows.filter((r) => r.institutionId != null);
  const uniList = (unis.data?.data as { id: number; name: string }[] | undefined) ?? [];
  useEffect(() => {
    const r = rows.find((x) => x.institutionId === scope);
    if (r) setDraft({ ...r });
  }, [list.data, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<TransferPolicy>) => { setDraft((d) => (d ? { ...d, ...p } : d)); setMsg(''); };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['policies'] });
  const save = useMutation({
    mutationFn: () => {
      const { id: _i, institutionName: _n, institutionId: _x, ...rest } = draft!;
      return policiesApi.save({ ...rest, institutionId: scope });
    },
    onSuccess: () => { setMsg('Saved. New and re-checked requests use these rules.'); refresh(); },
    onError: (e) => setMsg(errMsg(e, 'Could not save.')),
  });
  const add = useMutation({
    mutationFn: () => policiesApi.save({ institutionId: Number(newUni) }),
    onSuccess: () => { setScope(Number(newUni)); setNewUni(''); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: number) => policiesApi.removeOverride(id), onSuccess: () => { setScope(null); refresh(); } });

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-2">
        <button type="button" onClick={() => setScope(null)} className={cn('w-full rounded-xl border p-3 text-left text-sm font-semibold', scope == null ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white')}>
          Global (BU policy)
        </button>
        {overrides.map((o) => (
          <button key={o.institutionId} type="button" onClick={() => setScope(o.institutionId)} className={cn('w-full rounded-xl border p-3 text-left text-sm', scope === o.institutionId ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white')}>
            <div className="font-semibold text-gray-900">{o.institutionName}</div>
            <div className="text-xs text-gray-500">Min {o.minGrade} · cap {o.capTransfer}</div>
          </button>
        ))}
        {canEdit && (
          <div className="rounded-xl border border-dashed border-gray-300 p-3">
            <div className="mb-1.5 text-xs font-medium text-gray-500">Different rules for a university</div>
            <select value={newUni} onChange={(e) => setNewUni(e.target.value)} className="mb-2 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Choose…</option>
              {uniList.filter((u) => !overrides.some((o) => o.institutionId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button type="button" disabled={!newUni} onClick={() => add.mutate()} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white disabled:bg-brand-300"><Plus size={14} /> Add</button>
          </div>
        )}
      </aside>

      {!draft ? <p className="text-gray-400">Loading…</p> : (
        <div className="space-y-5">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-1 font-semibold text-gray-900">Eligibility</h3>
            <p className="mb-4 text-xs text-gray-500">Applied automatically to every course when a request arrives. Anything the rules cannot settle goes to a reviewer; nothing is approved by these rules alone.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">Minimum grade
                <select disabled={!canEdit} value={draft.minGrade} onChange={(e) => set({ minGrade: e.target.value })} className={inputCls}>
                  {GRADES.map((g) => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-gray-700">Courses older than (years) need review
                <input disabled={!canEdit} type="number" min={1} max={50} value={draft.maxCourseAgeYears ?? ''} onChange={(e) => set({ maxCourseAgeYears: e.target.value ? Number(e.target.value) : null })} className={inputCls} placeholder="No limit" />
              </label>
            </div>
            <div className="mt-4 space-y-2 text-sm text-gray-700">
              <label className="flex items-start gap-2"><input type="checkbox" disabled={!canEdit} checked={draft.allowPassFail} onChange={(e) => set({ allowPassFail: e.target.checked })} className="mt-0.5 h-4 w-4" />
                <span>Accept Pass/Fail and S/U grades <span className="block text-xs text-gray-500">Off (BU policy): they go to review; Spring 2020 and college-required P/F are exceptions.</span></span></label>
              <label className="flex items-start gap-2"><input type="checkbox" disabled={!canEdit} checked={draft.requireAccreditation} onChange={(e) => set({ requireAccreditation: e.target.checked })} className="mt-0.5 h-4 w-4" />
                <span>Require a regionally accredited sending institution</span></label>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-1 font-semibold text-gray-900">Limits on outside credit</h3>
            <p className="mb-4 text-xs text-gray-500">Transfer courses plus AP, IB and A-level count together. Courses beyond the limit are flagged for review.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="text-sm font-medium text-gray-700">Transfer students<input disabled={!canEdit} type="number" value={draft.capTransfer} onChange={(e) => set({ capTransfer: Number(e.target.value) })} className={inputCls} /></label>
              <label className="text-sm font-medium text-gray-700">First-year / dual enrollment<input disabled={!canEdit} type="number" value={draft.capFirstYear} onChange={(e) => set({ capFirstYear: Number(e.target.value) })} className={inputCls} /></label>
              <label className="text-sm font-medium text-gray-700">Current students<input disabled={!canEdit} type="number" value={draft.capCurrentStudent} onChange={(e) => set({ capCurrentStudent: Number(e.target.value) })} className={inputCls} /></label>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-1 font-semibold text-gray-900">Credit deadline</h3>
            <p className="mb-4 text-xs text-gray-500">All transfer credit must be transferred within this many months of the student starting (their entry term). Courses still undecided after the deadline are flagged for review, never denied automatically. Previews are exempt.</p>
            <label className="block max-w-xs text-sm font-medium text-gray-700">Months allowed
              <input disabled={!canEdit} type="number" min={1} max={120} value={draft.creditDeadlineMonths ?? 12} onChange={(e) => set({ creditDeadlineMonths: Number(e.target.value) })} className={inputCls} />
            </label>
          </div>
          <ExamCreditRulesCard institutionId={scope} canEdit={canEdit} />
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-1 font-semibold text-gray-900">BU Hub</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">Hub requirements for transfer students<input disabled={!canEdit} type="number" value={draft.hubRequirementsTransfer} onChange={(e) => set({ hubRequirementsTransfer: Number(e.target.value) })} className={inputCls} /></label>
              <label className="text-sm font-medium text-gray-700">Of which may be cocurricular<input disabled={!canEdit} type="number" value={draft.hubCocurricularAllowed} onChange={(e) => set({ hubCocurricularAllowed: Number(e.target.value) })} className={inputCls} /></label>
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
              <span className="text-sm text-gray-500">{msg}</span>
              <div className="flex gap-2">
                {scope != null && <button type="button" onClick={() => window.confirm('Remove this university\'s own rules and use the global ones?') && remove.mutate(scope)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Remove override</button>}
                <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white disabled:bg-brand-300">
                  {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save rules
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
