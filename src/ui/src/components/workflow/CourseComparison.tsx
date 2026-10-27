import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, FileText, Loader2, Scale } from 'lucide-react';
import { api, evaluationsApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import { FlagList } from '../policy/PolicyBits';
import { downloadUpload } from './RequestPanels';
import type { PolicyFlag } from '../../types/policy';

// ── shapes returned by GET /comparison/evaluation/:id ───────────────────────────
interface Topic { id: number; title: string; description?: string | null }
interface CourseSide { code: string; title: string; description: string | null; outcomes: string[]; topics: Topic[]; credits?: number; institutionName?: string | null; id?: number }
interface CreditMath {
  calendar: string | null; externalCredits: number; factor: number; convertedCredits: number; buCredits: number | null;
  difference: number | null; status: 'exact' | 'shortfall' | 'surplus' | 'no_candidate'; quarterTruncated: boolean; note: string;
  awardIfEquivalent: number | null; awardIfElective: number;
}
interface Candidate {
  rank: number; score: number | null; rationale: string | null; source: string;
  course: CourseSide & { id: number; credits: number };
  overlap: { sharedTerms: string[]; overlapPct: number; externalTermCount: number; buTermCount: number; topicMatches: { external: string; bu: string; sharedTerms: string[] }[] };
  credits: CreditMath;
}
export interface ComparisonData {
  evaluationId: string; status: string; aiConfidence: number | null; aiRationale: string | null;
  decision: { outcome: string; awardedCredits: number | null; buCourse: { id: number; code: string; title: string } | null } | null;
  external: CourseSide & {
    institutionName: string; calendar: string | null; originalCredits: number; normalisedCredits: number | null; grade: string; term: string | null; lane: string;
    syllabus: { attached: boolean; files: { uploadId: string | null; fileName: string | null }[]; catalogUrl: string | null };
  };
  candidates: Candidate[];
  creditsWithoutCandidate: CreditMath;
  policyFlags: PolicyFlag[];
}

// ── pure helpers (no React) ─────────────────────────────────────────────────────
/** Splits text into plain / shared-word segments. Words are matched the way the API tokenises (letters, digits, + and #). */
export function highlightSegments(text: string, shared: Set<string>): { text: string; hit: boolean }[] {
  if (!text) return [];
  return text
    .split(/([A-Za-z0-9+#]+)/)
    .filter((p) => p !== '')
    .map((p) => ({ text: p, hit: /^[A-Za-z0-9+#]+$/.test(p) && shared.has(p.toLowerCase()) }));
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 100) / 100));

function Hl({ text, shared }: { text: string; shared: Set<string> }) {
  const segs = useMemo(() => highlightSegments(text, shared), [text, shared]);
  return (
    <>
      {segs.map((s, i) => (s.hit ? <mark key={i} className="rounded bg-amber-200/80 px-0.5 text-inherit">{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <div className="break-words text-sm text-gray-700">{children}</div>
    </div>
  );
}

function SideColumn({ heading, sub, course, shared, matched, extra }: {
  heading: string; sub: string; course: CourseSide; shared: Set<string>; matched: Set<string>; extra?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-gray-200 bg-white p-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-800">{heading}</p>
        <p className="break-words text-sm font-semibold text-gray-900">{course.code} {course.title}</p>
        <p className="text-xs text-gray-500">{sub}</p>
      </div>
      {extra}
      <Block label="Description">
        {course.description ? <Hl text={course.description} shared={shared} /> : <span className="text-gray-400">No description on file.</span>}
      </Block>
      <Block label="Learning outcomes">
        {course.outcomes.length ? (
          <ul className="list-disc space-y-0.5 pl-4">{course.outcomes.map((o, i) => <li key={i}><Hl text={o} shared={shared} /></li>)}</ul>
        ) : <span className="text-gray-400">None on file.</span>}
      </Block>
      <Block label={`Topics (${course.topics.length})`}>
        {course.topics.length ? (
          <ul className="space-y-0.5">
            {course.topics.map((t) => (
              <li key={t.id} className="flex items-start gap-1.5">
                <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', matched.has(t.title) ? 'bg-emerald-500' : 'bg-gray-300')} />
                <span className={matched.has(t.title) ? 'font-medium text-emerald-800' : undefined}><Hl text={t.title} shared={shared} /></span>
              </li>
            ))}
          </ul>
        ) : <span className="text-gray-400">No topics recorded.</span>}
      </Block>
    </div>
  );
}

function CreditMathBlock({ m, candidateCode }: { m: CreditMath; candidateCode?: string }) {
  const tone = m.status === 'exact' ? 'text-emerald-700' : m.status === 'shortfall' ? 'text-red-700' : m.status === 'surplus' ? 'text-sky-700' : 'text-gray-600';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm" data-testid="credit-math">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Credit math</p>
      <p className="break-words text-gray-800">
        {fmt(m.externalCredits)} {m.calendar ?? 'semester'} credit{m.externalCredits === 1 ? '' : 's'}
        {m.factor !== 1 && <> × 2/3</>} = <span className="font-semibold">{fmt(m.convertedCredits)}</span> converted
        {m.buCredits != null && <> vs <span className="font-semibold">{fmt(m.buCredits)}</span> for {candidateCode}</>}
        {m.difference != null && (
          <span className={cn('ml-1 font-semibold', tone)}>
            ({m.status === 'exact' ? 'exact' : m.status === 'shortfall' ? `shortfall ${fmt(Math.abs(m.difference))}` : `surplus ${fmt(m.difference)}`})
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-gray-500">{m.note}</p>
    </div>
  );
}

const outcomeLabel: Record<string, string> = { equivalent: 'Equivalent', elective: 'Elective', no_credit: 'No credit', bu_only: 'BU only' };

export default function CourseComparison({ evaluationId, requestId, canDecide }: { evaluationId: string; requestId: string; canDecide: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['comparison', evaluationId],
    queryFn: async () => (await api.get<ComparisonData>(`/comparison/evaluation/${evaluationId}`)).data,
    retry: false,
  });
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setPick(0), [evaluationId]);

  if (isLoading) return <div className="flex items-center gap-2 p-4 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading comparison…</div>;
  if (error || !data) {
    const text = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;
    return <div className="p-4 text-sm text-red-600">Could not load the comparison{text ? `: ${text}` : '.'}</div>;
  }

  const cand = data.candidates[Math.min(pick, data.candidates.length - 1)] as Candidate | undefined;
  const shared = new Set(cand?.overlap.sharedTerms ?? []);
  const matchedExt = new Set((cand?.overlap.topicMatches ?? []).map((t) => t.external));
  const matchedBu = new Set((cand?.overlap.topicMatches ?? []).map((t) => t.bu));
  const ext = data.external;
  const math = cand?.credits ?? data.creditsWithoutCandidate;
  const decided = !!data.decision;

  const decide = async (key: string, payload: { outcome: string; buCourseId?: number; awardedCredits?: number }, label: string) => {
    if (!window.confirm(`Record "${label}" for ${ext.code}?`)) return;
    setBusy(key);
    setMsg(null);
    try {
      await evaluationsApi.decide(evaluationId, { ...payload, notes: 'Decided from the side-by-side comparison.' });
      setMsg({ ok: true, text: `Recorded: ${label}.` });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['comparison', evaluationId] }),
        qc.invalidateQueries({ queryKey: ['request', requestId] }),
      ]);
    } catch (e) {
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setMsg({ ok: false, text: m ? [m].flat().join(' ') : 'That did not work.' });
    } finally {
      setBusy(null);
    }
  };

  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40';

  return (
    <div className="space-y-3 rounded-xl border border-brand-100 bg-gray-50 p-3 sm:p-4" data-testid="comparison-panel">
      {/* candidate switcher + overlap */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"><Scale size={13} /> Compare with</span>
        {data.candidates.length === 0 && <span className="text-sm text-gray-500">No BU candidates yet. Run the match, or decide below.</span>}
        {data.candidates.map((c, i) => (
          <button key={c.course.id} type="button" onClick={() => setPick(i)}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium', i === pick ? 'border-brand-800 bg-brand-800 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100')}>
            #{c.rank} {c.course.code}{c.score != null ? ` · ${Math.round(c.score * 100)}%` : ''}
          </button>
        ))}
        {cand && (
          <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900" title="Shared words / topics, same tokeniser as the matcher">
            {cand.overlap.overlapPct}% text overlap · {cand.overlap.sharedTerms.length} shared terms
          </span>
        )}
      </div>

      {data.decision && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Decided: <span className="font-semibold">{outcomeLabel[data.decision.outcome] ?? data.decision.outcome}</span>
          {data.decision.buCourse && <> → {data.decision.buCourse.code} {data.decision.buCourse.title}</>}
          {data.decision.awardedCredits != null && <> ({fmt(data.decision.awardedCredits)} cr)</>}
        </p>
      )}

      {/* side by side */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SideColumn
          heading="Transferring course"
          sub={`${ext.institutionName} · ${ext.term ?? 'term n/a'}`}
          course={ext}
          shared={shared}
          matched={matchedExt}
          extra={
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-gray-500">Credits taken</dt><dd className="font-medium text-gray-800">{fmt(ext.originalCredits)}</dd>
              <dt className="text-gray-500">Converted</dt><dd className="font-medium text-gray-800">{fmt(math.convertedCredits)}</dd>
              <dt className="text-gray-500">Grade</dt><dd className="font-medium text-gray-800">{ext.grade}</dd>
              <dt className="text-gray-500">Syllabus</dt>
              <dd className="min-w-0 font-medium">
                {ext.syllabus.attached ? (
                  <span className="space-y-0.5">
                    {ext.syllabus.files.map((f, i) => f.uploadId ? (
                      <button key={i} type="button" onClick={() => void downloadUpload(f.uploadId!, f.fileName ?? 'syllabus')} className="flex max-w-full items-center gap-1 text-left text-brand-800 hover:underline">
                        <FileText size={12} className="shrink-0" /> <span className="truncate">{f.fileName ?? 'Syllabus'}</span>
                      </button>
                    ) : null)}
                    {ext.syllabus.catalogUrl && (
                      <a href={ext.syllabus.catalogUrl} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-1 text-brand-800 hover:underline">
                        <ExternalLink size={12} className="shrink-0" /> <span className="truncate">Catalogue link</span>
                      </a>
                    )}
                  </span>
                ) : <span className="font-normal text-gray-400">not provided</span>}
              </dd>
            </dl>
          }
        />
        {cand ? (
          <SideColumn
            heading={`BU candidate #${cand.rank}`}
            sub={`${cand.course.institutionName ?? 'Receiving university'} · ${fmt(cand.course.credits)} credits`}
            course={cand.course}
            shared={shared}
            matched={matchedBu}
            extra={cand.rationale ? <p className="rounded-md bg-indigo-50 p-2 text-xs text-indigo-900">{cand.rationale}</p> : undefined}
          />
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-400">No candidate to compare.</div>
        )}
      </div>

      {cand && cand.overlap.topicMatches.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm" data-testid="topic-matches">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Matching topics ({cand.overlap.topicMatches.length})</p>
          <ul className="space-y-0.5 text-gray-700">
            {cand.overlap.topicMatches.map((t, i) => (
              <li key={i} className="break-words"><span className="font-medium">{t.external}</span> ↔ <span className="font-medium">{t.bu}</span>{t.sharedTerms.length > 0 && <span className="text-xs text-gray-500"> ({t.sharedTerms.join(', ')})</span>}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <CreditMathBlock m={math} candidateCode={cand?.course.code} />
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Rules and policy flags</p>
          {data.policyFlags.length ? <FlagList flags={data.policyFlags} /> : <p className="text-sm text-gray-500">No policy flags on this course.</p>}
          <p className="mt-2 text-xs text-gray-500">Lane: <span className="font-medium">{ext.lane.replace('_', ' ')}</span>{data.aiConfidence != null && <> · AI confidence {Math.round(data.aiConfidence * 100)}%</>}</p>
        </div>
      </div>

      {/* actions: the existing decision endpoint (POST /evaluations/:id/decide) */}
      {canDecide ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!cand || busy !== null} onClick={() => cand && void decide('eq', { outcome: 'equivalent', buCourseId: cand.course.id, awardedCredits: cand.credits.awardIfEquivalent ?? undefined }, `equivalent to ${cand.course.code}`)}
              className={cn(btn, 'bg-emerald-600 text-white hover:bg-emerald-700')}>
              {busy === 'eq' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Accept as equivalent{cand ? ` (${cand.course.code}, ${fmt(cand.credits.awardIfEquivalent)} cr)` : ''}
            </button>
            <button type="button" disabled={!cand || busy !== null} onClick={() => cand && void decide('el', { outcome: 'elective', buCourseId: cand.course.id, awardedCredits: cand.credits.awardIfElective }, `elective credit (${cand.course.code} area)`)}
              className={cn(btn, 'border border-blue-300 text-blue-700 hover:bg-blue-50')}>
              {busy === 'el' && <Loader2 size={14} className="animate-spin" />} Elective credit ({fmt(math.awardIfElective)} cr)
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void decide('nc', { outcome: 'no_credit', awardedCredits: 0 }, 'no credit')}
              className={cn(btn, 'border border-red-300 text-red-700 hover:bg-red-50')}>
              {busy === 'nc' && <Loader2 size={14} className="animate-spin" />} No credit
            </button>
          </div>
          {decided && <p className="text-xs text-gray-500">This course already has a decision; choosing again replaces it.</p>}
        </div>
      ) : (
        <p className="text-xs text-gray-500">Only the people assigned to the current stage can record decisions.</p>
      )}
      {msg && <p className={cn('flex items-center gap-1.5 text-sm', msg.ok ? 'text-emerald-700' : 'text-red-600')}>{!msg.ok && <AlertTriangle size={14} />} {msg.text}</p>}
    </div>
  );
}
