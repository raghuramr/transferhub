import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Coins, Database, Gauge, Loader2, Plus, Save, Sparkles, Trash2, Zap } from 'lucide-react';
import { aiControlsApi, universitiesApi } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/cn';
import ReadinessCard from '../../components/workflow/ReadinessCard';
import MatcherAccuracyCard from '../../components/workflow/MatcherAccuracyCard';
import type { AgentSkill, AiSettings } from '../../types/workflow';

type Tab = 'usage' | 'settings' | 'providers' | 'playbook' | 'requests';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};
const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
const usd = (n: number | null | undefined) => `$${(n ?? 0).toFixed(n && n < 1 ? 4 : 2)}`;

const MODELS = [
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5: cheapest, good for most matches' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5: balanced' },
  { value: 'claude-opus-4-5', label: 'Opus 4.5: strongest, most expensive' },
];

const CATEGORY_LABEL: Record<AgentSkill['category'], string> = {
  matching: 'Matching', policy: 'Policy', token_saving: 'Token saving', documents: 'Document reading',
};

const PRESETS: { key: string; label: string; blurb: string; values: Partial<AiSettings> }[] = [
  {
    key: 'economy', label: 'Economy', blurb: 'Lowest spend. Cheap model, small shortlist, no escalation.',
    values: { matchModel: 'claude-haiku-4-5', escalationModel: null, escalateBelowConfidence: 0.5, prefilterTopN: 5, maxDescriptionChars: 300, useTopics: false, useResultCache: true, usePromptCaching: true, maxOutputTokens: 400, narrativeBriefEnabled: false },
  },
  {
    key: 'balanced', label: 'Balanced', blurb: 'Recommended. Cheap first pass, stronger model only when unsure.',
    values: { matchModel: 'claude-haiku-4-5', escalationModel: 'claude-sonnet-4-5', escalateBelowConfidence: 0.6, prefilterTopN: 8, maxDescriptionChars: 500, useTopics: true, useResultCache: true, usePromptCaching: true, maxOutputTokens: 600, narrativeBriefEnabled: false },
  },
  {
    key: 'accuracy', label: 'Accuracy', blurb: 'Best matches. Stronger model first, wider shortlist, higher spend.',
    values: { matchModel: 'claude-sonnet-4-5', escalationModel: 'claude-opus-4-5', escalateBelowConfidence: 0.75, prefilterTopN: 15, maxDescriptionChars: 900, useTopics: true, useResultCache: true, usePromptCaching: true, maxOutputTokens: 900, narrativeBriefEnabled: false },
  },
];

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500">{icon}{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      {hint && <span className="mb-1 block text-xs text-gray-500">{hint}</span>}
      {children}
    </label>
  );
}

const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50';

function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex items-start gap-3', disabled && 'opacity-60')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-800 focus:ring-brand-500" />
      <span>
        <span className="text-sm font-medium text-gray-800">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}

