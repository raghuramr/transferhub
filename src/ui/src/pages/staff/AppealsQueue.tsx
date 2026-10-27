import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Gavel, Loader2 } from 'lucide-react';
import { appealsApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/cn';
import { BuCoursePicker } from '../../components/policy/PolicyBits';
import { downloadUpload } from '../../components/workflow/RequestPanels';
import type { Appeal } from '../../types/policy';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};
const OUTCOME_LABEL: Record<string, string> = { equivalent: 'BU equivalent', elective: 'Elective credit', no_credit: 'No credit', denied: 'Denied' };
const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

/** Step 2 of BU's Transfer Credit Appeal Form, completed by the department. */
function DecisionForm({ appeal, onDone }: { appeal: Appeal; onDone: (msg: string) => void }) {
  const user = useAuthStore((s) => s.user);
  const [outcome, setOutcome] = useState<'equivalent' | 'elective' | 'no_credit' | 'denied'>('equivalent');
  const [course, setCourse] = useState<{ id: number; code: string; title: string; credits?: number } | null>(
    appeal.proposedCourseId ? { id: appeal.proposedCourseId, code: appeal.proposedCode ?? '', title: appeal.proposedTitle ?? '' } : null,
  );
  const [credits, setCredits] = useState('');
  const [satisfies, setSatisfies] = useState('');
  const [denial, setDenial] = useState('');
  const [dept, setDept] = useState('');
  const [comments, setComments] = useState('');
  const [signed, setSigned] = useState(user ? `${user.firstName} ${user.lastName}` : '');
  const [error, setError] = useState('');

  const decide = useMutation({
    mutationFn: () =>
      appealsApi.decide(appeal.id, {
        outcome,
        buCourseId: outcome === 'equivalent' || outcome === 'elective' ? course?.id : undefined,
        awardedCredits: credits ? Number(credits) : undefined,
        satisfiesRequirement: satisfies || undefined,
        denialReason: outcome === 'denied' ? denial : undefined,
        departmentName: dept,
        comments: comments || undefined,
        signedName: signed,
      }),
    onSuccess: (r) => onDone(r.data.message),
    onError: (e) => setError(errMsg(e, 'Could not record the decision.')),
  });

  const valid = dept.trim().length >= 2 && signed.trim().length >= 2 &&
    (outcome !== 'equivalent' || !!course) && (outcome !== 'denied' || denial.trim().length > 0);

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap gap-2">
        {(['equivalent', 'elective', 'no_credit', 'denied'] as const).map((o) => (
          <button key={o} type="button" onClick={() => setOutcome(o)}
            className={cn('rounded-full px-3 py-1 text-sm font-medium', outcome === o ? (o === 'denied' ? 'bg-red-600 text-white' : 'bg-brand-800 text-white') : 'bg-white text-gray-700 ring-1 ring-gray-200')}>
            {OUTCOME_LABEL[o]}
          </button>
        ))}
      </div>
      {(outcome === 'equivalent' || outcome === 'elective') && (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">BU course {outcome === 'elective' && '(optional for elective credit)'}</label>
            <BuCoursePicker value={course} onChange={(c) => setCourse(c)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Credits awarded</label>
            <input value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="decimal" placeholder="auto" className={inputCls} />
          </div>
        </div>
      )}
      {outcome !== 'denied' && outcome !== 'no_credit' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Will satisfy the following requirement</label>
          <input value={satisfies} onChange={(e) => setSatisfies(e.target.value)} maxLength={300} placeholder="e.g. CS major core; not Hub" className={inputCls} />
        </div>
      )}
      {outcome === 'denied' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Reason for denial (sent to the student)</label>
          <textarea value={denial} onChange={(e) => setDenial(e.target.value)} rows={2} maxLength={1000} className={inputCls} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Department</label>
          <input value={dept} onChange={(e) => setDept(e.target.value)} maxLength={150} placeholder="e.g. Computer Science" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Signed by</label>
          <input value={signed} onChange={(e) => setSigned(e.target.value)} maxLength={150} className={inputCls} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Department comments (optional, shown to the student)</label>
        <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} maxLength={4000} className={inputCls} />
      </div>
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Date is recorded automatically. The decision posts straight away if the request is already complete.</span>
        <button type="button" disabled={!valid || decide.isPending} onClick={() => decide.mutate()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white disabled:bg-brand-300">
          {decide.isPending && <Loader2 size={14} className="animate-spin" />} Record decision
        </button>
      </div>
    </div>
  );
}

