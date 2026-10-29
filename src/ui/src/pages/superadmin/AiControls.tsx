import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bot, ChevronDown, ChevronUp, Download, FlaskConical, Coins, Database, Gauge, Loader2, Plug, Plus, Save, Server, Sparkles, Trash2, Zap } from 'lucide-react';
import { aiControlsApi, universitiesApi, type BenchResult, type BenchSummary, type AiProviderPublic, type AiProviderSave, type ChatProviderId, type CustomProviderPublic } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/cn';
import ReadinessCard from '../../components/workflow/ReadinessCard';
import LearningTab from '../../components/ai/LearningTab';
import MatcherAccuracyCard from '../../components/workflow/MatcherAccuracyCard';
import type { AgentSkill, AiSettings } from '../../types/workflow';

type Tab = 'usage' | 'settings' | 'providers' | 'playbook' | 'requests' | 'benchmark' | 'learning';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};
const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
const pctOf = (n: number) => `${Math.round((n ?? 0) * 100)}%`;
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n ?? 0)} ms`);
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
  const spent = Number(s.totals.inputTokens) + Number(s.totals.outputTokens);
  const budgetPct = budget ? Math.min(100, Math.round((s.monthTokens / budget) * 100)) : null;
  const saved = Number(s.totals.tokensSaved) + Number(s.prefilterTokensSaved);
  const maxDay = Math.max(1, ...s.byDay.map((d) => Number(d.tokens) + Number(d.tokensSaved)));

  return (
    <div className="space-y-6">
      <MatcherAccuracyCard />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<Coins size={13} />} label="Tokens used" value={fmt(spent)} hint={`${fmt(s.totals.inputTokens)} in · ${fmt(s.totals.outputTokens)} out`} />
        <Stat icon={<Gauge size={13} />} label="Spent in period" value={usd(s.totals.costUsd)} hint={`${fmt(s.totals.requests)} requests${s.unlinked?.costUsd ? ` · ${usd(s.unlinked.costUsd)} not tied to a request` : ''}`} />
        <Stat icon={<Sparkles size={13} />} label="Tokens saved" value={fmt(saved)} hint="cache hits, skipped calls, catalogue shortlist" />
        <Stat icon={<Zap size={13} />} label="Spent this month" value={usd(s.monthCostUsd ?? 0)} hint={`${fmt(s.monthTokens)} tokens · ${fmt(s.totals.calls)} AI calls · ${fmt(s.totals.skippedCalls)} skipped`} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="ai-kpis">
        <Stat icon={<Gauge size={13} />} label="Tokens per request" value={fmt(s.kpis.tokensPerRequest)} hint={`${fmt(s.kpis.tokensPerCall)} per AI call`} />
        <Stat icon={<Coins size={13} />} label="Cost per request" value={usd(s.kpis.costPerRequestUsd)} hint="estimated" />
        <Stat icon={<Sparkles size={13} />} label="Share of tokens avoided" value={pctOf(s.kpis.savingsRate)} hint={`${pctOf(s.kpis.callsAvoidedRate)} of calls skipped · ${pctOf(s.kpis.cacheHitRate)} cache hits`} />
        <Stat icon={<Zap size={13} />} label="Average response time" value={ms(s.kpis.avgLatencyMs)} hint={`slowest ${ms(s.kpis.maxLatencyMs)} · ${pctOf(s.kpis.cachedTokenShare)} prompt-cached`} />
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
              <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${fmt(d.tokens)} used (${usd(d.costUsd)}), ${fmt(d.tokensSaved)} saved`}>
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

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">By model</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-400"><tr><th className="py-1">Model</th><th className="py-1 text-right">Calls</th><th className="py-1 text-right">Avg time</th><th className="py-1 text-right">Tokens</th><th className="py-1 text-right">Cost</th></tr></thead>
            <tbody>
              {s.byModel.map((m) => (
                <tr key={m.model} className="border-t border-gray-100">
                  <td className="py-1.5 text-gray-700">{m.model}</td>
                  <td className="py-1.5 text-right text-gray-500">{fmt(m.calls)}</td>
                  <td className="py-1.5 text-right text-gray-500">{ms(m.avgMs)}</td>
                  <td className="py-1.5 text-right font-medium text-gray-900">{fmt(m.tokens)}</td>
                  <td className="py-1.5 text-right text-gray-700">{usd(m.costUsd)}</td>
                </tr>
              ))}
              {s.byModel.length === 0 && <tr><td colSpan={5} className="py-2 text-gray-400">No AI calls yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">By operation <span className="font-normal text-gray-400">(calls · avg time · tokens)</span></h3>
          <table className="w-full text-sm">
            <tbody>
              {s.byOperation.map((o) => (
                <tr key={o.operation} className="border-t border-gray-100 first:border-0">
                  <td className="py-1.5 capitalize text-gray-700">{o.operation.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 text-right text-gray-500">{fmt(o.calls)} calls</td>
                  <td className="py-1.5 text-right text-gray-400">{ms(o.avgMs)}</td>
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

// ── Spend and tokens by request ──
function RequestsTab({ days }: { days: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['ai-usage-requests', days], queryFn: () => aiControlsApi.byRequest(days) });
  const rows = data?.data ?? [];
  if (isLoading) return <p className="text-gray-400">Loading…</p>;
  const total = rows.reduce((n, r) => n + Number(r.costUsd), 0);
  const maxCost = Math.max(0, ...rows.map((r) => Number(r.costUsd)));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<Coins size={13} />} label="Spent on these requests" value={usd(total)} hint={`${fmt(rows.length)} requests with AI usage`} />
        <Stat icon={<Gauge size={13} />} label="Average per request" value={usd(rows.length ? total / rows.length : 0)} hint="estimated" />
        <Stat icon={<Zap size={13} />} label="Most expensive" value={usd(maxCost)} hint={rows[0]?.studentName ?? '-'} />
        <Stat icon={<Sparkles size={13} />} label="Tokens saved" value={fmt(rows.reduce((n, r) => n + Number(r.tokensSaved), 0))} hint="cache hits and shortlisting" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5">Request</th><th className="px-4 py-2.5">University</th>
              <th className="px-4 py-2.5 text-right">AI calls</th><th className="px-4 py-2.5 text-right">Tokens</th>
              <th className="px-4 py-2.5 text-right">Saved</th>
              <th className="px-4 py-2.5 text-right">Matching</th><th className="px-4 py-2.5 text-right">Documents</th>
              <th className="px-4 py-2.5 text-right">Briefs</th><th className="px-4 py-2.5 text-right">$ Spent</th>
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
                <td className="px-4 py-2.5 text-right">{fmt(r.calls)}<span className="block text-xs text-gray-400">{fmt(r.cacheHits)} cache hits</span></td>
                <td className="px-4 py-2.5 text-right">{fmt(Number(r.inputTokens) + Number(r.outputTokens))}</td>
                <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(r.tokensSaved)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{usd(r.matchCostUsd)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{usd(r.readCostUsd)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{usd(r.briefCostUsd)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className="font-semibold text-gray-900">{usd(r.costUsd)}</span>
                  <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${maxCost ? (Number(r.costUsd) / maxCost) * 100 : 0}%` }} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No AI usage recorded in this period.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 text-sm font-semibold">
              <tr>
                <td className="px-4 py-2.5" colSpan={5}>Total</td>
                <td className="px-4 py-2.5 text-right">{usd(rows.reduce((n, r) => n + Number(r.matchCostUsd ?? 0), 0))}</td>
                <td className="px-4 py-2.5 text-right">{usd(rows.reduce((n, r) => n + Number(r.readCostUsd ?? 0), 0))}</td>
                <td className="px-4 py-2.5 text-right">{usd(rows.reduce((n, r) => n + Number(r.briefCostUsd ?? 0), 0))}</td>
                <td className="px-4 py-2.5 text-right">{usd(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Providers ──
// Small cards (name + status) that open into a larger card with every option for that provider; closing returns to the small cards.
// All components below are declared at module level (NOT inside ProvidersTab) so typing in a field never remounts it and drops focus.
type Msg = { ok: boolean; text: string } | null;

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50', on ? 'bg-brand-800' : 'bg-gray-300')}>
      <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

function SmallCard({ icon, title, sub, active, configured, onOpen, open }: { icon: React.ReactNode; title: string; sub?: string; active: boolean; configured?: boolean; onOpen: () => void; open?: boolean }) {
  return (
    <button type="button" onClick={onOpen} aria-expanded={open}
      className={cn('flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition hover:border-brand-300 hover:shadow-sm', open ? 'border-brand-500 ring-2 ring-brand-500/40' : active ? 'border-brand-400 ring-2 ring-brand-500/30' : 'border-gray-200')}>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-brand-800 text-white' : 'bg-gray-100 text-gray-500')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900">{title}</span>
        <span className="flex items-center gap-1.5 text-[11px]">
          <span className={active ? 'font-medium text-brand-800' : 'text-gray-400'}>{active ? 'Active' : 'Inactive'}</span>
          {configured != null && <span className={configured ? 'text-green-600' : 'text-gray-400'}>· {configured ? 'Configured' : 'Not configured'}</span>}
          {sub && <span className="truncate text-gray-400">· {sub}</span>}
        </span>
      </span>
      {open !== undefined && <ChevronDown size={16} className={cn('shrink-0 text-gray-400 transition-transform', open && 'rotate-180 text-brand-700')} />}
    </button>
  );
}

function ExpandedCard({ icon, title, blurb, active, configured, canEdit, canToggle = true, onToggle, onClose, toggling, children, footer }: {
  icon: React.ReactNode; title: string; blurb?: string; active: boolean; configured?: boolean; canEdit: boolean; canToggle?: boolean;
  onToggle: (v: boolean) => void; onClose: () => void; toggling?: boolean; children?: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border border-brand-400 bg-white p-5 shadow-sm', active && 'ring-2 ring-brand-500/30')}>
      <div className="flex items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', active ? 'bg-brand-800 text-white' : 'bg-gray-100 text-gray-500')}>{icon}</span>
        <button type="button" onClick={onClose} title="Click to close" className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-gray-900">{title}</span>
            {configured != null && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>{configured ? 'Configured' : 'Not configured'}</span>}
          </div>
          {blurb && <p className="mt-0.5 text-xs text-gray-500">{blurb}</p>}
        </button>
        {canToggle && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span className={active ? 'font-medium text-brand-800' : 'text-gray-500'}>{toggling ? 'Saving…' : active ? 'Active' : 'Inactive'}</span>
            <Switch on={active} onChange={onToggle} disabled={!canEdit || toggling} label={`${title} active`} />
          </label>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><ChevronUp size={18} /></button>
      </div>
      <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">{children}</div>
      {footer && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">{footer}</div>}
    </div>
  );
}

function SecretField({ label, isSet, value, onChange, disabled }: { label: string; isSet: boolean; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <Field label={label} hint={isSet ? 'A value is saved. Leave blank to keep it, or type a new one to replace it.' : 'Not set yet.'}>
      <input type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={isSet ? '•••••••• (saved)' : 'Paste the key'} className={inputCls} disabled={disabled} />
    </Field>
  );
}
function TextField({ label, hint, value, onChange, placeholder, disabled }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled: boolean }) {
  return <Field label={label} hint={hint}><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} disabled={disabled} /></Field>;
}

function Result({ msg }: { msg: Msg }) {
  return msg ? <p className={cn('basis-full rounded-lg p-2 text-sm', msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{msg.text}</p> : null;
}

function useProviderActions(provider: ChatProviderId | null) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<Msg>(null);
  const [testing, setTesting] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ai-providers'] }); void qc.invalidateQueries({ queryKey: ['ai-readiness'] }); };
  const test = async () => {
    if (!provider) return;
    setTesting(true); setMsg(null);
    try {
      const r = (await aiControlsApi.testProvider(provider)).data;
      setMsg(r.ok ? { ok: true, text: `Connected: the provider answered in ${r.ms} ms${r.reply ? ` ("${r.reply}")` : ''}.` } : { ok: false, text: r.error ?? 'The test failed.' });
    } catch (e) { setMsg({ ok: false, text: errMsg(e, 'The test failed.') }); } finally { setTesting(false); }
  };
  return { msg, setMsg, testing, test, refresh };
}

const TestButton = ({ onClick, busy, disabled }: { onClick: () => void; busy: boolean; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={busy || disabled} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
    {busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Test connection
  </button>
);
const SaveButton = ({ busy, label = 'Save', disabled }: { busy: boolean; label?: string; disabled?: boolean }) => (
  <button type="submit" disabled={busy || disabled} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50">
    <Save size={14} /> {busy ? 'Saving…' : label}
  </button>
);

/** "What will actually be called" box shown inside a provider card. */
function ModelBox({ rows, note }: { rows: [string, string][]; note?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-3 text-sm">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-800">Model &amp; parameters in use</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v]) => (<div key={k} className="flex justify-between gap-3"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium text-gray-900">{v}</dd></div>))}
      </dl>
      {note && <p className="mt-2 text-xs text-gray-500">{note}</p>}
    </div>
  );
}
const paramRows = (d: AiProviderPublic, gs: AiSettings | null): [string, string][] => [
  ['Temperature', String(d.temperature)],
  ['Request timeout', `${d.timeoutSec} s`],
  ...(gs ? ([['Max output tokens', String(gs.maxOutputTokens)], ['Shortlist size sent', `${gs.prefilterTopN} courses`], ['Auto-apply threshold', `${Math.round(gs.autoLikelyThreshold * 100)}%`]] as [string, string][]) : []),
];

function AnthropicForm({ d, gs, canEdit, onClose, active, toggling, onToggle }: { d: AiProviderPublic; gs: AiSettings | null; canEdit: boolean; onClose: () => void; active: boolean; toggling: boolean; onToggle: (v: boolean) => void }) {
  const { msg, setMsg, testing, test, refresh } = useProviderActions('anthropic');
  const [key, setKey] = useState('');
  const [url, setUrl] = useState(d.anthropicBaseUrl ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await aiControlsApi.saveProviders({ anthropicBaseUrl: url.trim(), ...(key ? { anthropicKey: key } : {}) });
      setKey(''); setMsg({ ok: true, text: 'Saved. New calls use it within ~15 seconds.' }); refresh();
    } catch (er) { setMsg({ ok: false, text: errMsg(er, 'Could not save.') }); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="col-span-full">
      <ExpandedCard icon={<Bot size={18} />} title="Anthropic (Claude)" blurb="Claude models via the Anthropic API." active={active} configured={d.anthropicKeySet} canEdit={canEdit} toggling={toggling} onToggle={onToggle} onClose={onClose}
        footer={<>{canEdit && <SaveButton busy={busy} />}<TestButton onClick={test} busy={testing} disabled={!d.anthropicKeySet} /><Result msg={msg} /></>}>
        <ModelBox rows={[['Matching model', gs?.matchModel ?? '-'], ['Escalation model', gs?.escalationModel ? `${gs.escalationModel} (below ${Math.round((gs.escalateBelowConfidence ?? 0) * 100)}% confidence)` : 'none'], ...paramRows(d, gs)]}
          note={<>Models and limits are set under the <strong>Settings</strong> tab; temperature and timeout under <strong>Model parameters</strong> below.</>} />
        <SecretField label="API key" isSet={d.anthropicKeySet} value={key} onChange={setKey} disabled={!canEdit} />
        <TextField label="Base URL (optional)" hint="Leave blank for api.anthropic.com. Set it to use a gateway or proxy (https only)." value={url} onChange={setUrl} placeholder="https://api.anthropic.com" disabled={!canEdit} />
      </ExpandedCard>
    </form>
  );
}

function AzureOpenAiForm({ d, gs, canEdit, onClose, active, toggling, onToggle }: { d: AiProviderPublic; gs: AiSettings | null; canEdit: boolean; onClose: () => void; active: boolean; toggling: boolean; onToggle: (v: boolean) => void }) {
  const { msg, setMsg, testing, test, refresh } = useProviderActions('azure_openai');
  const [key, setKey] = useState('');
  const [f, setF] = useState({ endpoint: d.azureOpenAiEndpoint ?? '', deployment: d.azureOpenAiDeployment ?? '', version: d.azureOpenAiApiVersion ?? '2024-06-01' });
  const [busy, setBusy] = useState(false);
  const configured = d.azureOpenAiKeySet && !!d.azureOpenAiEndpoint && !!d.azureOpenAiDeployment;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await aiControlsApi.saveProviders({ azureOpenAiEndpoint: f.endpoint, azureOpenAiDeployment: f.deployment, azureOpenAiApiVersion: f.version, ...(key ? { azureOpenAiKey: key } : {}) });
      setKey(''); setMsg({ ok: true, text: 'Saved. New calls use it within ~15 seconds.' }); refresh();
    } catch (er) { setMsg({ ok: false, text: errMsg(er, 'Could not save.') }); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="col-span-full">
      <ExpandedCard icon={<Zap size={18} />} title="Azure OpenAI" blurb="GPT models through your Azure AI Foundry / Azure OpenAI deployment." active={active} configured={configured} canEdit={canEdit} toggling={toggling} onToggle={onToggle} onClose={onClose}
        footer={<>{canEdit && <SaveButton busy={busy} />}<TestButton onClick={test} busy={testing} disabled={!configured} /><Result msg={msg} /></>}>
 <ModelBox rows={[['Deployment (model)', f.deployment || '-'], ['API version', f.version], ...paramRows(d, gs)]} note="The deployment name is the model that answers; Azure ignores the Claude model names from Settings." />
        <TextField label="Endpoint (base URL)" hint="The resource URL, without /openai/v1." value={f.endpoint} onChange={(v) => setF((s) => ({ ...s, endpoint: v }))} placeholder="https://my-resource.openai.azure.com" disabled={!canEdit} />
        <SecretField label="API key" isSet={d.azureOpenAiKeySet} value={key} onChange={setKey} disabled={!canEdit} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Chat deployment" value={f.deployment} onChange={(v) => setF((s) => ({ ...s, deployment: v }))} placeholder="e.g. gpt-4.1-mini" disabled={!canEdit} />
          <TextField label="API version" value={f.version} onChange={(v) => setF((s) => ({ ...s, version: v }))} placeholder="2024-06-01" disabled={!canEdit} />
        </div>
      </ExpandedCard>
    </form>
  );
}

function CustomForm({ d, gs, item, canEdit, onClose, active, toggling, onToggle, onSaved }: {
  d: AiProviderPublic; gs: AiSettings | null; item: CustomProviderPublic | null; canEdit: boolean; onClose: () => void; active: boolean; toggling: boolean; onToggle: (v: boolean) => void; onSaved: (id: string | null) => void;
}) {
  const { msg, setMsg, testing, test, refresh } = useProviderActions(item ? (`custom:${item.id}` as ChatProviderId) : null);
  const [f, setF] = useState({ name: item?.name ?? '', baseUrl: item?.baseUrl ?? '', model: item?.model ?? '', authStyle: item?.authStyle ?? ('bearer' as 'bearer' | 'api-key') });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const body = { name: f.name, baseUrl: f.baseUrl, model: f.model, authStyle: f.authStyle, ...(key ? { apiKey: key } : {}) };
      if (item) await aiControlsApi.updateCustomProvider(item.id, body);
      else await aiControlsApi.addCustomProvider(body);
      setKey(''); refresh();
      if (item) setMsg({ ok: true, text: 'Saved.' }); else onSaved(null);
    } catch (er) { setMsg({ ok: false, text: errMsg(er, 'Could not save.') }); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!item || !window.confirm(`Remove the provider "${item.name}"?`)) return;
    setBusy(true);
    try { await aiControlsApi.deleteCustomProvider(item.id); refresh(); onClose(); } catch (er) { setMsg({ ok: false, text: errMsg(er, 'Could not remove it.') }); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="col-span-full">
      <ExpandedCard icon={<Server size={18} />} title={item ? item.name : 'Add a provider'} blurb="Any service that speaks the OpenAI chat-completions API: OpenAI, Azure AI Foundry (/openai/v1), OpenRouter, Mistral, vLLM, and more."
        active={active} configured={item ? !!item.baseUrl && !!item.model : undefined} canEdit={canEdit} canToggle={!!item} toggling={toggling} onToggle={onToggle} onClose={onClose}
        footer={<>
          {canEdit && <SaveButton busy={busy} label={item ? 'Save' : 'Add provider'} disabled={!f.name.trim() || !f.baseUrl.trim() || !f.model.trim()} />}
          {item && <TestButton onClick={test} busy={testing} />}
          {item && canEdit && <button type="button" onClick={del} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} /> Remove</button>}
          <Result msg={msg} />
        </>}>
        {item && <ModelBox rows={[['Model', item.model], ['Base URL', item.baseUrl.replace(/^https:\/\//, '')], ...paramRows(d, gs)]} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Name" value={f.name} onChange={(v) => setF((s) => ({ ...s, name: v }))} placeholder="OpenAI" disabled={!canEdit} />
          <TextField label="Model" hint="The model or deployment name sent with each request." value={f.model} onChange={(v) => setF((s) => ({ ...s, model: v }))} placeholder="gpt-4.1-mini" disabled={!canEdit} />
        </div>
        <TextField label="Base URL" hint="https only. “/chat/completions” is added for you." value={f.baseUrl} onChange={(v) => setF((s) => ({ ...s, baseUrl: v }))} placeholder="https://api.openai.com/v1" disabled={!canEdit} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SecretField label="API key" isSet={!!item?.keySet} value={key} onChange={setKey} disabled={!canEdit} />
          <Field label="Key is sent as">
            <select value={f.authStyle} onChange={(e) => setF((s) => ({ ...s, authStyle: e.target.value as 'bearer' | 'api-key' }))} className={inputCls} disabled={!canEdit}>
              <option value="bearer">Authorization: Bearer … (OpenAI and most services)</option>
              <option value="api-key">api-key header (Azure style)</option>
            </select>
          </Field>
        </div>
      </ExpandedCard>
    </form>
  );
}

function DocAzureForm({ d, canEdit, onClose, active, toggling, onToggle }: { d: AiProviderPublic; canEdit: boolean; onClose: () => void; active: boolean; toggling: boolean; onToggle: (v: boolean) => void }) {
  const { msg, setMsg, refresh } = useProviderActions(null);
  const [key, setKey] = useState('');
  const [endpoint, setEndpoint] = useState(d.azureDocEndpoint ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await aiControlsApi.saveProviders({ azureDocEndpoint: endpoint, ...(key ? { azureDocKey: key } : {}) }); setKey(''); setMsg({ ok: true, text: 'Saved.' }); refresh(); }
    catch (er) { setMsg({ ok: false, text: errMsg(er, 'Could not save.') }); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="col-span-full">
      <ExpandedCard icon={<Sparkles size={18} />} title="Azure AI Document Intelligence" blurb="OCR + layout: reads scans and photos in Smart Upload." active={active} configured={d.azureDocKeySet && !!d.azureDocEndpoint} canEdit={canEdit} toggling={toggling} onToggle={onToggle} onClose={onClose}
        footer={<>{canEdit && <SaveButton busy={busy} />}<Result msg={msg} /></>}>
        <TextField label="Endpoint (base URL)" value={endpoint} onChange={setEndpoint} placeholder="https://my-di.cognitiveservices.azure.com" disabled={!canEdit} />
        <SecretField label="API key" isSet={d.azureDocKeySet} value={key} onChange={setKey} disabled={!canEdit} />
      </ExpandedCard>
    </form>
  );
}

/** Global model parameters applied to every chat call, plus a read-only summary of the matching limits kept in Settings. */
function ParamsPanel({ d, gs, canEdit }: { d: AiProviderPublic; gs: AiSettings | null; canEdit: boolean }) {
  const qc = useQueryClient();
  const [temp, setTemp] = useState(String(d.temperature));
  const [timeout, setTimeoutSec] = useState(String(d.timeoutSec));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTemp(String(d.temperature)); setTimeoutSec(String(d.timeoutSec)); }, [d.temperature, d.timeoutSec]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await aiControlsApi.saveProviders({ temperature: temp, timeoutSec: timeout }); setMsg({ ok: true, text: 'Saved. Applies to every provider within ~15 seconds.' }); void qc.invalidateQueries({ queryKey: ['ai-providers'] }); }
    catch (er) { setMsg({ ok: false, text: errMsg(er, 'Could not save.') }); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Gauge size={15} /> Model parameters</h3>
      <p className="mb-3 text-xs text-gray-500">Sent with every model call, whichever provider is Active. Matching is a classification job, so temperature 0 (the most repeatable answer) is recommended.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={`Temperature: ${temp}`} hint="0 = deterministic, 1 = more varied.">
          <input type="range" min={0} max={1} step={0.1} value={temp} onChange={(e) => setTemp(e.target.value)} disabled={!canEdit} className="mt-2 w-full accent-brand-800" />
        </Field>
        <Field label="Request timeout (seconds)" hint="A call slower than this is abandoned (the rules engine then answers).">
          <input type="number" min={5} max={300} value={timeout} onChange={(e) => setTimeoutSec(e.target.value)} disabled={!canEdit} className={inputCls} />
        </Field>
        <div className="text-sm">
          <p className="font-medium text-gray-800">From Settings (read-only here)</p>
          <dl className="mt-1 space-y-0.5 text-xs text-gray-600">
            <div className="flex justify-between"><dt>Max output tokens</dt><dd className="font-medium">{gs?.maxOutputTokens ?? '-'}</dd></div>
            <div className="flex justify-between"><dt>Courses sent per match</dt><dd className="font-medium">{gs?.prefilterTopN ?? '-'}</dd></div>
            <div className="flex justify-between"><dt>Escalate below</dt><dd className="font-medium">{gs ? `${Math.round(gs.escalateBelowConfidence * 100)}%` : '-'}</dd></div>
            <div className="flex justify-between"><dt>Auto-apply at</dt><dd className="font-medium">{gs ? `${Math.round(gs.autoLikelyThreshold * 100)}%` : '-'}</dd></div>
            <div className="flex justify-between"><dt>Prompt caching</dt><dd className="font-medium">{gs ? (gs.usePromptCaching ? 'on' : 'off') : '-'}</dd></div>
            <div className="flex justify-between"><dt>Monthly token budget</dt><dd className="font-medium">{gs?.monthlyTokenBudget ? gs.monthlyTokenBudget.toLocaleString() : 'none'}</dd></div>
          </dl>
        </div>
      </div>
      {canEdit && <div className="mt-3 flex flex-wrap items-center gap-2"><SaveButton busy={busy} /><Result msg={msg} /></div>}
    </form>
  );
}

/**
 * A row of small provider cards. Clicking a small card toggles its full card open directly underneath (the other small cards stay put),
 * joined to the small card by a notch so it is clear which one is open; clicking the same small card again closes it.
 */
interface GridItem { id: string; small: (open: boolean, toggle: () => void) => React.ReactNode; big: React.ReactNode | null }
function ConnectedGrid({ items, open, setOpen }: { items: GridItem[]; open: string | null; setOpen: (id: string | null) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [notch, setNotch] = useState<number | null>(null);
  const current = items.find((i) => i.id === open && i.big) ?? null;
  useLayoutEffect(() => {
    const measure = () => {
      if (!current || !wrap.current) { setNotch(null); return; }
      const card = wrap.current.querySelector<HTMLElement>(`[data-slot="${CSS.escape(current.id)}"]`);
      if (!card) { setNotch(null); return; }
      const w = wrap.current.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      setNotch(c.left - w.left + c.width / 2);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [current?.id, items.length]);

  return (
    <div ref={wrap} className="relative">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.id} data-slot={it.id}>{it.small(open === it.id, () => setOpen(open === it.id ? null : it.id))}</div>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {current && (
          <motion.div key={current.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="relative mt-3">
            {notch != null && <span aria-hidden className="absolute -top-[7px] z-10 h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-l border-t border-brand-400 bg-white" style={{ left: notch }} />}
            {current.big}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProvidersTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can('ai_controls', 'edit');
  const q = useQuery({ queryKey: ['ai-providers'], queryFn: () => aiControlsApi.providers() });
  const d = q.data?.data;
  const [open, setOpen] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const settingsQ = useQuery({ queryKey: ['ai-settings-global'], queryFn: () => aiControlsApi.settings() });
  const gs: AiSettings | null = settingsQ.data?.data.find((x) => x.institutionId == null) ?? null;

  // The Active switch saves straight away: ON selects this provider, OFF leaves the category with no cloud provider (rules engine only).
  const setActive = async (id: string, choice: Partial<AiProviderSave>) => {
    setToggling(id); setMsg(null);
    try {
      await aiControlsApi.saveProviders(choice);
      setMsg({ ok: true, text: 'Updated. New calls use the change within ~15 seconds.' });
      void qc.invalidateQueries({ queryKey: ['ai-providers'] }); void qc.invalidateQueries({ queryKey: ['ai-readiness'] });
    } catch (e) { setMsg({ ok: false, text: errMsg(e, 'Could not change the active provider.') }); } finally { setToggling(null); }
  };

  if (q.isLoading || !d) return <p className="text-sm text-gray-400">Loading…</p>;
  const chat = d.chatProvider;
  const toggleChat = (id: ChatProviderId) => (v: boolean) => setActive(id, { chatProvider: v ? id : 'none' });
  const toggleDoc = (v: boolean) => setActive('doc_azure', { docProvider: v ? 'azure_document_intelligence' : 'none' });
  const azureOk = d.azureOpenAiKeySet && !!d.azureOpenAiEndpoint && !!d.azureOpenAiDeployment;
  const closeBtn = () => setOpen(null);

  return (
    <div className="space-y-6">
      {!d.ready && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Migration 023 (AppSettings) is not applied yet, so provider settings cannot be saved.</div>}
      {msg && <p className={cn('rounded-lg p-2 text-sm', msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{msg.text}</p>}

      <div>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Sparkles size={15} /> Course matching &amp; chat</h3>
        <p className="mb-3 text-xs text-gray-500">Open a card to set its key and URL. Only one provider is Active at a time; the built-in rules engine covers everything when none is.</p>
        <ConnectedGrid open={open} setOpen={setOpen} items={[
          {
            id: 'anthropic',
            small: (o, t) => <SmallCard icon={<Bot size={18} />} title="Anthropic (Claude)" sub={gs?.matchModel} active={chat === 'anthropic'} configured={d.anthropicKeySet} open={o} onOpen={t} />,
            big: <AnthropicForm d={d} gs={gs} canEdit={canEdit} onClose={closeBtn} active={chat === 'anthropic'} toggling={toggling === 'anthropic'} onToggle={(v) => { void setActive('anthropic', { chatProvider: v ? 'anthropic' : 'none' }); }} />,
          },
          {
            id: 'azure_openai',
            small: (o, t) => <SmallCard icon={<Zap size={18} />} title="Azure OpenAI" sub={d.azureOpenAiDeployment ?? undefined} active={chat === 'azure_openai'} configured={azureOk} open={o} onOpen={t} />,
            big: <AzureOpenAiForm d={d} gs={gs} canEdit={canEdit} onClose={closeBtn} active={chat === 'azure_openai'} toggling={toggling === 'azure_openai'} onToggle={(v) => { void setActive('azure_openai', { chatProvider: v ? 'azure_openai' : 'none' }); }} />,
          },
          ...d.customProviders.map((cp): GridItem => {
            const id = `custom:${cp.id}` as ChatProviderId;
            return {
              id,
              small: (o, t) => <SmallCard icon={<Server size={18} />} title={cp.name} sub={cp.model} active={chat === id} configured={!!cp.baseUrl && !!cp.model} open={o} onOpen={t} />,
              big: <CustomForm d={d} gs={gs} item={cp} canEdit={canEdit} onClose={closeBtn} active={chat === id} toggling={toggling === id} onToggle={(v) => { void toggleChat(id)(v); }} onSaved={() => undefined} />,
            };
          }),
          ...(canEdit ? [{
            id: 'new',
            small: (o: boolean, t: () => void) => (
              <button type="button" onClick={t} aria-expanded={o} className={cn('flex w-full items-center justify-center gap-2 rounded-xl border border-dashed bg-white p-3 text-sm font-medium hover:border-brand-400 hover:text-brand-800', o ? 'border-brand-500 text-brand-800' : 'border-gray-300 text-gray-600')}>
                <Plus size={16} /> Add provider
              </button>
            ),
            big: <CustomForm d={d} gs={gs} item={null} canEdit={canEdit} onClose={closeBtn} active={false} toggling={false} onToggle={() => undefined} onSaved={() => setOpen(null)} />,
          }] : []),
        ]} />
      </div>

      <ParamsPanel d={d} gs={gs} canEdit={canEdit} />

      <div>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Database size={15} /> Document reading</h3>
        <p className="mb-3 text-xs text-gray-500">Reads transcripts, IDs and score reports in Smart Upload. The built-in rules reader needs no cloud service.</p>
        <ConnectedGrid open={open} setOpen={setOpen} items={[
          { id: 'doc_none', small: () => <SmallCard icon={<Database size={18} />} title="Built-in rules reader" sub="no key needed" active={d.docProvider === 'none'} onOpen={() => setActive('doc_none', { docProvider: 'none' })} />, big: null },
          {
            id: 'doc_azure',
            small: (o, t) => <SmallCard icon={<Sparkles size={18} />} title="Azure Document Intelligence" active={d.docProvider === 'azure_document_intelligence'} configured={d.azureDocKeySet && !!d.azureDocEndpoint} open={o} onOpen={t} />,
            big: <DocAzureForm d={d} canEdit={canEdit} onClose={closeBtn} active={d.docProvider === 'azure_document_intelligence'} toggling={toggling === 'doc_azure'} onToggle={toggleDoc} />,
          },
        ]} />
      </div>
    </div>
  );
}

// ── Benchmark: the same transfer through each engine, measured ──
const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const fmtUsd = (n: number | null) => (n == null ? '-' : n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`);
const pct = (n: number | null) => (n == null ? '-' : `${n}%`);

function ScoreBar({ v, tone }: { v: number; tone?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-100"><div className={cn('h-full rounded-full', tone ?? 'bg-brand-700')} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} /></div>
      <span className="w-8 text-xs font-medium text-gray-700">{v}</span>
    </div>
  );
}

function SummaryTable({ rows, best }: { rows: BenchSummary[]; best?: string }) {
  const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500';
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50"><tr>
          <th className={th}>Engine</th><th className={th}>Top-1</th><th className={th}>Top-3</th><th className={th}>Avg / p95 time</th><th className={th}>Tokens in / out</th>
          <th className={th}>Cost</th><th className={th}>Cost per correct</th><th className={th}>Auto-apply (wrong)</th><th className={th}>Failed</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.engine} className={r.engine === best ? 'bg-green-50/50' : ''}>
              <td className="px-3 py-2"><span className="font-medium text-gray-900">{r.label}</span>{r.engine === best && <span className="ml-2 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Best overall</span>}<span className="block text-xs text-gray-500">{r.model}</span></td>
              <td className="px-3 py-2 font-medium">{pct(r.top1)}<span className="block text-xs font-normal text-gray-500">of {r.withTruth} known</span></td>
              <td className="px-3 py-2">{pct(r.top3)}</td>
              <td className="px-3 py-2">{fmtMs(r.avgMs)} <span className="text-gray-400">/ {fmtMs(r.p95Ms)}</span></td>
              <td className="px-3 py-2">{r.tokensIn.toLocaleString()} / {r.tokensOut.toLocaleString()}</td>
              <td className="px-3 py-2">{fmtUsd(r.costUsd)}</td>
              <td className="px-3 py-2">{fmtUsd(r.costPerCorrect)}</td>
              <td className="px-3 py-2">{r.autoApplied} <span className={r.autoWrong ? 'font-medium text-red-600' : 'text-gray-400'}>({r.autoWrong})</span></td>
              <td className={cn('px-3 py-2', r.failed ? 'font-medium text-red-600' : 'text-gray-400')}>{r.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BenchmarkTab() {
  const { can } = usePermissions();
  const canRun = can('ai_controls', 'edit');
  const engines = useQuery({ queryKey: ['bench-engines'], queryFn: () => aiControlsApi.benchmarkEngines() });
  const students = useQuery({ queryKey: ['bench-students'], queryFn: () => aiControlsApi.benchmarkStudents() });
  const [pickedStudents, setPickedStudents] = useState<string[] | null>(null);
  const [pickedEngines, setPickedEngines] = useState<string[] | null>(null);
  const [result, setResult] = useState<BenchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  const engList = engines.data?.data ?? [];
  const stuList = students.data?.data.students ?? [];
  const selStudents = pickedStudents ?? students.data?.data.defaults ?? [];
  const selEngines = pickedEngines ?? engList.filter((e) => e.ready).map((e) => e.id);
  const nCourses = stuList.filter((s) => selStudents.includes(s.id)).reduce((n, s) => n + s.courses, 0);
  const toggle = (list: string[], id: string, max = 99) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= max ? list : [...list, id]);

  const run = async () => {
    if (!window.confirm(`Run ${selEngines.length} engine${selEngines.length === 1 ? '' : 's'} over about ${nCourses} courses? Cloud engines use real tokens (typically a few cents in total). Nothing is saved.`)) return;
    setBusy(true); setErr(null);
    try { setResult((await aiControlsApi.runBenchmark({ studentIds: selStudents, engines: selEngines })).data); setOpenStudent(null); }
    catch (e) { setErr(errMsg(e, 'The benchmark failed.')); } finally { setBusy(false); }
  };
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `ai-benchmark-${result.generatedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const best = useMemo(() => (result ? [...result.summary].sort((a, b) => b.scores.overall - a.scores.overall)[0]?.engine : undefined), [result]);
  const caseKeys = useMemo(() => (result ? [...new Set(result.cases.map((c) => `${c.studentId}|${c.institution}|${c.courseCode}`))] : []), [result]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><FlaskConical size={15} /> Compare engines on a real transfer into Boston University</h3>
        <p className="mt-1 text-xs text-gray-500">
          Runs each chosen student&apos;s courses through the real matching step (shortlist, model call, answer check) for every selected engine, then scores the answers against past equivalency decisions
          (and the scripted reference answers for the Maya demo). It is a dry run: nothing is saved, cached or added to the usage log.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium text-gray-800">Students (up to 3)</p>
            {students.isLoading && <p className="text-xs text-gray-400">Loading…</p>}
            {!students.isLoading && !stuList.length && <p className="text-xs text-amber-700">No student with courses going to Boston University and known answers yet. Run the Maya demo scenario first (Demo scenario page).</p>}
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {stuList.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-gray-50">
                  <input type="checkbox" checked={selStudents.includes(s.id)} onChange={() => setPickedStudents(toggle(selStudents, s.id, 3))} />
                  <span className="font-medium text-gray-900">{s.name}</span><span className="text-xs text-gray-500">{s.courses} courses, {s.known} with a known answer</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-gray-800">Engines</p>
            <div className="space-y-1">
              {engList.map((e) => (
                <label key={e.id} className={cn('flex items-center gap-2 rounded-md px-2 py-1 text-sm', e.ready ? 'cursor-pointer hover:bg-gray-50' : 'opacity-50')}>
                  <input type="checkbox" disabled={!e.ready} checked={e.ready && selEngines.includes(e.id)} onChange={() => setPickedEngines(toggle(selEngines, e.id))} />
                  <span className="font-medium text-gray-900">{e.label}</span><span className="text-xs text-gray-500">{e.ready ? e.model : e.note}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        {canRun && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={run} disabled={busy || !selStudents.length || !selEngines.length} className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />} {busy ? 'Running… (can take a minute)' : 'Run benchmark'}
            </button>
            {result && <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Download size={14} /> Download results (JSON)</button>}
          </div>
        )}
        {err && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      </div>

      {result && (
        <>
          <div className="text-xs text-gray-500">
            Target: {result.target} · catalogue {result.settings.catalogSize} courses · {result.settings.prefilterTopN} sent per match · temperature {result.settings.temperature} · auto-apply at {Math.round(result.settings.autoApplyThreshold * 100)}% ·
            {' '}{result.students.map((s) => `${s.name} (${s.courses} courses)`).join(', ')} · {new Date(result.generatedAt).toLocaleString()}
            {result.skipped.length > 0 && <span className="text-amber-700"> · skipped: {result.skipped.map((s) => `${s.label} (${s.reason})`).join(', ')}</span>}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-900">Overall</h4>
            <SummaryTable rows={result.summary} best={best} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {result.summary.map((r) => (
              <div key={r.engine} className={cn('rounded-xl border bg-white p-4', r.engine === best ? 'border-green-400 ring-2 ring-green-200' : 'border-gray-200')}>
                <p className="font-semibold text-gray-900">{r.label}</p>
                <p className="mb-3 text-3xl font-bold text-brand-800">{r.scores.overall}<span className="text-sm font-normal text-gray-400"> / 100</span></p>
                <div className="space-y-1.5 text-xs text-gray-600">
                  <div className="flex items-center justify-between"><span>Accuracy</span><ScoreBar v={r.scores.accuracy} /></div>
                  <div className="flex items-center justify-between"><span>Speed</span><ScoreBar v={r.scores.speed} tone="bg-sky-600" /></div>
                  <div className="flex items-center justify-between"><span>Cost efficiency</span><ScoreBar v={r.scores.cost} tone="bg-emerald-600" /></div>
                </div>
                <p className="mt-3 text-xs text-gray-500">{r.correctPerMinute != null ? `${r.correctPerMinute} correct matches per minute` : ''}{r.avgConfidenceRight != null ? ` · confidence when right ${Math.round(r.avgConfidenceRight * 100)}%` : ''}{r.avgConfidenceWrong != null ? `, when wrong ${Math.round(r.avgConfidenceWrong * 100)}%` : ''}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">Score = 50% accuracy (60% top-1 + 40% top-3) + 25% speed (relative to the fastest engine) + 25% cost (100 = free). &ldquo;Auto-apply (wrong)&rdquo; counts answers confident enough to be applied automatically and, in brackets, how many of those disagreed with the known answer: the number that matters most for safety.</p>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">By student</h4>
            {result.perStudent.map((p) => (
              <div key={p.studentId}>
                <button type="button" onClick={() => setOpenStudent(openStudent === p.studentId ? null : p.studentId)} className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-800" aria-expanded={openStudent === p.studentId}>
                  <ChevronUp size={14} className={cn('transition-transform', openStudent === p.studentId ? '' : 'rotate-180')} /> {p.name}
                </button>
                <SummaryTable rows={p.summary} />
                {openStudent === p.studentId && (
                  <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50 text-left text-gray-500"><tr><th className="px-3 py-2">Course</th><th className="px-3 py-2">Known answer</th>{result.engines.map((e) => <th key={e.id} className="px-3 py-2">{e.label}</th>)}</tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {caseKeys.filter((k) => k.startsWith(`${p.studentId}|`)).map((k) => {
                          const rows = result.cases.filter((c) => `${c.studentId}|${c.institution}|${c.courseCode}` === k);
                          const f = rows[0];
                          return (
                            <tr key={k}>
                              <td className="px-3 py-2"><span className="font-medium text-gray-900">{f.institution} {f.courseCode}</span><span className="block text-gray-500">{f.courseTitle}</span></td>
                              <td className="px-3 py-2">{f.expected ? <>{f.expected.buCode}<span className="block text-[10px] text-gray-400">{f.expected.source === 'scenario' ? 'demo reference' : 'past decision'}</span></> : <span className="text-gray-400">unknown</span>}</td>
                              {result.engines.map((e) => {
                                const c = rows.find((x) => x.engine === e.id);
                                if (!c) return <td key={e.id} />;
                                return (
                                  <td key={e.id} className="px-3 py-2">
                                    {c.error ? <span className="text-red-600">{c.error}</span> : (
                                      <>
                                        <span className={cn('font-medium', c.hit1 === true ? 'text-green-700' : c.hit1 === false ? 'text-red-600' : 'text-gray-700')}>{c.hit1 === true ? '✓ ' : c.hit1 === false ? '✗ ' : ''}{c.picks[0]?.buCode ?? 'no match'}</span>
                                        {c.picks[0] && <span className="text-gray-400"> {Math.round(c.picks[0].confidence * 100)}%</span>}
                                        <span className="block text-gray-400">{fmtMs(c.totalMs)}{c.usage ? ` · ${c.usage.input + c.usage.output} tok` : ''}{c.costUsd ? ` · ${fmtUsd(c.costUsd)}` : ''}{c.hit1 === false && c.rank ? ` · answer was #${c.rank}` : ''}</span>
                                      </>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-500">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
    </div>
  );
}

export default function AiControls() {
  const [tab, setTab] = useState<Tab>('usage');
  const [days, setDays] = useState(30);
  const tabs: { key: Tab; label: string }[] = [
    { key: 'usage', label: 'Usage' }, { key: 'requests', label: '$ Spent by request' },
    { key: 'settings', label: 'Settings' }, { key: 'providers', label: 'Providers' }, { key: 'benchmark', label: 'Benchmark' }, { key: 'learning', label: 'Learning' }, { key: 'playbook', label: 'Agent playbook' },
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
      {tab === 'benchmark' && <BenchmarkTab />}
      {tab === 'learning' && <LearningTab />}
      {tab === 'playbook' && <PlaybookTab />}
    </div>
  );
}