// ── Usage overview ──
function UsageTab({ days }: { days: number }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const { data, isLoading } = useQuery({ queryKey: ['ai-usage-summary', days], queryFn: () => aiControlsApi.summary(days) });
  const clear = useMutation({
    mutationFn: () => aiControlsApi.clearCache(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-usage-summary'] }),
  });
  const settingsQ = useQuery({ queryKey: ['ai-settings'], queryFn: () => aiControlsApi.settings() });
  const budget = settingsQ.data?.data.find((r) => r.institutionId == null)?.monthlyTokenBudget ?? null;
  const s = data?.data;
  if (isLoading || !s) return <p className="text-gray-400">Loading…</p>;
  const spent = s.totals.inputTokens + s.totals.outputTokens;
  const budgetPct = budget ? Math.min(100, Math.round((s.monthTokens / budget) * 100)) : null;
  const saved = s.totals.tokensSaved + s.prefilterTokensSaved;
  const maxDay = Math.max(1, ...s.byDay.map((d) => d.tokens + d.tokensSaved));

  return (
    <div className="space-y-6">
      <MatcherAccuracyCard />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<Coins size={13} />} label="Tokens used" value={fmt(spent)} hint={`${fmt(s.totals.inputTokens)} in · ${fmt(s.totals.outputTokens)} out`} />
        <Stat icon={<Gauge size={13} />} label="Estimated cost" value={usd(s.totals.costUsd)} hint={`${fmt(s.totals.requests)} requests`} />
        <Stat icon={<Sparkles size={13} />} label="Tokens saved" value={fmt(saved)} hint="cache hits, skipped calls, catalogue shortlist" />
        <Stat icon={<Zap size={13} />} label="This month" value={fmt(s.monthTokens)} hint={`${fmt(s.totals.calls)} AI calls · ${fmt(s.totals.skippedCalls)} skipped`} />
      </div>

      {budgetPct !== null && budget && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-semibold text-gray-900">Monthly token budget</span>
            <span className="text-gray-500">{fmt(s.monthTokens)} of {fmt(budget)} used ({budgetPct}%)</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
            <div className={cn('h-full rounded-full', budgetPct >= 100 ? 'bg-red-500' : budgetPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${budgetPct}%` }} />
          </div>
          {budgetPct >= 80 && <p className="mt-2 text-xs text-amber-700">{budgetPct >= 100 ? 'The budget is used up, so AI matching is paused until next month or until you raise it.' : 'Close to the limit. AI matching pauses when it is reached.'}</p>}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Tokens per day</h3>
        {s.byDay.length === 0 ? <p className="text-sm text-gray-400">No AI activity in this period.</p> : (
          <div className="flex h-40 items-end gap-1">
            {s.byDay.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${fmt(d.tokens)} used, ${fmt(d.tokensSaved)} saved`}>
                <div className="rounded-t bg-emerald-200" style={{ height: `${(d.tokensSaved / maxDay) * 100}%` }} />
                <div className="bg-brand-700" style={{ height: `${(d.tokens / maxDay) * 100}%`, minHeight: d.tokens ? 2 : 0 }} />
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-700" /> used</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" /> saved</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">By operation</h3>
          <table className="w-full text-sm">
            <tbody>
              {s.byOperation.map((o) => (
                <tr key={o.operation} className="border-t border-gray-100 first:border-0">
                  <td className="py-1.5 capitalize text-gray-700">{o.operation.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 text-right text-gray-500">{fmt(o.calls)} calls</td>
                  <td className="py-1.5 text-right font-medium text-gray-900">{fmt(o.tokens)}</td>
                </tr>
              ))}
              {s.byOperation.length === 0 && <tr><td className="py-2 text-gray-400">Nothing yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Why calls were skipped</h3>
          <table className="w-full text-sm">
            <tbody>
              {s.skippedBy.map((o) => (
                <tr key={o.reason} className="border-t border-gray-100 first:border-0">
                  <td className="py-1.5 text-gray-700">{o.reason.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 text-right text-gray-500">{fmt(o.n)}×</td>
                  <td className="py-1.5 text-right font-medium text-emerald-700">−{fmt(o.tokensSaved)}</td>
                </tr>
              ))}
              {s.skippedBy.length === 0 && <tr><td className="py-2 text-gray-400">Nothing skipped.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Database size={14} /> Match cache</h3>
          <p className="text-sm text-gray-600">{fmt(s.cache.entries)} stored matches, reused {fmt(s.cache.hits)} times across students.</p>
          {can('ai_controls', 'edit') && (
            <button type="button" disabled={clear.isPending} onClick={() => window.confirm('Clear the cache? The next requests will call the AI again.') && clear.mutate()}
              className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Clear cache</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Settings (global + per university) ──
function SettingsTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can('ai_controls', 'edit');
  const list = useQuery({ queryKey: ['ai-settings'], queryFn: () => aiControlsApi.settings() });
  const unis = useQuery({ queryKey: ['md-universities'], queryFn: () => universitiesApi.list({ isActive: true }) });
  const [scope, setScope] = useState<number | null>(null);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [newUni, setNewUni] = useState('');

  const rows = list.data?.data ?? [];
  const global = rows.find((r) => r.institutionId == null);
  const overrides = rows.filter((r) => r.institutionId != null);
  const uniList = (unis.data?.data as { id: number; name: string }[] | undefined) ?? [];

  useEffect(() => {
    const row = rows.find((r) => r.institutionId === scope);
    if (row) { setDraft({ ...row }); setDirty(false); }
  }, [list.data, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<AiSettings>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setDirty(true); setMsg(''); };
  const numOrNull = (v: string) => (v === '' ? null : Number(v));

  const save = useMutation({
    mutationFn: () => {
      // The API rejects unknown properties, so drop the read-only row fields.
      const { id: _id, institutionName: _name, institutionId: _inst, ...fields } = draft!;
      return aiControlsApi.saveSettings({ ...fields, institutionId: scope });
    },
    onSuccess: () => { setDirty(false); setError(''); setMsg('Saved. Applies to the next request.'); void qc.invalidateQueries({ queryKey: ['ai-settings'] }); },
    onError: (e) => setError(errMsg(e, 'Could not save settings.')),
  });
  const addOverride = useMutation({
    mutationFn: () => aiControlsApi.saveSettings({ institutionId: Number(newUni) }),
    onSuccess: () => { setScope(Number(newUni)); setNewUni(''); void qc.invalidateQueries({ queryKey: ['ai-settings'] }); },
    onError: (e) => setError(errMsg(e, 'Could not add override.')),
  });
  const removeOverride = useMutation({
    mutationFn: (id: number) => aiControlsApi.removeOverride(id),
    onSuccess: () => { setScope(null); void qc.invalidateQueries({ queryKey: ['ai-settings'] }); },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-2">
        <button type="button" onClick={() => setScope(null)} className={cn('w-full rounded-xl border p-3 text-left text-sm font-semibold', scope == null ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white')}>
          Global default{global && !global.isEnabled && <span className="ml-2 text-xs font-normal text-red-600">AI off</span>}
        </button>
        {overrides.map((o) => (
          <button key={o.institutionId} type="button" onClick={() => setScope(o.institutionId)} className={cn('w-full rounded-xl border p-3 text-left text-sm', scope === o.institutionId ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white')}>
            <div className="font-semibold text-gray-900">{o.institutionName}</div>
            <div className="text-xs text-gray-500">{o.isEnabled ? 'Custom AI settings' : 'AI off for this university'}</div>
          </button>
        ))}
        {canEdit && (
          <div className="rounded-xl border border-dashed border-gray-300 p-3">
            <div className="mb-1.5 text-xs font-medium text-gray-500">Override for a university</div>
            <select value={newUni} onChange={(e) => setNewUni(e.target.value)} className="mb-2 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Choose…</option>
              {uniList.filter((u) => !overrides.some((o) => o.institutionId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button type="button" disabled={!newUni || addOverride.isPending} onClick={() => addOverride.mutate()} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white disabled:bg-brand-300"><Plus size={14} /> Add</button>
          </div>
        )}
      </aside>

      {!draft ? <p className="text-gray-400">Loading…</p> : (
        <div className="space-y-5">
          {canEdit && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="mb-1 font-semibold text-gray-900">Quick presets</h3>
              <p className="mb-3 text-xs text-gray-500">Fill in the model and token-saving fields in one go. Nothing changes until you press Save settings.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {PRESETS.map((p) => (
                  <button key={p.key} type="button" onClick={() => set(p.values)} className="rounded-lg border border-gray-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50/40">
                    <div className="text-sm font-semibold text-gray-900">{p.label}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{p.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="font-semibold text-gray-900">Switches</h3>
            <Check checked={draft.isEnabled} disabled={!canEdit} onChange={(v) => set({ isEnabled: v })} label="AI matching enabled" hint="Off = no tokens are spent. Reviewers match courses by hand and see the rules-based brief only." />
            <Check checked={draft.autoRunOnIntake} disabled={!canEdit || !draft.isEnabled} onChange={(v) => set({ autoRunOnIntake: v })} label="Run the agent automatically when a request arrives" hint="Off = reviewers start AI matching manually from the request." />
            <Check checked={draft.rulesFallbackEnabled !== false} disabled={!canEdit} onChange={(v) => set({ rulesFallbackEnabled: v })} label="Built-in rules fallback" hint="When AI is off, has no key, or runs out of budget, a built-in rules engine still reads documents and suggests course matches (less accurate, always marked for review). Costs no tokens." />
            <Check checked={draft.narrativeBriefEnabled} disabled={!canEdit || !draft.isEnabled} onChange={(v) => set({ narrativeBriefEnabled: v })} label="Write the reviewer brief with AI" hint="Off (recommended) = the brief is a free template built from the data; no tokens." />
          </div>

          <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="flex items-center gap-1.5 font-semibold text-gray-900"><Bot size={16} /> Models</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First-pass model" hint="Used for every match.">
                <select disabled={!canEdit} value={draft.matchModel} onChange={(e) => set({ matchModel: e.target.value })} className={inputCls}>
                  {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  {!MODELS.some((m) => m.value === draft.matchModel) && <option value={draft.matchModel}>{draft.matchModel}</option>}
                </select>
              </Field>
              <Field label="Escalation model" hint="Only used when the first pass is unsure.">
                <select disabled={!canEdit} value={draft.escalationModel ?? ''} onChange={(e) => set({ escalationModel: e.target.value || null })} className={inputCls}>
                  <option value="">None, never escalate</option>
                  {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Escalate below confidence" hint="0 to 1. Lower = fewer expensive calls.">
                <input type="number" step="0.05" min={0} max={1} disabled={!canEdit} value={draft.escalateBelowConfidence} onChange={(e) => set({ escalateBelowConfidence: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Mark as “likely match” at or above" hint="0 to 1.">
                <input type="number" step="0.05" min={0} max={1} disabled={!canEdit} value={draft.autoLikelyThreshold} onChange={(e) => set({ autoLikelyThreshold: Number(e.target.value) })} className={inputCls} />
              </Field>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="flex items-center gap-1.5 font-semibold text-gray-900"><Zap size={16} /> Token savers</h3>
            <Check checked={draft.useResultCache} disabled={!canEdit} onChange={(v) => set({ useResultCache: v })} label="Reuse matches across students" hint="The same external course matched before costs zero tokens." />
            <Check checked={draft.usePromptCaching} disabled={!canEdit} onChange={(v) => set({ usePromptCaching: v })} label="Prompt caching" hint="The playbook and catalogue prefix is billed at a fraction on repeat calls." />
            <Check checked={draft.useTopics} disabled={!canEdit} onChange={(v) => set({ useTopics: v })} label="Include course topics in the comparison" hint="More precise matches, slightly more input tokens." />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Catalogue shortlist size" hint="Candidate courses sent per match (not the whole catalogue).">
                <input type="number" min={0} max={100} disabled={!canEdit} value={draft.prefilterTopN} onChange={(e) => set({ prefilterTopN: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Description length" hint="Max characters per course description.">
                <input type="number" min={0} max={2000} disabled={!canEdit} value={draft.maxDescriptionChars} onChange={(e) => set({ maxDescriptionChars: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Max output tokens" hint="Cap per AI answer.">
                <input type="number" min={50} max={8000} disabled={!canEdit} value={draft.maxOutputTokens} onChange={(e) => set({ maxOutputTokens: Number(e.target.value) })} className={inputCls} />
              </Field>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="flex items-center gap-1.5 font-semibold text-gray-900"><Gauge size={16} /> Budgets</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Max tokens per request" hint="Blank = unlimited. The agent stops when a request reaches this.">
                <input type="number" min={0} disabled={!canEdit} value={draft.maxTokensPerRequest ?? ''} onChange={(e) => set({ maxTokensPerRequest: numOrNull(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Monthly token budget" hint="Blank = unlimited. AI pauses for the rest of the month once reached.">
                <input type="number" min={0} disabled={!canEdit} value={draft.monthlyTokenBudget ?? ''} onChange={(e) => set({ monthlyTokenBudget: numOrNull(e.target.value) })} className={inputCls} />
              </Field>
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {canEdit && (
            <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
              <div className="text-sm text-gray-500">{msg || (dirty ? 'You have unsaved changes.' : 'No changes.')}</div>
              <div className="flex gap-2">
                {scope != null && <button type="button" onClick={() => window.confirm('Remove this override and use the global default?') && removeOverride.mutate(scope)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-700">Remove override</button>}
                <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white disabled:bg-brand-300">
                  {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save settings
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Playbook (agent skills) ──
function PlaybookTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can('ai_controls', 'edit');
  const skills = useQuery({ queryKey: ['ai-skills'], queryFn: () => aiControlsApi.skills() });
  const preview = useQuery({ queryKey: ['ai-prompt-preview'], queryFn: () => aiControlsApi.promptPreview() });
  const [editing, setEditing] = useState<(Omit<AgentSkill, 'id' | 'tokenEstimate'> & { id: number | null }) | null>(null);
  const [error, setError] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ai-skills'] }); void qc.invalidateQueries({ queryKey: ['ai-prompt-preview'] }); };
  const save = useMutation({
    mutationFn: () => aiControlsApi.saveSkill(editing!.id, { title: editing!.title, category: editing!.category, instructions: editing!.instructions, isActive: editing!.isActive, sortOrder: editing!.sortOrder }),
    onSuccess: () => { setEditing(null); setError(''); refresh(); },
    onError: (e) => setError(errMsg(e, 'Could not save the skill.')),
  });
  const remove = useMutation({ mutationFn: (id: number) => aiControlsApi.removeSkill(id), onSuccess: refresh });
  const toggle = useMutation({
    mutationFn: (s: AgentSkill) => aiControlsApi.saveSkill(s.id, { title: s.title, category: s.category, instructions: s.instructions, isActive: !s.isActive, sortOrder: s.sortOrder }),
    onSuccess: refresh,
  });

  const learned = useQuery({ queryKey: ['ai-learned-skills'], queryFn: () => aiControlsApi.learnedSkills(2) });
  const addLearned = useMutation({
    mutationFn: (sg: { title: string; instructions: string }) =>
      aiControlsApi.saveSkill(null, { title: sg.title, category: 'matching', instructions: sg.instructions, isActive: true, sortOrder: 100 }),
    onSuccess: () => { refresh(); void qc.invalidateQueries({ queryKey: ['ai-learned-skills'] }); },
    onError: (e) => setError(errMsg(e, 'Could not add the skill.')),
  });
  const learnedData = learned.data?.data;
  const pending = (learnedData?.suggestions ?? []).filter((x) => !x.alreadyInPlaybook);

  const list = skills.data?.data ?? [];
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-4" data-testid="learned-skills">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Sparkles size={15} /> Learned from faculty decisions</h3>
        <p className="mt-1 text-xs text-gray-500">
          Patterns that repeat in what faculty decide — a course mapped somewhere other than the agent's top pick, or repeatedly elective / no credit.
          Review each one and add it to the playbook; nothing is added automatically. Works with every provider because the playbook is sent with each call.
        </p>
        {learnedData && (
          <p className="mt-2 text-xs text-gray-600">
            {learnedData.stats.decided} equivalency decisions
            {learnedData.stats.agreementRate != null && <> · the agent's top pick matched faculty <strong>{learnedData.stats.agreementRate}%</strong> of the time ({learnedData.stats.overridden} overridden)</>}
          </p>
        )}
        {learned.isLoading && <p className="mt-2 text-xs text-gray-400">Looking for patterns…</p>}
        {learnedData && pending.length === 0 && (
          <p className="mt-2 text-xs text-gray-500">No new repeating patterns yet. Suggestions appear once the same decision has been made at least twice.</p>
        )}
        <ul className="mt-3 space-y-2">
          {pending.map((sg) => (
            <li key={sg.key} className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-200 p-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="text-sm font-medium text-gray-900">{sg.title}</p>
                <p className="mt-0.5 text-xs text-gray-600">{sg.instructions}</p>
                <p className="mt-1 text-[11px] text-brand-700">{sg.evidence}</p>
              </div>
              {canEdit && (
                <button type="button" disabled={addLearned.isPending} onClick={() => addLearned.mutate({ title: sg.title, instructions: sg.instructions })}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-900 disabled:opacity-60">
                  <Plus size={13} /> Add to playbook
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-gray-700">
        <p><strong>The playbook teaches the agent how your team matches courses.</strong> Each active skill is added to the agent's instructions on every call, so keep them short and specific: every token here is paid on every match (cached when prompt caching is on).</p>
        <p className="mt-2 text-gray-600">
          Current playbook: <strong>{fmt(preview.data?.data.tokenEstimate)} tokens</strong> across {preview.data?.data.skillCount ?? 0} skills.{' '}
          <button type="button" onClick={() => setShowPrompt((v) => !v)} className="font-medium text-brand-800 underline">{showPrompt ? 'Hide' : 'Show'} full prompt</button>
        </p>
        {showPrompt && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-gray-700">{preview.data?.data.text}</pre>}
      </div>

      {canEdit && (
        <button type="button" onClick={() => setEditing({ id: null, skillKey: '', title: '', category: 'matching', instructions: '', isActive: true, sortOrder: 100 })} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white"><Plus size={15} /> New skill</button>
      )}

      {editing && (
        <div className="space-y-3 rounded-xl border border-brand-300 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem_6rem]">
            <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Skill title" maxLength={150} className={inputCls} />
            <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as AgentSkill['category'] })} className={inputCls}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="number" value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} title="Order" className={inputCls} />
          </div>
          <textarea value={editing.instructions} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} rows={4} maxLength={2000} placeholder="Instruction for the agent, e.g. “Treat a 3-credit lab course as equivalent to a 4-credit BU course only if the topics overlap by 70% or more.”" className={inputCls} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">~{Math.ceil(editing.instructions.length / 4)} tokens per call</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setEditing(null); setError(''); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700">Cancel</button>
              <button type="button" disabled={!editing.title.trim() || !editing.instructions.trim() || save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white disabled:bg-brand-300">Save skill</button>
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      <ul className="space-y-3">
        {list.map((s) => (
          <li key={s.id} className={cn('rounded-xl border border-gray-200 bg-white p-4', !s.isActive && 'opacity-60')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{s.title}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{CATEGORY_LABEL[s.category]}</span>
                <span className="text-xs text-gray-400">~{s.tokenEstimate} tokens</span>
              </div>
              {canEdit && (
                <div className="flex items-center gap-3 text-xs">
                  <button type="button" onClick={() => toggle.mutate(s)} className="font-medium text-gray-600 hover:underline">{s.isActive ? 'Turn off' : 'Turn on'}</button>
                  <button type="button" onClick={() => setEditing({ ...s })} className="font-medium text-brand-800 hover:underline">Edit</button>
                  <button type="button" onClick={() => window.confirm(`Delete "${s.title}"?`) && remove.mutate(s.id)} className="text-gray-400 hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              )}
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-600">{s.instructions}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Tokens by request ──
function RequestsTab({ days }: { days: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['ai-usage-requests', days], queryFn: () => aiControlsApi.byRequest(days) });
  const rows = data?.data ?? [];
  if (isLoading) return <p className="text-gray-400">Loading…</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[48rem] text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2.5">Request</th><th className="px-4 py-2.5">University</th>
            <th className="px-4 py-2.5 text-right">AI calls</th><th className="px-4 py-2.5 text-right">Cache hits</th>
            <th className="px-4 py-2.5 text-right">Tokens</th><th className="px-4 py-2.5 text-right">Saved</th><th className="px-4 py-2.5 text-right">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.transcriptId} className="hover:bg-gray-50">
              <td className="px-4 py-2.5">
                <Link to={`/requests/${r.transcriptId}`} className="font-medium text-brand-800 hover:underline">{r.studentName}</Link>
                <div className="text-xs text-gray-400">{new Date(r.receivedAt).toLocaleDateString()} · {r.status}</div>
              </td>
              <td className="px-4 py-2.5 text-gray-600">{r.institutionName}</td>
              <td className="px-4 py-2.5 text-right">{fmt(r.calls)}</td>
              <td className="px-4 py-2.5 text-right">{fmt(r.cacheHits)}</td>
              <td className="px-4 py-2.5 text-right font-medium">{fmt(r.inputTokens + r.outputTokens)}</td>
              <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(r.tokensSaved)}</td>
              <td className="px-4 py-2.5 text-right">{usd(r.costUsd)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No AI usage recorded in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Providers (Anthropic + Azure OpenAI / Document Intelligence) ──
function ProvidersTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can('ai_controls', 'edit');
  const q = useQuery({ queryKey: ['ai-providers'], queryFn: () => aiControlsApi.providers() });
  const d = q.data?.data;
  const [chatProvider, setChatProvider] = useState<'anthropic' | 'azure_openai'>('anthropic');
  const [docProvider, setDocProvider] = useState<'none' | 'azure_document_intelligence'>('none');
  const [endpoints, setEndpoints] = useState({ azureOpenAiEndpoint: '', azureOpenAiDeployment: '', azureOpenAiApiVersion: '2024-06-01', azureDocEndpoint: '' });
  const [keys, setKeys] = useState({ anthropicKey: '', azureOpenAiKey: '', azureDocKey: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (d) {
      setChatProvider(d.chatProvider);
      setDocProvider(d.docProvider);
      setEndpoints({
        azureOpenAiEndpoint: d.azureOpenAiEndpoint ?? '',
        azureOpenAiDeployment: d.azureOpenAiDeployment ?? '',
        azureOpenAiApiVersion: d.azureOpenAiApiVersion ?? '2024-06-01',
        azureDocEndpoint: d.azureDocEndpoint ?? '',
      });
      setKeys({ anthropicKey: '', azureOpenAiKey: '', azureDocKey: '' });
    }
  }, [d]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = { chatProvider, docProvider, ...endpoints };
      if (keys.anthropicKey) payload.anthropicKey = keys.anthropicKey;
      if (keys.azureOpenAiKey) payload.azureOpenAiKey = keys.azureOpenAiKey;
      if (keys.azureDocKey) payload.azureDocKey = keys.azureDocKey;
      return aiControlsApi.saveProviders(payload);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Saved. New calls use this provider within ~15 seconds.' }); void qc.invalidateQueries({ queryKey: ['ai-providers'] }); void qc.invalidateQueries({ queryKey: ['ai-readiness'] }); },
    onError: (e) => { const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message; setMsg({ ok: false, text: (Array.isArray(m) ? m.join(', ') : m) ?? 'Could not save.' }); },
  });

  if (q.isLoading) return <p className="text-sm text-gray-400">Loading…</p>;
  const keyField = (label: string, isSet: boolean, value: string, onChange: (v: string) => void) => (
    <Field label={label} hint={isSet ? 'A value is saved — leave blank to keep it, or type a new one to replace.' : 'Not set yet.'}>
      <input type="password" value={value} onChange={(e) => { onChange(e.target.value); setMsg(null); }} placeholder={isSet ? '•••••••• (saved)' : 'Paste the key'}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" disabled={!canEdit} />
    </Field>
  );
  const txt = (label: string, val: string, onChange: (v: string) => void, placeholder = '') => (
    <Field label={label}>
      <input value={val} onChange={(e) => { onChange(e.target.value); setMsg(null); }} placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" disabled={!canEdit} />
    </Field>
  );

  // One selectable provider card: click to make it active; its own fields live inside and stay editable.
  const Card = ({ active, onActivate, icon, title, blurb, configured, disabled, children }: {
    active: boolean; onActivate: () => void; icon: React.ReactNode; title: string; blurb?: string;
    configured?: boolean; disabled?: boolean; children?: React.ReactNode;
  }) => (
    <div className={cn('rounded-xl border bg-white p-4 transition', active ? 'border-brand-400 ring-2 ring-brand-500/40' : 'border-gray-200')}>
      <button type="button" onClick={() => { if (!disabled) { onActivate(); setMsg(null); } }} disabled={disabled}
        className="flex w-full items-start gap-3 text-left">
        <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', active ? 'bg-brand-800 text-white' : 'bg-gray-100 text-gray-500')}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{title}</span>
            {active ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-800">Active</span>
              : <span className="text-[11px] text-brand-700">Click to use</span>}
            {configured != null && (
              <span className={cn('ml-auto text-[11px]', configured ? 'text-green-600' : 'text-gray-400')}>{configured ? 'Configured' : 'Not configured'}</span>
            )}
          </span>
          {blurb && <span className="mt-0.5 block text-xs text-gray-500">{blurb}</span>}
        </span>
      </button>
      {children && <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">{children}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      {!d?.ready && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Migration 023 (AppSettings) is not applied yet, so provider settings cannot be saved.</div>
      )}

      <div>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Sparkles size={15} /> Course matching &amp; chat</h3>
        <p className="mb-3 text-xs text-gray-500">Configure any provider; the one you pick as Active is used. The built-in rules engine still covers everything when none is available.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card active={chatProvider === 'anthropic'} onActivate={() => setChatProvider('anthropic')} disabled={!canEdit}
            icon={<Bot size={16} />} title="Anthropic (Claude)" blurb="Claude models via the Anthropic API." configured={!!d?.anthropicKeySet || !!keys.anthropicKey}>
            {keyField('API key', !!d?.anthropicKeySet, keys.anthropicKey, (v) => setKeys((k) => ({ ...k, anthropicKey: v })))}
          </Card>
          <Card active={chatProvider === 'azure_openai'} onActivate={() => setChatProvider('azure_openai')} disabled={!canEdit}
            icon={<Zap size={16} />} title="Azure OpenAI" blurb="GPT models via your Azure Foundry deployment." configured={!!d?.azureOpenAiKeySet && !!endpoints.azureOpenAiEndpoint && !!endpoints.azureOpenAiDeployment}>
            {txt('Endpoint', endpoints.azureOpenAiEndpoint, (v) => setEndpoints((s) => ({ ...s, azureOpenAiEndpoint: v })), 'https://my-resource.openai.azure.com')}
            {keyField('API key', !!d?.azureOpenAiKeySet, keys.azureOpenAiKey, (v) => setKeys((k) => ({ ...k, azureOpenAiKey: v })))}
            <div className="grid grid-cols-2 gap-3">
              {txt('Chat deployment', endpoints.azureOpenAiDeployment, (v) => setEndpoints((s) => ({ ...s, azureOpenAiDeployment: v })), 'e.g. gpt-4o')}
              {txt('API version', endpoints.azureOpenAiApiVersion, (v) => setEndpoints((s) => ({ ...s, azureOpenAiApiVersion: v })), '2024-06-01')}
            </div>
          </Card>
        </div>
      </div>

      <div>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Database size={15} /> Document reading</h3>
        <p className="mb-3 text-xs text-gray-500">Reads transcripts, IDs and score reports in Smart Upload. The built-in rules reader needs no cloud service.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card active={docProvider === 'none'} onActivate={() => setDocProvider('none')} disabled={!canEdit}
            icon={<Database size={16} />} title="Built-in rules reader" blurb="No cloud service; works without a key (no OCR on scans)." />
          <Card active={docProvider === 'azure_document_intelligence'} onActivate={() => setDocProvider('azure_document_intelligence')} disabled={!canEdit}
            icon={<Sparkles size={16} />} title="Azure AI Document Intelligence" blurb="OCR + layout; reads scans and photos." configured={!!d?.azureDocKeySet && !!endpoints.azureDocEndpoint}>
            {txt('Endpoint', endpoints.azureDocEndpoint, (v) => setEndpoints((s) => ({ ...s, azureDocEndpoint: v })), 'https://my-di.cognitiveservices.azure.com')}
            {keyField('API key', !!d?.azureDocKeySet, keys.azureDocKey, (v) => setKeys((k) => ({ ...k, azureDocKey: v })))}
          </Card>
        </div>
      </div>

      {msg && <p className={cn('rounded-lg p-2 text-sm', msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{msg.text}</p>}
      {canEdit && (
        <button type="button" onClick={() => { setMsg(null); save.mutate(); }} disabled={save.isPending || !d?.ready}
          className="flex items-center gap-2 rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50">
          <Save size={16} /> {save.isPending ? 'Saving…' : 'Save providers'}
        </button>
      )}
    </div>
  );
}

export default function AiControls() {
  const [tab, setTab] = useState<Tab>('usage');
  const [days, setDays] = useState(30);
  const tabs: { key: Tab; label: string }[] = [
    { key: 'usage', label: 'Usage' }, { key: 'requests', label: 'By request' },
    { key: 'settings', label: 'Settings' }, { key: 'providers', label: 'Providers' }, { key: 'playbook', label: 'Agent playbook' },
  ];
  return (
    <div className="mx-auto w-[95%] max-w-6xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Bot size={24} /> AI controls</h1>
          <p className="mt-1 text-gray-500">Decide when the agent runs, how much it may spend, and teach it your team's matching rules.</p>
        </div>
        {(tab === 'usage' || tab === 'requests') && (
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
            {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        )}
      </div>
      <ReadinessCard />
      <div className="mb-6 inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn('rounded-md px-4 py-1.5 font-medium', tab === t.key ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-50')}>{t.label}</button>
        ))}
      </div>
      {tab === 'usage' && <UsageTab days={days} />}
      {tab === 'requests' && <RequestsTab days={days} />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'playbook' && <PlaybookTab />}
    </div>
  );
}
