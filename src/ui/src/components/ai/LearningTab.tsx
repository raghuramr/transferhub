import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, BookOpen, Check, Minus, Plus, ShieldCheck, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { aiControlsApi, universitiesApi } from '../../lib/api';
import { demoLearning, learningApi, type Headline, type LearningMistake } from '../../lib/api-learning';
import { cn } from '../../lib/cn';
import { usePermissions } from '../../hooks/usePermissions';

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** One headline number with a delta arrow against four weeks ago. `lowerIsBetter` flips the colour. */
function Kpi({ icon, label, h, unit, hint }: { icon: React.ReactNode; label: string; h: Headline; unit: '%' | ''; hint: string }) {
  const d = h.delta;
  const up = d != null && d > 0;
  const down = d != null && d < 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4" data-testid={`kpi-${label}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">{icon}{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-gray-900">{h.value == null ? '–' : `${h.value}${unit}`}</span>
        {d != null && (
          <span className={cn('inline-flex items-center gap-0.5 text-sm font-semibold', up && 'text-emerald-600', down && 'text-red-600', !up && !down && 'text-gray-400')}>
            {up ? <ArrowUp size={14} /> : down ? <ArrowDown size={14} /> : <Minus size={14} />}
            {Math.abs(d)}{unit === '%' ? ' pts' : ''}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500">{hint}{h.previous != null && <> · 4 weeks ago: {h.previous}{unit}</>}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-[10rem] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">{children}</div>;
}

function MistakeRow({ m, demo, onAdd, adding }: { m: LearningMistake; demo: boolean; onAdd: (m: LearningMistake) => void; adding: boolean }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-100 p-3">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-gray-900">{m.extInstitution} {m.extCode} <span className="font-normal text-gray-500">{m.extLabel}</span></p>
        <p className="mt-0.5 text-xs text-gray-600">
          The agent suggested <strong>{m.aiCode}</strong>, faculty chose <strong>{m.decidedCode}</strong> · {m.count} times
        </p>
      </div>
      {m.alreadyInPlaybook ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><Check size={12} /> In playbook</span>
      ) : (
        <button type="button" disabled={adding || demo} title={demo ? 'Demo data - nothing can be saved' : undefined} onClick={() => onAdd(m)}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-900 disabled:opacity-50">
          <Plus size={12} /> Turn into a playbook rule
        </button>
      )}
    </li>
  );
}

export default function LearningTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can('ai_controls', 'edit');
  const [weeks, setWeeks] = useState(26);
  const [inst, setInst] = useState<number | null>(null);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState('');

  const unis = useQuery({ queryKey: ['md-universities'], queryFn: () => universitiesApi.list({ isActive: true }) });
  const trendQ = useQuery({ queryKey: ['learning-trend', weeks, inst], queryFn: () => learningApi.trend(weeks, inst), enabled: !demo });
  const overviewQ = useQuery({ queryKey: ['learning-overview', inst], queryFn: () => learningApi.overview(inst), enabled: !demo });

  const demoData = useMemo(() => (demo ? demoLearning(weeks) : null), [demo, weeks]);
  const trend = demoData ? demoData.trend : trendQ.data?.data;
  const overview = demoData ? demoData.overview : overviewQ.data?.data;
  const failed = !demo && (trendQ.isError || overviewQ.isError);

  const addRule = useMutation({
    mutationFn: (m: LearningMistake) => aiControlsApi.saveSkill(null, { title: m.title, category: 'matching', instructions: m.instructions, isActive: true, sortOrder: 100 }),
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: ['learning-overview'] });
      void qc.invalidateQueries({ queryKey: ['ai-skills'] });
      void qc.invalidateQueries({ queryKey: ['ai-learned-skills'] });
      void qc.invalidateQueries({ queryKey: ['ai-prompt-preview'] });
    },
    onError: () => setError('Could not add the rule.'),
  });

  const series = trend?.series ?? [];
  const scored = series.reduce((a, p) => a + p.withSuggestion, 0);
  const hasAccuracy = scored > 0;
  const hasKb = series.some((p) => p.knowledgeBase > 0);
  const chartData = series.map((p) => ({ ...p, label: shortDate(p.weekStart) }));
  const unitList = (unis.data?.data ?? []) as { id: number; name: string }[];
  const h = overview?.headlines;

  return (
    <div className="space-y-6" data-testid="learning-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" aria-label="Weeks to show">
            {[12, 26, 52].map((w) => <option key={w} value={w}>Last {w} weeks</option>)}
          </select>
          <select value={inst ?? ''} disabled={demo} onChange={(e) => setInst(e.target.value ? Number(e.target.value) : null)} className="max-w-[16rem] rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50" aria-label="University">
            <option value="">All universities</option>
            {unitList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Load demo trend (synthetic)
        </label>
      </div>

      {demo && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" role="status" data-testid="demo-banner">
          <strong>Synthetic demo data.</strong> Every number and chart below is made up for presentations. It is generated in your browser and is not read from or saved to the system.
        </div>
      )}
      {failed && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">Could not load learning data. Try again in a moment.</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={<TrendingUp size={14} />} label="Agreement" unit="%" h={h?.agreement ?? { value: null, previous: null, delta: null }} hint="Top pick = faculty choice" />
        <Kpi icon={<Sparkles size={14} />} label="Top-3 hit rate" unit="%" h={h?.top3 ?? { value: null, previous: null, delta: null }} hint="Right answer in the top 3" />
        <Kpi icon={<ShieldCheck size={14} />} label="Auto-apply safety" unit="%" h={h?.safety ?? { value: null, previous: null, delta: null }} hint="Confident picks that held up" />
        <Kpi icon={<Zap size={14} />} label="Instant answers" unit="%" h={h?.instantShare ?? { value: null, previous: null, delta: null }} hint="Courses already in the knowledge base" />
        <Kpi icon={<BookOpen size={14} />} label="Knowledge base" unit="" h={h?.knowledgeBase ?? { value: null, previous: null, delta: null }} hint="Known equivalency pairs" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Is the matcher getting better?</h3>
          <p className="mb-3 text-xs text-gray-500">Weekly agreement and top-3 hit rate over decided courses.</p>
          <div className="h-64 w-full" data-testid="chart-accuracy">
            {hasAccuracy ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="gAgree" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7a1626" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#7a1626" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => (v == null ? 'no data' : `${v}%`)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="agreementRate" name="Agreement" stroke="#7a1626" strokeWidth={2} fill="url(#gAgree)" connectNulls />
                  <Line type="monotone" dataKey="top3Rate" name="Top-3 hit rate" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <Empty>{trendQ.isLoading && !demo ? 'Loading…' : 'Decide a few courses to see trends. Each course a faculty member decides after the agent made a suggestion adds a data point here.'}</Empty>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Knowledge base vs instant answers</h3>
          <p className="mb-3 text-xs text-gray-500">Every confirmed equivalency means the next student gets an instant answer.</p>
          <div className="h-64 w-full" data-testid="chart-knowledge">
            {hasKb || series.some((p) => p.incoming > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 0, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="gKb" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f766e" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#0f766e" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis yAxisId="kb" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v, name) => (v == null ? 'no data' : name === 'Instant answers' ? `${v}%` : v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area yAxisId="kb" type="monotone" dataKey="knowledgeBase" name="Known equivalencies" stroke="#0f766e" strokeWidth={2} fill="url(#gKb)" />
                  <Line yAxisId="pct" type="monotone" dataKey="instantShare" name="Instant answers" stroke="#d97706" strokeWidth={2} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <Empty>{trendQ.isLoading && !demo ? 'Loading…' : 'No equivalencies or incoming courses in this period yet. Once faculty confirm matches, the knowledge base grows here.'}</Empty>
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4" data-testid="recurring-mistakes">
          <h3 className="text-sm font-semibold text-gray-900">Recurring mistakes</h3>
          <p className="mb-3 text-xs text-gray-500">Course pairs the agent keeps getting wrong. Turn one into a playbook rule and it stops.</p>
          {overview && overview.recurringMistakes.length > 0 ? (
            <ul className="space-y-2">
              {overview.recurringMistakes.map((m) => (
                <MistakeRow key={m.key} m={m} demo={demo} adding={addRule.isPending || !canEdit} onAdd={(x) => addRule.mutate(x)} />
              ))}
            </ul>
          ) : (
            <Empty>{overviewQ.isLoading && !demo ? 'Looking for patterns…' : 'No repeated mistakes yet. A pair shows up here once faculty override the same suggestion twice.'}</Empty>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4" data-testid="learned-feed">
          <h3 className="text-sm font-semibold text-gray-900">This month the system learned</h3>
          <p className="mb-3 text-xs text-gray-500">Last {overview?.learned.days ?? 30} days.</p>
          {overview && overview.hasData ? (
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3"><span className="mt-0.5 rounded-full bg-teal-50 p-1.5 text-teal-700"><BookOpen size={14} /></span>
                <div><strong>{overview.learned.newEquivalencies}</strong> new equivalenc{overview.learned.newEquivalencies === 1 ? 'y' : 'ies'} added to the knowledge base
                  {overview.learned.newEquivalencyExamples.length > 0 && <p className="mt-0.5 text-xs text-gray-500">e.g. {overview.learned.newEquivalencyExamples.join('; ')}</p>}
                </div></li>
              <li className="flex items-start gap-3"><span className="mt-0.5 rounded-full bg-brand-50 p-1.5 text-brand-700"><Sparkles size={14} /></span>
                <div><strong>{overview.learned.playbookRulesAdded}</strong> playbook rule{overview.learned.playbookRulesAdded === 1 ? '' : 's'} added or edited by an administrator</div></li>
              <li className="flex items-start gap-3"><span className="mt-0.5 rounded-full bg-emerald-50 p-1.5 text-emerald-700"><Check size={14} /></span>
                <div><strong>{overview.learned.patternsResolved}</strong> repeated override pattern{overview.learned.patternsResolved === 1 ? '' : 's'} that stopped recurring</div></li>
            </ul>
          ) : (
            <Empty>{overviewQ.isLoading && !demo ? 'Loading…' : 'Nothing learned yet. Faculty decisions and new equivalencies will be listed here.'}</Empty>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600" data-testid="how-measured">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">How accuracy is measured</h3>
        <p>
          Each time a faculty member decides a course that the agent (or the built-in rules) had suggested a match for, we compare the two.
          <strong> Agreement</strong> is how often the top suggestion was the course faculty chose; <strong>top-3 hit rate</strong> is how often the chosen course was among the first three suggestions.
          <strong> Auto-apply safety</strong> looks at suggestions at or above the auto-apply confidence threshold ({trend ? Math.round(trend.autoApplyThreshold * 100) : 85}%) and shows the share faculty agreed with.
          <strong> Instant answers</strong> are incoming courses already covered by a known equivalency, so no matching was needed. Elective and no-credit decisions are not scored here.
          Weeks start on Monday (UTC). Figures compare the last 4 weeks with the 4 weeks before; small samples ({h ? `${h.sampleSize.current} scored decisions recently` : 'few decisions'}) move a lot.
        </p>
      </section>
    </div>
  );
}
