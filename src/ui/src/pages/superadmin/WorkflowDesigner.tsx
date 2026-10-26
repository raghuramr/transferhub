import { useAuthStore } from '../../store/auth';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BarChart3, Bot, GitBranch, Loader2, Plus, Save, Sparkles, Trash2, Users, X } from 'lucide-react';
import { universitiesApi, workflowsApi } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/cn';
import ReadinessCard from '../../components/workflow/ReadinessCard';
import TransferRulesTab from '../../components/policy/TransferRulesTab';
import type { AgentTask, ApproverGroup, StageApprover, StageType, StaffUser, WorkflowDetail, WorkflowStageDef } from '../../types/workflow';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};

const STAGE_TYPES: { value: StageType; label: string; help: string }[] = [
  { value: 'system', label: 'Automatic', help: 'Runs by itself (rules check, AI pre-match, finalise). No approver.' },
  { value: 'review', label: 'Review', help: 'A person reviews the AI brief and approves or rejects.' },
  { value: 'approval', label: 'Approval', help: 'A sign-off step (dean, finance, registrar).' },
];
const AGENT_TASKS: { value: AgentTask; label: string }[] = [
  { value: 'none', label: 'Nothing (just a milestone)' },
  { value: 'intake', label: 'Intake: check the document checklist' },
  { value: 'match', label: 'AI pre-match unmatched courses' },
  { value: 'finalize', label: 'Finalise: post credit, notify student' },
];
const ALL_ROLES = [
  { value: 'faculty', label: 'All faculty' },
  { value: 'admin', label: 'All admins' },
  { value: 'super_admin', label: 'All super admins' },
];

const blankStage = (): WorkflowStageDef => ({
  name: 'New stage', description: '', stageType: 'approval', agentTask: 'none', slaDays: 3,
  isEnabled: true, canBypass: true, requiresComment: false, autoApprove: false, autoApproveMinConfidence: null, approvers: [],
});

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-sm text-gray-700', disabled && 'opacity-50')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-800 focus:ring-brand-500" />
      {label}
    </label>
  );
}

