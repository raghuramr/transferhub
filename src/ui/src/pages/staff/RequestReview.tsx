import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Coins, Flag, FastForward, Loader2, Play, RotateCcw, Sparkles, Undo2, X, Zap } from 'lucide-react';
import { requestsApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/cn';
import { GeneralNotes, RequestTimeline, formatDateTime } from '../../components/workflow/RequestTimeline';
import { DocumentsPanel, NoteComposer, ReminderPanel } from '../../components/workflow/RequestPanels';
import { CreditHubCard, EvaluationKindBanner, FlagList } from '../../components/policy/PolicyBits';
import StudentProfileCard from '../../components/policy/StudentProfileCard';
import type { RequestTimeline as TimelineData, StageBrief, TimelineStage } from '../../types/workflow';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};

const WORKFLOW_BADGE: Record<string, string> = {
  active: 'bg-brand-50 text-brand-800',
  approved: 'bg-emerald-50 text-emerald-700',
  bypassed: 'bg-violet-50 text-violet-700',
  rejected: 'bg-red-50 text-red-700',
};

function AcceptSuggestions({ brief, requestId, onDone }: { brief: StageBrief; requestId: string; onDone: (t: TimelineData) => void }) {
  const [min, setMin] = useState(0.8);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const open = brief.courses.filter((c) => !c.decided && c.suggested && c.suggested.confidence != null);
  const ready = open.filter((c) => (c.suggested!.confidence ?? 0) >= min).length;
  if (!open.length && !msg) return null;
  const run = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = (await requestsApi.acceptSuggestions(requestId, min)).data;
      setMsg(`Accepted ${r.accepted} suggestion${r.accepted === 1 ? '' : 's'}${r.belowThreshold ? `; ${r.belowThreshold} below ${Math.round(min * 100)}% left for you` : ''}.`);
      onDone(r.timeline);
    } catch (e) {
      setMsg(errMsg(e, 'Could not accept the suggestions.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 text-sm">
      <Sparkles size={15} className="text-indigo-600" />
      <span className="text-gray-700">Accept every AI suggestion at or above</span>
      <select value={min} onChange={(e) => setMin(Number(e.target.value))} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm">
        {[0.7, 0.8, 0.9].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
      </select>
      <button type="button" disabled={busy || ready === 0} onClick={() => void run()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Accept {ready} match{ready === 1 ? '' : 'es'}
      </button>
      {msg && <span className="text-gray-600">{msg}</span>}
    </div>
  );
}

function Brief({ brief, evalBase, requestId, canAct, onDone }: { brief: StageBrief; evalBase: string; requestId: string; canAct: boolean; onDone: (t: TimelineData) => void }) {
  const t = brief.totals;
  const chips = [
    { label: 'Applied', n: t.applied, cls: 'bg-emerald-50 text-emerald-700' },
    { label: 'Likely match', n: t.likely, cls: 'bg-sky-50 text-sky-700' },
    { label: 'Needs syllabus', n: t.needsSyllabus, cls: 'bg-amber-50 text-amber-700' },
    { label: 'Elective only', n: t.electiveOnly, cls: 'bg-orange-50 text-orange-700' },
    { label: 'Not eligible', n: t.notEligible, cls: 'bg-red-50 text-red-700' },
  ].filter((c) => c.n > 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900"><Sparkles size={16} className="text-indigo-600" /> Decision brief</h2>
        <span className="text-xs text-gray-400">prepared {formatDateTime(brief.generatedAt)}</span>
      </div>
      {brief.narrative && <p className="mb-3 rounded-lg bg-indigo-50/60 p-3 text-sm text-gray-700">{brief.narrative}</p>}
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{t.courses} courses</span>
        {chips.map((c) => <span key={c.label} className={cn('rounded-full px-2.5 py-1 font-medium', c.cls)}>{c.n} {c.label}</span>)}
        <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{brief.credits.applied} credits secured</span>
        {brief.credits.atStake > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">{brief.credits.atStake} credits undecided</span>}
      </div>
      {brief.flags.length > 0 && (
        <ul className="mb-3 space-y-1">
          {brief.flags.map((f) => (
            <li key={f} className="flex items-start gap-1.5 text-sm text-amber-800"><Flag size={13} className="mt-0.5 shrink-0" /> {f}</li>
          ))}
        </ul>
      )}
      {!!brief.notes?.length && (
        <ul className="mb-3 space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          {brief.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {brief.previousStages.some((p) => p.comment) && (
        <div className="mb-3 space-y-1 text-sm text-gray-600">
          {brief.previousStages.filter((p) => p.comment).map((p) => (
            <p key={p.stage}><span className="font-medium text-gray-700">{p.stage}:</span> {p.comment}</p>
          ))}
        </div>
      )}
      {canAct && <AcceptSuggestions brief={brief} requestId={requestId} onDone={onDone} />}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-400">
            <tr><th className="py-1.5 pr-3">Course</th><th className="pr-3">Grade</th><th className="pr-3">Credits</th><th className="pr-3">AI suggestion</th><th className="pr-3">Decision</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {brief.courses.map((c) => (
              <tr key={c.code + c.title}>
                <td className="py-2 pr-3">
                  <div className="font-medium text-gray-800">{c.code}</div><div className="text-xs text-gray-500">{c.title}</div>
                  <FlagList flags={c.flags} compact />
                  {canAct && c.courseId && c.flags?.some((f) => f.code === 'pass_fail') && (
                    <button type="button" onClick={() => void requestsApi.passFailException(requestId, c.courseId!, true).then((r) => onDone(r.data.timeline))}
                      className="mt-1 text-xs font-medium text-brand-800 hover:underline">
                      Accept P/F (college required it)
                    </button>
                  )}
                </td>
                <td className="pr-3">{c.grade}</td>
                <td className="pr-3">{c.credits}</td>
                <td className="pr-3">
                  {c.suggested ? (
                    <div>
                      <div className="text-gray-800">{c.suggested.code}</div>
                      {c.suggested.confidence != null && (
                        <div className={cn('text-xs', c.suggested.confidence >= 0.75 ? 'text-emerald-600' : c.suggested.confidence >= 0.6 ? 'text-amber-600' : 'text-red-600')}>
                          {Math.round(c.suggested.confidence * 100)}% confidence
                        </div>
                      )}
                    </div>
                  ) : <span className="text-xs text-gray-400">{c.lane.replace('_', ' ')}</span>}
                </td>
                <td className="pr-3 text-xs text-gray-600">
                  {c.decided ? `${c.decided.outcome?.replace('_', ' ') ?? ''}${c.decided.code ? ` → ${c.decided.code}` : ''}${c.decided.awardedCredits != null ? ` (${c.decided.awardedCredits} cr)` : ''}` : '—'}
                </td>
                <td className="text-right">
                  {c.evaluationId && <Link to={`${evalBase}/${c.evaluationId}`} className="text-xs font-medium text-brand-800 hover:underline">Open</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DecisionPanel({ requestId, stage, canAct, isAdmin, onDone }: {
  requestId: string; stage: TimelineStage; canAct: boolean; isAdmin: boolean; onDone: (t: TimelineData) => void;
}) {
  const [internal, setInternal] = useState('');
  const [forStudent, setForStudent] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [adminReason, setAdminReason] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);

  const run = async (key: string, fn: () => Promise<{ data: { timeline: TimelineData } }>) => {
    setBusy(key);
    setError('');
    try {
      onDone((await fn()).data.timeline);
      setInternal('');
      setForStudent('');
      setAdminReason('');
    } catch (e) {
      setError(errMsg(e, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  };
  const decide = (decision: 'approve' | 'reject' | 'return') =>
    run(decision, () => requestsApi.decide(requestId, { decision, comment: internal || undefined, studentComment: forStudent || undefined }));

  if (stage.type === 'system') {
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 text-sm text-indigo-900">
        <p className="flex items-center gap-2 font-medium"><Zap size={15} /> This stage runs automatically.</p>
        <p className="mt-1 text-indigo-800/80">If it looks stuck (for example the server restarted mid-way), an admin can resume it.</p>
        {isAdmin && (
          <button type="button" disabled={busy !== null} onClick={() => run('resume', () => requestsApi.resume(requestId))}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50">
            {busy === 'resume' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Resume automation
          </button>
        )}
        {error && <p className="mt-2 text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-brand-200 bg-white p-4 shadow-sm">
      {canAct ? (
        <>
          <p className="text-sm font-medium text-gray-800">Your decision on “{stage.name}”</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-gray-500">
              Internal comment <span className="font-normal">(this stage's team + admins only)</span>
              <textarea value={internal} onChange={(e) => setInternal(e.target.value)} rows={2} maxLength={4000}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </label>
            <label className="block text-xs font-medium text-gray-500">
              Comment for the student <span className="font-normal">(required when rejecting)</span>
              <textarea value={forStudent} onChange={(e) => setForStudent(e.target.value)} rows={2} maxLength={4000}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => decide('approve')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy === 'approve' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Approve
            </button>
            <button type="button" disabled={busy !== null} onClick={() => decide('reject')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {busy === 'reject' ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} Reject
            </button>
            <button type="button" disabled={busy !== null} onClick={() => decide('return')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy === 'return' ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />} Send back
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500">This stage is waiting on {stage.approvers.join(', ') || 'its approvers'}. You can still add notes.</p>
      )}

      {isAdmin && (
        <div className="border-t border-gray-100 pt-3">
          <button type="button" onClick={() => setAdminOpen((o) => !o)} className="text-xs font-medium text-violet-700 hover:underline">
            {adminOpen ? 'Hide admin controls' : 'Admin controls: skip or accept directly'}
          </button>
          {adminOpen && (
            <div className="mt-2 space-y-2">
              <input value={adminReason} onChange={(e) => setAdminReason(e.target.value)} placeholder="Reason (required, kept in the audit trail)"
                className="w-full rounded-lg border border-violet-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
              <div className="flex flex-wrap gap-2">
                {stage.canSkip && (
                  <button type="button" disabled={busy !== null || adminReason.trim().length < 5}
                    onClick={() => run('skip', () => requestsApi.skipStage(requestId, adminReason.trim()))}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-40">
                    <FastForward size={14} /> Skip this stage
                  </button>
                )}
                <button type="button" disabled={busy !== null || adminReason.trim().length < 5}
                  onClick={() => run('accept', () => requestsApi.accept(requestId, adminReason.trim()))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40">
                  <FastForward size={14} /> Accept request now (bypass remaining stages)
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p className="flex items-center gap-1.5 text-sm text-red-600"><AlertTriangle size={14} /> {error}</p>}
    </div>
  );
}

function UsageCard({ requestId }: { requestId: string }) {
  const { data } = useQuery({ queryKey: ['request-ai-usage', requestId], queryFn: () => requestsApi.aiUsage(requestId), retry: false });
  const u = data?.data;
  if (!u) return null;
  const total = u.inputTokens + u.outputTokens + u.cacheTokens;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800"><Coins size={14} /> AI usage for this request</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Model calls</dt><dd className="text-right font-medium">{u.calls}</dd>
        <dt className="text-gray-500">Tokens used</dt><dd className="text-right font-medium">{total.toLocaleString()}</dd>
        <dt className="text-gray-500">Est. cost</dt><dd className="text-right font-medium">${u.costUsd.toFixed(4)}</dd>
        <dt className="text-gray-500">Tokens saved</dt><dd className="text-right font-medium text-emerald-600">~{u.tokensSaved.toLocaleString()}</dd>
      </dl>
    </div>
  );
}

export default function RequestReview() {
  const { id } = useParams<{ id: string }>();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin' || role === 'super_admin';
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['request', id], queryFn: () => requestsApi.timeline(id!), refetchInterval: 30_000 });
  const tl = data?.data;
  const set = (t: TimelineData) => {
    qc.setQueryData(['request', id], { data: t });
    void qc.invalidateQueries({ queryKey: ['requests-queue'] });
    void qc.invalidateQueries({ queryKey: ['request-ai-usage', id] });
  };
  const [startBusy, setStartBusy] = useState(false);

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading…</div>;
  if (error || !tl) return <div className="p-8 text-center text-red-500">Could not load this request.</div>;

  const active = tl.stages.find((s) => s.status === 'active');
  const evalBase = role === 'faculty' ? '/faculty/evaluation' : '/admin/evaluation';
  const wfStatus = tl.transcript.workflowStatus;

  return (
    <div className="mx-auto w-[95%] max-w-6xl p-4 sm:p-6">
      <Link to="/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> Queue</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tl.transcript.studentName}</h1>
          <p className="mt-1 text-gray-500">
            {tl.transcript.institutionName}{tl.transcript.targetInstitutionName && <> → {tl.transcript.targetInstitutionName}</>} · submitted {formatDateTime(tl.transcript.receivedAt)}
          </p>
          {tl.transcript.workflow && <p className="mt-0.5 text-xs text-gray-400">Workflow: {tl.transcript.workflow.name}</p>}
        </div>
        {wfStatus && (
          <span className={cn('rounded-full px-3 py-1 text-sm font-medium capitalize', WORKFLOW_BADGE[wfStatus])}>
            {wfStatus === 'active' ? 'In progress' : wfStatus}
          </span>
        )}
      </div>

      <EvaluationKindBanner
        kind={tl.transcript.evaluationKind}
        expiresAt={tl.transcript.preapprovalExpiresAt}
        action={tl.permissions.canMakeOfficial ? (
          <button type="button" disabled={startBusy}
            onClick={async () => {
              if (!window.confirm('Mark this student as admitted? Their preview request(s) become official evaluations and enter the approval workflow.')) return;
              setStartBusy(true);
              try { set((await requestsApi.makeOfficial(id!)).data.timeline); } finally { setStartBusy(false); }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            {startBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Mark admitted and start official evaluation
          </button>
        ) : undefined}
      />

      {!tl.transcript.workflow && tl.transcript.evaluationKind !== 'preview' && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This request was submitted before approval workflows existed, so it has no stages yet.
          {tl.permissions.canStartWorkflow && (
            <button type="button" disabled={startBusy}
              onClick={async () => { setStartBusy(true); try { set((await requestsApi.startWorkflow(id!)).data.timeline); } finally { setStartBusy(false); } }}
              className="ml-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {startBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Start workflow
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <CreditHubCard credit={tl.credit} />
          {active?.aiBrief && <Brief brief={active.aiBrief} evalBase={evalBase} requestId={id!} canAct={tl.permissions.canAct} onDone={set} />}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Progress</h2>
            <RequestTimeline
              stages={tl.stages}
              renderActive={(s) => <DecisionPanel requestId={id!} stage={s} canAct={tl.permissions.canAct} isAdmin={isAdmin} onDone={set} />}
            />
            <div className="mt-6"><GeneralNotes notes={tl.generalNotes} /></div>
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <StudentProfileCard p={tl.student} />
          <NoteComposer requestId={id!} timeline={tl} onUpdated={set} />
          <DocumentsPanel requestId={id!} timeline={tl} onUpdated={set} />
          <ReminderPanel requestId={id!} timeline={tl} onSent={() => void qc.invalidateQueries({ queryKey: ['request', id] })} />
          {tl.permissions.canSeeAiUsage && <UsageCard requestId={id!} />}
        </div>
      </div>
    </div>
  );
}
