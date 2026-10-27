import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { policiesApi } from '../../lib/api';
import type { ExamCreditRule } from '../../types/policy';

const EXAMS: ExamCreditRule['examType'][] = ['AP', 'IB', 'A-level', 'CLEP'];
const SCALE: Record<string, string> = { AP: '1-5', IB: '1-7', 'A-level': 'A*-E', CLEP: '20-80' };
const inputCls = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50';
const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};

const blank = (institutionId: number | null): ExamCreditRule => ({
  id: null, institutionId, examType: 'AP', subjectPattern: null, minScore: '3', creditsAwarded: null, isActive: true,
});

function RuleRow({ rule, canEdit, onSave, onRemove, busy }: { rule: ExamCreditRule; canEdit: boolean; busy: boolean; onSave: (r: ExamCreditRule) => void; onRemove?: (r: ExamCreditRule) => void }) {
  const [d, setD] = useState(rule);
  useEffect(() => setD(rule), [rule]);
  const dirty = JSON.stringify(d) !== JSON.stringify(rule);
  const set = (p: Partial<ExamCreditRule>) => setD((x) => ({ ...x, ...p }));
  return (
    <div data-testid="exam-rule-row" className="grid grid-cols-2 items-end gap-2 rounded-lg border border-gray-100 bg-gray-50/50 p-3 sm:grid-cols-[6rem_1fr_6rem_6rem_auto_auto]">
      <label className="text-xs font-medium text-gray-600">Exam
        <select disabled={!canEdit} value={d.examType} onChange={(e) => set({ examType: e.target.value as ExamCreditRule['examType'] })} className={inputCls}>
          {EXAMS.map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label className="col-span-2 text-xs font-medium text-gray-600 sm:col-span-1">Subject (blank = any)
        <input disabled={!canEdit} value={d.subjectPattern ?? ''} onChange={(e) => set({ subjectPattern: e.target.value || null })} placeholder="e.g. HL|Higher Level" className={inputCls} />
      </label>
      <label className="text-xs font-medium text-gray-600">Min. score ({SCALE[d.examType]})
        <input disabled={!canEdit} value={d.minScore} onChange={(e) => set({ minScore: e.target.value })} className={inputCls} />
      </label>
      <label className="text-xs font-medium text-gray-600">Credits
        <input disabled={!canEdit} type="number" min={0} step="0.5" value={d.creditsAwarded ?? ''} onChange={(e) => set({ creditsAwarded: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Reviewer" className={inputCls} />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-xs text-gray-600">
        <input type="checkbox" disabled={!canEdit} checked={d.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="h-4 w-4" /> Active
      </label>
      {canEdit && (
        <div className="flex items-center gap-1.5 pb-0.5">
          <button type="button" disabled={busy || (!dirty && d.id != null)} onClick={() => onSave(d)} className="inline-flex items-center gap-1 rounded-lg bg-brand-800 px-2.5 py-1.5 text-xs font-medium text-white disabled:bg-brand-300"><Save size={12} /> Save</button>
          {onRemove && d.id != null && <button type="button" onClick={() => window.confirm('Remove this rule?') && onRemove(d)} aria-label="Remove rule" className="rounded-lg border border-gray-300 p-1.5 text-gray-500 hover:text-red-600"><Trash2 size={13} /></button>}
        </div>
      )}
    </div>
  );
}

/**
 * Minimum scores for AP / IB / CLEP / A-level credit, for the selected university (null = global default).
 * An exam below its minimum is not counted toward the external-credit cap; it is flagged, never silently denied.
 */
export default function ExamCreditRulesCard({ institutionId, canEdit }: { institutionId: number | null; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exam-rules', institutionId], queryFn: () => policiesApi.examRules(institutionId) });
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState<ExamCreditRule | null>(null);
  const all = q.data?.data ?? [];
  const own = all.filter((r) => r.institutionId === institutionId);
  const globals = all.filter((r) => r.institutionId == null);
  const inheriting = institutionId != null && own.length === 0;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['exam-rules'] });

  const save = useMutation({
    mutationFn: (r: ExamCreditRule) => {
      const { institutionName: _n, ...rest } = r;
      return policiesApi.saveExamRule({ ...rest, institutionId });
    },
    onSuccess: () => { setMsg('Saved.'); setAdding(null); refresh(); },
    onError: (e) => setMsg(errMsg(e, 'Could not save the rule.')),
  });
  const remove = useMutation({ mutationFn: (r: ExamCreditRule) => policiesApi.removeExamRule(r.id!), onSuccess: () => { setMsg('Removed.'); refresh(); }, onError: (e) => setMsg(errMsg(e, 'Could not remove the rule.')) });
  const copyGlobals = useMutation({
    mutationFn: async () => { for (const g of globals) await policiesApi.saveExamRule({ ...g, id: null, institutionId, institutionName: undefined }); },
    onSuccess: () => { setMsg('Copied. Edit the copies below.'); refresh(); },
    onError: (e) => setMsg(errMsg(e, 'Could not copy the global rules.')),
  });

  return (
    <div data-testid="exam-credit-card" className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-1 font-semibold text-gray-900">Exam credit</h3>
      <p className="mb-4 text-xs text-gray-500">
        Minimum score for AP, IB, CLEP and A-level credit. An exam below its minimum does not count toward the outside-credit limit and is shown to reviewers as &quot;not counted&quot;; a reviewer can still award credit by hand.
        If a university has its own rules for an exam type, only those apply to it. These are defaults - confirm with the university.
      </p>
      {q.isLoading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="space-y-2">
          {inheriting && (
            <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
              This university uses the global rules below.
              {canEdit && <button type="button" disabled={copyGlobals.isPending} onClick={() => copyGlobals.mutate()} className="ml-2 font-medium text-brand-800 hover:underline">Customize for this university</button>}
            </div>
          )}
          {(inheriting ? globals : own).map((r) => (
            <RuleRow key={r.id ?? `${r.examType}-${r.subjectPattern}`} rule={r} canEdit={canEdit && !inheriting} busy={save.isPending} onSave={(x) => save.mutate(x)} onRemove={(x) => remove.mutate(x)} />
          ))}
          {!inheriting && own.length === 0 && <p className="text-sm text-gray-400">No rules yet: every exam goes to a reviewer.</p>}
          {adding && <RuleRow rule={adding} canEdit busy={save.isPending} onSave={(x) => save.mutate(x)} />}
        </div>
      )}
      {canEdit && !inheriting && !adding && (
        <button type="button" onClick={() => setAdding(blank(institutionId))} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-800 hover:underline"><Plus size={14} /> Add a rule</button>
      )}
      {(save.isPending || copyGlobals.isPending) && <Loader2 size={14} className="mt-2 animate-spin text-gray-400" />}
      {msg && <p className="mt-2 text-xs text-gray-500">{msg}</p>}
    </div>
  );
}