function ApproverEditor({ stage, onChange, groups, staff, disabled }: {
  stage: WorkflowStageDef; onChange: (a: StageApprover[]) => void; groups: ApproverGroup[]; staff: StaffUser[]; disabled: boolean;
}) {
  const isSuper = useAuthStore((st) => st.user?.role === 'super_admin');
  const roleOptions = isSuper ? ALL_ROLES : ALL_ROLES.filter((r) => r.value !== 'super_admin');
  const [kind, setKind] = useState<'role' | 'group' | 'user'>('group');
  const [value, setValue] = useState('');
  const label = (a: StageApprover) =>
    a.approverType === 'role' ? ALL_ROLES.find((r) => r.value === a.roleName)?.label ?? a.roleName
      : a.approverType === 'group' ? `Group: ${groups.find((g) => g.id === a.groupId)?.name ?? a.groupName}`
        : staff.find((u) => u.id === a.userId)?.name ?? a.userName;

  const add = () => {
    if (!value) return;
    const next: StageApprover =
      kind === 'role' ? { approverType: 'role', roleName: value }
        : kind === 'group' ? { approverType: 'group', groupId: Number(value) }
          : { approverType: 'user', userId: value };
    const dup = stage.approvers.some((a) => a.approverType === next.approverType && a.roleName === next.roleName && a.groupId === next.groupId && a.userId === next.userId);
    if (!dup) onChange([...stage.approvers, next]);
    setValue('');
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500"><Users size={13} /> Who can act on this stage</div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {stage.approvers.length === 0 && <span className="text-xs text-amber-600">No one assigned — only admins can act until you add approvers.</span>}
        {stage.approvers.map((a, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
            {label(a)}
            {!disabled && <button type="button" onClick={() => onChange(stage.approvers.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500" aria-label="Remove"><X size={12} /></button>}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setValue(''); }} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="group">Group</option><option value="role">Role</option><option value="user">Person</option>
          </select>
          <select value={value} onChange={(e) => setValue(e.target.value)} className="min-w-[10rem] rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Choose…</option>
            {kind === 'role' && roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            {kind === 'group' && groups.filter((g) => g.isActive).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members.length})</option>)}
            {kind === 'user' && staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
          <button type="button" onClick={add} disabled={!value} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Add</button>
        </div>
      )}
    </div>
  );
}

function StageCard({ stage, index, total, onChange, onMove, onRemove, groups, staff, disabled }: {
  stage: WorkflowStageDef; index: number; total: number; onChange: (s: WorkflowStageDef) => void;
  onMove: (dir: -1 | 1) => void; onRemove: () => void; groups: ApproverGroup[]; staff: StaffUser[]; disabled: boolean;
}) {
  const system = stage.stageType === 'system';
  const set = (patch: Partial<WorkflowStageDef>) => onChange({ ...stage, ...patch });
  return (
    <div className={cn('rounded-xl border bg-white p-4 shadow-sm', stage.isEnabled ? 'border-gray-200' : 'border-dashed border-gray-300 bg-gray-50')}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-800 text-sm font-semibold text-white">{index + 1}</div>
        <div className="min-w-[12rem] flex-1 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={stage.name} disabled={disabled} onChange={(e) => set({ name: e.target.value })} maxLength={120}
              className="min-w-[10rem] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <select value={stage.stageType} disabled={disabled}
              onChange={(e) => { const t = e.target.value as StageType; set({ stageType: t, agentTask: t === 'system' ? stage.agentTask : 'none', approvers: t === 'system' ? [] : stage.approvers }); }}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              {STAGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <input value={stage.description ?? ''} disabled={disabled} onChange={(e) => set({ description: e.target.value })} maxLength={500} placeholder="What happens at this stage (shown to the student)"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />

          {system ? (
            <label className="block text-xs font-medium text-gray-500">
              <span className="mb-1 flex items-center gap-1"><Bot size={13} /> Automatic task</span>
              <select value={stage.agentTask} disabled={disabled} onChange={(e) => set({ agentTask: e.target.value as AgentTask })} className="w-full max-w-sm rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-800">
                {AGENT_TASKS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          ) : (
            <ApproverEditor stage={stage} onChange={(approvers) => set({ approvers })} groups={groups} staff={staff} disabled={disabled} />
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Toggle checked={stage.isEnabled} disabled={disabled} onChange={(v) => set({ isEnabled: v })} label="Enabled" />
            {!system && <Toggle checked={stage.canBypass} disabled={disabled} onChange={(v) => set({ canBypass: v })} label="Admin may skip this stage" />}
            {!system && <Toggle checked={stage.requiresComment} disabled={disabled} onChange={(v) => set({ requiresComment: v })} label="Comment required" />}
            {!system && (
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                Due within
                <input type="number" min={1} max={365} disabled={disabled} value={stage.slaDays ?? ''} onChange={(e) => set({ slaDays: e.target.value ? Number(e.target.value) : null })}
                  className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm" /> days
              </label>
            )}
          </div>

          {!system && (
            <div className={cn('rounded-lg border p-3', stage.autoApprove ? 'border-indigo-200 bg-indigo-50/60' : 'border-gray-200 bg-gray-50/60')}>
              <Toggle
                checked={!!stage.autoApprove}
                disabled={disabled}
                onChange={(v) => set({ autoApprove: v, autoApproveMinConfidence: v ? stage.autoApproveMinConfidence ?? 0.85 : null })}
                label="Let the agent approve this stage automatically when everything lines up"
              />
              <p className="mt-1 text-xs text-gray-500">
                The agent accepts every course match above the confidence below. If that leaves nothing flagged (documents complete, no unmatched or ineligible courses) it approves the stage itself and the request moves on;
                otherwise a person reviews as usual. It never rejects. Recommended for early review stages, not the final sign-off.
              </p>
              {stage.autoApprove && (
                <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
                  <Sparkles size={14} className="text-indigo-600" /> Minimum match confidence
                  <select
                    disabled={disabled}
                    value={stage.autoApproveMinConfidence ?? 0.85}
                    onChange={(e) => set({ autoApproveMinConfidence: Number(e.target.value) })}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                  >
                    {[0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
        {!disabled && (
          <div className="flex flex-col gap-1">
            <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="rounded border border-gray-200 p-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30" aria-label="Move up"><ArrowUp size={14} /></button>
            <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className="rounded border border-gray-200 p-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30" aria-label="Move down"><ArrowDown size={14} /></button>
            <button type="button" onClick={onRemove} className="rounded border border-gray-200 p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete stage"><Trash2 size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupsTab({ groups, staff, canEdit }: { groups: ApproverGroup[]; staff: StaffUser[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ApproverGroup | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const save = useMutation({
    mutationFn: (g: ApproverGroup) => workflowsApi.saveGroup(g.id || null, { name: g.name, description: g.description ?? undefined, isActive: g.isActive, memberUserIds: g.members.map((m) => m.userId) }),
    onSuccess: () => { setEditing(null); setError(''); void qc.invalidateQueries({ queryKey: ['workflow-lookups'] }); },
    onError: (e) => setError(errMsg(e, 'Could not save the group.')),
  });
  const remove = useMutation({
    mutationFn: (id: number) => workflowsApi.removeGroup(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workflow-lookups'] }),
  });
  const toggleMember = (u: StaffUser) => {
    if (!editing) return;
    const has = editing.members.some((m) => m.userId === u.id);
    setEditing({ ...editing, members: has ? editing.members.filter((m) => m.userId !== u.id) : [...editing.members, { userId: u.id, name: u.name, email: u.email }] });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        {canEdit && (
          <button type="button" onClick={() => setEditing({ id: 0, name: '', description: '', institutionId: null, isActive: true, members: [] })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-900"><Plus size={15} /> New group</button>
        )}
        {groups.map((g) => (
          <div key={g.id} className={cn('rounded-xl border bg-white p-4', editing?.id === g.id ? 'border-brand-400' : 'border-gray-200', !g.isActive && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-gray-900">{g.name}{!g.isActive && <span className="ml-2 text-xs font-normal text-gray-400">inactive</span>}</div>
                {g.description && <div className="text-xs text-gray-500">{g.description}</div>}
              </div>
              {canEdit && (
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setEditing(g)} className="font-medium text-brand-800 hover:underline">Edit</button>
                  <button type="button" onClick={() => window.confirm(`Delete "${g.name}"?`) && remove.mutate(g.id)} className="text-gray-400 hover:text-red-600">Delete</button>
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.members.length === 0 && <span className="text-xs text-amber-600">No members yet.</span>}
              {g.members.map((m) => <span key={m.userId} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{m.name}</span>)}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="h-fit rounded-xl border border-brand-300 bg-white p-4">
          <h3 className="mb-3 font-semibold text-gray-900">{editing.id ? 'Edit group' : 'New group'}</h3>
          <div className="space-y-3">
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Group name" maxLength={150} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="What this group does" maxLength={500} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <Toggle checked={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} label="Active" />
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">Members ({editing.members.length})</div>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search staff…" className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
              <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                {staff.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(filter.toLowerCase())).map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
                      <input type="checkbox" checked={editing.members.some((m) => m.userId === u.id)} onChange={() => toggleMember(u)} className="h-4 w-4 rounded border-gray-300 text-brand-800" />
                      <span className="flex-1">{u.name}</span>
                      <span className="text-xs text-gray-400">{u.role}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setEditing(null); setError(''); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700">Cancel</button>
              <button type="button" disabled={!editing.name.trim() || save.isPending} onClick={() => save.mutate(editing)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3.5 py-1.5 text-sm font-medium text-white disabled:bg-brand-300">
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightsTab() {
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: ['workflow-insights', days], queryFn: () => workflowsApi.insights(days) });
  const d = q.data?.data;
  if (q.isLoading || !d) return <p className="text-gray-400">Loading…</p>;
  const maxHours = Math.max(1, ...d.stages.map((s) => s.avgHours ?? 0));
  const fmtHours = (h: number | null) => (h == null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
  const stat = (label: string, value: string | number, tone = 'text-gray-900') => (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={cn('text-2xl font-bold', tone)}>{value}</div>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">How requests move through your stages, so you can see where they wait.</p>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
          {[30, 90, 180, 365].map((v) => <option key={v} value={v}>Last {v} days</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {stat('Requests', d.totals.requests)}
        {stat('In progress', d.totals.active, 'text-brand-800')}
        {stat('Approved', d.totals.approved + d.totals.bypassed, 'text-emerald-700')}
        {stat('Rejected', d.totals.rejected, 'text-red-600')}
        {stat('Auto-approved stages', d.totals.autoApprovedStages, 'text-indigo-600')}
        {stat('Avg time to finish', d.totals.avgDaysToComplete == null ? '—' : `${d.totals.avgDaysToComplete.toFixed(1)} d`)}
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Time spent at each stage</h3>
        {d.stages.length === 0 ? <p className="text-sm text-gray-400">No requests have reached an approval stage in this period.</p> : (
          <div className="space-y-3">
            {d.stages.map((s) => (
              <div key={s.stageKey}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-gray-800">{s.name}</span>
                  <span className="text-xs text-gray-500">
                    {s.completed} done · {s.activeNow} waiting now
                    {s.overdueNow > 0 && <span className="font-medium text-red-600"> · {s.overdueNow} overdue</span>}
                    {s.late > 0 && <> · {s.late} finished late</>}
                    {s.skipped > 0 && <> · {s.skipped} skipped</>}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className={cn('h-full rounded-full', s.overdueNow > 0 ? 'bg-red-400' : 'bg-brand-600')} style={{ width: `${((s.avgHours ?? 0) / maxHours) * 100}%` }} />
                  </div>
                  <span className="w-20 text-right text-xs font-medium text-gray-700">{fmtHours(s.avgHours)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function WorkflowDesigner() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can('workflows', 'edit');
  const canCreate = can('workflows', 'create');
  const [tab, setTab] = useState<'workflows' | 'groups' | 'rules' | 'insights'>('workflows');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<WorkflowDetail | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [newUni, setNewUni] = useState('');

  const list = useQuery({ queryKey: ['workflows'], queryFn: () => workflowsApi.list() });
  const lookups = useQuery({ queryKey: ['workflow-lookups'], queryFn: () => workflowsApi.lookups() });
  const universities = useQuery({ queryKey: ['md-universities'], queryFn: () => universitiesApi.list({ isActive: true }) });
  const detail = useQuery({ queryKey: ['workflow', selectedId], queryFn: () => workflowsApi.get(selectedId!), enabled: selectedId != null });

  const workflows = list.data?.data ?? [];
  const groups = lookups.data?.data.groups ?? [];
  const staff = lookups.data?.data.staff ?? [];
  const unis = (universities.data?.data as { id: number; name: string }[] | undefined) ?? [];
  const usedUniIds = useMemo(() => new Set(workflows.map((w) => w.institutionId)), [workflows]);

  useEffect(() => { if (selectedId == null && workflows.length) setSelectedId(workflows[0].id); }, [workflows, selectedId]);
  useEffect(() => { if (detail.data) { setDraft(structuredClone(detail.data.data)); setDirty(false); setError(''); } }, [detail.data]);

  const change = (patch: Partial<WorkflowDetail>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setDirty(true); setSaved(false); };
  const setStage = (i: number, s: WorkflowStageDef) => draft && change({ stages: draft.stages.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, dir: -1 | 1) => {
    if (!draft) return;
    const stages = [...draft.stages];
    [stages[i], stages[i + dir]] = [stages[i + dir], stages[i]];
    change({ stages });
  };

  const save = useMutation({
    mutationFn: () => workflowsApi.save(draft!.id, {
      name: draft!.name, description: draft!.description, allowBypass: draft!.allowBypass, isActive: draft!.isActive,
      // The API rejects unknown properties, so send only the editable fields (not stageKey/stageOrder or approver display names).
      stages: draft!.stages.map((st) => ({
        id: st.id,
        name: st.name,
        description: st.description ?? undefined,
        stageType: st.stageType,
        agentTask: st.agentTask,
        slaDays: st.slaDays,
        isEnabled: st.isEnabled,
        canBypass: st.canBypass,
        requiresComment: st.requiresComment,
        autoApprove: st.stageType !== 'system' && !!st.autoApprove,
        autoApproveMinConfidence: st.stageType !== 'system' && st.autoApprove ? st.autoApproveMinConfidence ?? 0.85 : null,
        approvers: st.approvers.map((a) => ({
          approverType: a.approverType,
          roleName: a.roleName ?? undefined,
          groupId: a.groupId ?? undefined,
          userId: a.userId ?? undefined,
        })),
      })),
      requiredDocs: draft!.documents.filter((d) => d.offered).map((d) => ({ docTypeKey: d.docTypeKey, isRequired: d.isRequired })),
    }),
    onSuccess: (res) => { setDraft(structuredClone(res.data)); setDirty(false); setSaved(true); setError(''); void qc.invalidateQueries({ queryKey: ['workflows'] }); void qc.invalidateQueries({ queryKey: ['workflow', selectedId] }); },
    onError: (e) => setError(errMsg(e, 'Could not save the workflow.')),
  });
  const create = useMutation({
    mutationFn: () => workflowsApi.create({ institutionId: Number(newUni), name: `${unis.find((u) => u.id === Number(newUni))?.name ?? 'University'} workflow` }),
    onSuccess: (res) => { setNewUni(''); void qc.invalidateQueries({ queryKey: ['workflows'] }); setSelectedId(res.data.id); },
    onError: (e) => setError(errMsg(e, 'Could not create the workflow.')),
  });
  const remove = useMutation({
    mutationFn: (id: number) => workflowsApi.remove(id),
    onSuccess: () => { setSelectedId(null); void qc.invalidateQueries({ queryKey: ['workflows'] }); },
    onError: (e) => setError(errMsg(e, 'Could not delete the workflow.')),
  });

  return (
    <div className="mx-auto w-[95%] max-w-6xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><GitBranch size={24} /> Approval workflows</h1>
        <p className="mt-1 text-gray-500">Define the stages a transfer request goes through for each intaking university, and who approves each one. A university without its own workflow uses the global default.</p>
      </div>

      <div className="mb-6 inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
        {(['workflows', 'groups', 'rules', 'insights'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn('inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 font-medium', tab === t ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-50')}>
            {t === 'insights' && <BarChart3 size={14} />}
            {t === 'workflows' ? 'Workflows' : t === 'groups' ? 'Approver groups' : t === 'rules' ? 'Transfer rules' : 'Insights'}
          </button>
        ))}
      </div>

      <ReadinessCard />

      {tab === 'insights' ? (
        <InsightsTab />
      ) : tab === 'rules' ? (
        <TransferRulesTab />
      ) : tab === 'groups' ? (
        <GroupsTab groups={groups} staff={staff} canEdit={canEdit} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <aside className="space-y-2">
            {workflows.map((w) => (
              <button key={w.id} type="button" onClick={() => setSelectedId(w.id)}
                className={cn('w-full rounded-xl border p-3 text-left transition', selectedId === w.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white hover:border-gray-300', !w.isActive && 'opacity-60')}>
                <div className="text-sm font-semibold text-gray-900">{w.institutionName ?? 'Global default'}</div>
                <div className="text-xs text-gray-500">{w.stageCount} stages{w.activeRequests > 0 && ` · ${w.activeRequests} in progress`}{!w.isActive && ' · inactive'}</div>
              </button>
            ))}
            {canCreate && (
              <div className="rounded-xl border border-dashed border-gray-300 p-3">
                <div className="mb-1.5 text-xs font-medium text-gray-500">Add a university workflow</div>
                <select value={newUni} onChange={(e) => setNewUni(e.target.value)} className="mb-2 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Choose a university…</option>
                  {unis.filter((u) => !usedUniIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button type="button" disabled={!newUni || create.isPending} onClick={() => create.mutate()} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white disabled:bg-brand-300">
                  {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Copy from default
                </button>
              </div>
            )}
          </aside>

          <section>
            {!draft && <p className="text-gray-400">{detail.isLoading ? 'Loading…' : 'Select a workflow.'}</p>}
            {draft && (
              <div className="space-y-5">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium text-gray-500">Name
                      <input value={draft.name} disabled={!canEdit} onChange={(e) => change({ name: e.target.value })} maxLength={150} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
                    </label>
                    <label className="text-xs font-medium text-gray-500">Description
                      <input value={draft.description ?? ''} disabled={!canEdit} onChange={(e) => change({ description: e.target.value })} maxLength={500} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                    <Toggle checked={draft.allowBypass} disabled={!canEdit} onChange={(v) => change({ allowBypass: v })} label="Admins may accept a request directly (bypass all remaining stages)" />
                    <Toggle checked={draft.isActive} disabled={!canEdit} onChange={(v) => change({ isActive: v })} label="Active" />
                  </div>
                </div>

                <div className="space-y-3">
                  {draft.stages.map((s, i) => (
                    <StageCard key={s.id ?? `new-${i}`} stage={s} index={i} total={draft.stages.length} groups={groups} staff={staff} disabled={!canEdit}
                      onChange={(ns) => setStage(i, ns)} onMove={(d) => move(i, d)}
                      onRemove={() => window.confirm(`Remove "${s.name}"? Requests already past it keep their history.`) && change({ stages: draft.stages.filter((_, j) => j !== i) })} />
                  ))}
                  {canEdit && (
                    <button type="button" onClick={() => change({ stages: [...draft.stages, blankStage()] })} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                      <Plus size={15} /> Add stage
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Documents students are asked for</h3>
                  <p className="mb-3 text-xs text-gray-500">Required documents are flagged in the reviewer's brief when missing.</p>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {draft.documents.map((d) => (
                      <li key={d.docTypeKey} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                        <Toggle checked={d.offered} disabled={!canEdit} onChange={(v) => change({ documents: draft.documents.map((x) => (x.docTypeKey === d.docTypeKey ? { ...x, offered: v, isRequired: v ? x.isRequired : false } : x)) })} label={d.label} />
                        <Toggle checked={d.isRequired} disabled={!canEdit || !d.offered} onChange={(v) => change({ documents: draft.documents.map((x) => (x.docTypeKey === d.docTypeKey ? { ...x, isRequired: v } : x)) })} label="Required" />
                      </li>
                    ))}
                  </ul>
                </div>

                {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                {canEdit && (
                  <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                    <div className="text-sm text-gray-500">{saved ? 'Saved.' : dirty ? 'You have unsaved changes.' : 'No changes.'}</div>
                    <div className="flex gap-2">
                      {draft.institutionId != null && (
                        <button type="button" onClick={() => window.confirm('Delete this workflow? If it has request history it is deactivated instead.') && remove.mutate(draft.id)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-700">Delete</button>
                      )}
                      <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-300">
                        {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save workflow
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
