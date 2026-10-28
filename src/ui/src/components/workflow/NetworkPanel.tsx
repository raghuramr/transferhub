import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Globe2, Loader2 } from 'lucide-react';
import { api, evaluationsApi } from '../../lib/api';
import { networkApi } from '../../lib/api-network';
import { formatDateTime } from './RequestTimeline';
import { AgreementChip } from './NetworkBits';
import type { ComparisonData } from './CourseComparison';

const OUTCOME: Record<string, string> = { equivalent: 'Equivalent', elective: 'Elective', no_credit: 'No credit', bu_only: 'Receiving only' };

/**
 * "Seen across the network": how other universities (anonymised, counts only) treated this same outside course, plus this
 * university's own past decisions by name. Sits under the side-by-side comparison in the evaluator workbench.
 */
export default function NetworkPanel({ evaluationId, requestId, canDecide }: { evaluationId: string; requestId: string; canDecide: boolean }) {
  const qc = useQueryClient();
  // Same cache entry the comparison panel uses, so this costs no extra request when it is open.
  const cmp = useQuery({
    queryKey: ['comparison', evaluationId],
    queryFn: async () => (await api.get<ComparisonData>(`/comparison/evaluation/${evaluationId}`)).data,
    retry: false,
  });
  const candidates = cmp.data?.candidates ?? [];
  const ids = candidates.map((c) => c.course.id);
  const { data, isLoading, error } = useQuery({
    queryKey: ['network-course', evaluationId, ids.join(',')],
    queryFn: async () => (await networkApi.course({ evaluationId, candidateIds: ids })).data,
    enabled: !cmp.isLoading,
    retry: false,
  });
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (isLoading || cmp.isLoading) return <div className="flex items-center gap-2 p-3 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Checking the network…</div>;
  if (error || !data) return <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500">Network history is not available right now.</div>;

  const decided = !!cmp.data?.decision;
  const supported = candidates.filter((c) => data.candidateSupport[String(c.course.id)]);
  const maxUnis = Math.max(1, ...data.targets.map((t) => t.universities));

  const use = async (courseId: number) => {
    const cand = candidates.find((c) => c.course.id === courseId);
    if (!cand || !window.confirm(`Record "Equivalent" to ${cand.course.code} for ${cmp.data?.external.code}?`)) return;
    setBusy(courseId);
    setMsg(null);
    try {
      await evaluationsApi.decide(evaluationId, {
        outcome: 'equivalent', buCourseId: courseId, awardedCredits: cand.credits.awardIfEquivalent ?? undefined,
        notes: `Decided using the network suggestion (${data.acceptedAsEquivalent} other universities accepted this course).`,
      });
      setMsg({ ok: true, text: `Recorded: ${cand.course.code}.` });
      await Promise.all([qc.invalidateQueries({ queryKey: ['comparison', evaluationId] }), qc.invalidateQueries({ queryKey: ['request', requestId] })]);
    } catch (e) {
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setMsg({ ok: false, text: m ? [m].flat().join(' ') : 'That did not work.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-sky-100 bg-sky-50/40 p-3 sm:p-4" data-testid="network-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"><Globe2 size={13} /> Seen across the network</span>
        <AgreementChip level={data.agreementLevel} agreement={data.agreement} />
        {data.lastDecisionAt && <span className="ml-auto text-xs text-gray-500">Latest decision {formatDateTime(data.lastDecisionAt)}</span>}
      </div>
      <p className="text-sm font-semibold text-gray-900" data-testid="network-headline">{data.headline}</p>
      {data.otherUniversities > 0 && (
        <p className="text-xs text-gray-500">
          {data.outcomes.elective > 0 && <>{data.outcomes.elective} gave elective credit · </>}
          {data.outcomes.no_credit > 0 && <>{data.outcomes.no_credit} gave no credit · </>}
          Other universities are shown as counts only.
        </p>
      )}

      {data.targets.length > 0 && (
        <ul className="space-y-1.5" aria-label="Receiving courses chosen elsewhere">
          {data.targets.slice(0, 5).map((t) => (
            <li key={t.key} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-gray-800">{t.title}</span>
                <span className="shrink-0 text-xs text-gray-500">{t.universities} {t.universities === 1 ? 'university' : 'universities'} · {t.sharePct}%{t.avgCredits != null && <> · avg {t.avgCredits} cr</>}</span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(4, t.sharePct)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {supported.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Matches among your candidates</p>
          {supported.map((c) => {
            const s = data.candidateSupport[String(c.course.id)];
            return (
              <div key={c.course.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm">
                <span className="min-w-0 break-words font-medium text-gray-900">{c.course.code} {c.course.title}</span>
                <span className="text-xs text-emerald-700">accepted by {s.universities} other {s.universities === 1 ? 'university' : 'universities'}</span>
                {canDecide && !decided && (
                  <button type="button" disabled={busy !== null} onClick={() => void use(c.course.id)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-900 disabled:opacity-40">
                    {busy === c.course.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Use this match
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data.own.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Your university&apos;s past decisions</p>
          {data.own.map((o, i) => (
            <p key={i} className="break-words text-sm text-gray-700">
              <span className="font-medium">{o.universityName}</span>: {OUTCOME[o.outcome] ?? o.outcome} → {o.targetCourse.code} {o.targetCourse.title}
              {o.awardedCredits != null && <> ({o.awardedCredits} cr)</>}
              {o.decidedAt && <span className="text-xs text-gray-400"> · {formatDateTime(o.decidedAt)}</span>}
            </p>
          ))}
        </div>
      )}
      {data.boostEnabled && <p className="text-xs text-sky-700">Confidence boost from network agreement is ON, so scores above may include it (noted in each rationale).</p>}
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600'}>{msg.text}</p>}
    </div>
  );
}