export default function AppealsQueue() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'decided' | 'all'>('open');
  const [open, setOpen] = useState<number | null>(null);
  const [banner, setBanner] = useState('');
  const q = useQuery({ queryKey: ['appeals', status], queryFn: () => appealsApi.list(status) });
  const rows = q.data?.data ?? [];

  return (
    <div className="mx-auto w-[95%] max-w-6xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Gavel size={24} /> Transfer credit appeals</h1>
          <p className="mt-1 text-gray-500">Students asking for a course to be re-evaluated. One course per appeal, with the reason and syllabus attached.</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(['open', 'decided', 'all'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={cn('rounded-md px-3 py-1.5 font-medium capitalize', status === s ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-50')}>
              {s === 'open' ? 'Waiting' : s}
            </button>
          ))}
        </div>
      </div>
      {banner && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{banner}</div>}
      {q.isLoading && <p className="text-gray-400">Loading…</p>}
      {!q.isLoading && rows.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">No appeals here.</div>}

      <ul className="space-y-3">
        {rows.map((a) => (
          <li key={a.id} className="rounded-xl border border-gray-200 bg-white">
            <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full flex-wrap items-start justify-between gap-3 p-4 text-left">
              <div>
                <div className="font-semibold text-gray-900">{a.courseCode} · {a.courseTitle}</div>
                <div className="text-sm text-gray-500">{a.studentName}{a.buid ? ` (${a.buid})` : ''} · {a.institutionName} · {a.credits} cr ({a.calendar}) · grade {a.grade}{a.termSeason ? ` · ${a.termSeason} ${a.termYear ?? ''}` : ''}</div>
                <div className="mt-1 text-xs text-gray-500">
                  Currently: {a.currentOutcome ? `${OUTCOME_LABEL[a.currentOutcome] ?? a.currentOutcome}${a.currentCode ? ` (${a.currentCode})` : ''}` : a.lane.replace('_', ' ')}
                  {' · '}Proposed: <strong>{a.proposedCode ? `${a.proposedCode} ${a.proposedTitle ?? ''}` : a.proposedEquivalent}</strong>
                </div>
              </div>
              <div className="text-right text-xs text-gray-400">
                {new Date(a.createdAt).toLocaleDateString()}
                {a.status === 'decided' && <div className="mt-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">{OUTCOME_LABEL[a.outcome ?? '']}</div>}
              </div>
            </button>
            {open === a.id && (
              <div className="space-y-3 border-t border-gray-100 p-4">
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-gray-800"><span className="font-medium">Reason for re-evaluation:</span> {a.reason}</div>
                <div className="flex flex-wrap gap-4 text-sm">
                  {a.syllabusUploadId ? (
                    <button type="button" onClick={() => downloadUpload(a.syllabusUploadId!, `syllabus-${a.courseCode}.pdf`)} className="inline-flex items-center gap-1.5 text-brand-800 hover:underline">
                      <FileDown size={14} /> Syllabus
                    </button>
                  ) : <span className="text-amber-700">No syllabus attached</span>}
                  <Link to={`/requests/${a.transcriptId}`} className="text-brand-800 hover:underline">Open the request</Link>
                </div>
                {a.status === 'submitted' ? (
                  <DecisionForm appeal={a} onDone={(m) => { setBanner(m); setOpen(null); void qc.invalidateQueries({ queryKey: ['appeals'] }); }} />
                ) : (
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-gray-500">Outcome</dt><dd>{OUTCOME_LABEL[a.outcome ?? '']}{a.decidedCode ? `: ${a.decidedCode} ${a.decidedTitle ?? ''}` : ''}{a.awardedCredits != null ? ` (${a.awardedCredits} cr)` : ''}</dd></div>
                    <div><dt className="text-gray-500">Department</dt><dd>{a.departmentName} · signed {a.signedName} · {a.decidedAt ? new Date(a.decidedAt).toLocaleDateString() : ''}</dd></div>
                    {a.satisfiesRequirement && <div><dt className="text-gray-500">Satisfies</dt><dd>{a.satisfiesRequirement}</dd></div>}
                    {a.denialReason && <div><dt className="text-gray-500">Denial reason</dt><dd>{a.denialReason}</dd></div>}
                    {a.comments && <div className="sm:col-span-2"><dt className="text-gray-500">Comments</dt><dd>{a.comments}</dd></div>}
                  </dl>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
