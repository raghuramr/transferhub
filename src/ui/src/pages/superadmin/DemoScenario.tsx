import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Circle, ExternalLink, Flame, Layers, Presentation, RotateCcw, UserPlus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

type StepState = 'done' | 'current' | 'upcoming';
interface Step { key: string; state: StepState; detail: string }
interface DemoCourse {
  transcriptId: string; institutionCode: string; code: string; title: string; grade: string; lane: string; status: string;
  originalCredits: number; normalisedCredits: number | null; outcome: string | null; awardedCredits: number | null; decidedBuCode: string | null;
}
interface DemoTranscript { id: string; institutionCode: string; institutionName: string; status: string; workflowStatus: string | null; currentStage: string | null }
interface Eq { buCode: string; outcome: string; credits: number | null; source: string }
interface DemoStatus {
  scenarioPresent: boolean; catalogueReady: boolean; workflowReady: boolean;
  student: { id: string; name: string; email: string } | null;
  transcripts: DemoTranscript[]; courses: DemoCourse[];
  equivalencies: { csc220: Eq | null; csc240: Eq | null; cis150: Eq | null };
  secureCredits: number; steps: Step[]; learningLoop: 'not_ready' | 'ready' | 'not_applied' | 'proven';
  secondStudent: { name: string; email: string; transcriptId: string; status: string; lane: string | null; autoApplied: boolean } | null;
}

const LANE: Record<string, { label: string; tone: 'green' | 'amber' | 'gray' | 'red' | 'blue' }> = {
  applied: { label: 'Applied', tone: 'green' },
  likely: { label: 'Likely', tone: 'blue' },
  needs_syllabus: { label: 'Needs review', tone: 'amber' },
  elective_only: { label: 'Elective only', tone: 'gray' },
  not_eligible: { label: 'Not eligible', tone: 'red' },
  pending: { label: 'Pending', tone: 'gray' },
};

const fmt = (n: number | null) => (n == null ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function DemoScenario() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<null | 'reset' | 'second' | 'hard' | 'baseline'>(null);
  const [baselineCredits, setBaselineCredits] = useState('30');
  const [toast, setToast] = useState<null | { kind: 'ok' | 'err'; text: string }>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const { data, isLoading, error, refetch } = useQuery<DemoStatus>({
    queryKey: ['demo', 'status'],
    queryFn: async () => (await api.get('/demo/status')).data,
    refetchInterval: 10_000,
  });

  const onDone = (text: string) => { setToast({ kind: 'ok', text }); setConfirm(null); qc.invalidateQueries({ queryKey: ['demo'] }); };
  const onFail = (e: unknown) => {
    const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
    setToast({ kind: 'err', text: Array.isArray(msg) ? msg.join(', ') : msg ?? 'The request failed.' });
    setConfirm(null);
  };
  const reset = useMutation({ mutationFn: async () => (await api.post('/demo/maya/reset')).data, onSuccess: (d) => onDone(d.message), onError: onFail });
  const second = useMutation({ mutationFn: async () => (await api.post('/demo/maya/second-student')).data, onSuccess: (d) => onDone(d.message), onError: onFail });
  const hardReset = useMutation({ mutationFn: async () => (await api.post('/demo/maya/hard-reset')).data, onSuccess: (d) => onDone(d.message), onError: onFail });
  const baseline = useMutation({
    mutationFn: async () => (await api.post('/demo/maya/build-baseline', { targetCredits: Number(baselineCredits) || 30 })).data,
    onSuccess: (d) => onDone(d.message),
    onError: onFail,
  });
  const busy = reset.isPending || second.isPending || hardReset.isPending || baseline.isPending;

  const bscc = data?.transcripts.find((t) => t.institutionCode === 'BSCC');
  const pvtc = data?.transcripts.find((t) => t.institutionCode === 'PVTC');
  const req = (id?: string) => (id ? `/requests/${id}` : '/requests');
  const secondLink = data?.secondStudent ? `/requests/${data.secondStudent.transcriptId}` : undefined;

  const stepDefs: Array<{ key: string; title: string; say: string; links: Array<{ label: string; to: string }>; hint?: string }> = [
    { key: 'upload', title: 'Upload the transcript', say: 'Maya uploads her community-college transcripts. Six courses appear with parsed credits and grades.',
      hint: 'Student view: sign in as student@test.edu, open "Upload transcript" and "My requests".', links: [{ label: 'Open the Bay State request (staff view)', to: req(bscc?.id) }] },
    { key: 'instant_status', title: 'Instant status', say: 'Three courses are applied at once (11 credits secure), two wait for the department, one has the quarter conversion explained.',
      hint: 'Student view: Dashboard > degree progress card.', links: [{ label: 'Approval queue', to: '/requests' }, { label: 'Transfers', to: '/transfers' }] },
    { key: 'syllabus', title: 'Syllabus request (courses 4 and 5)', say: 'Only CSC 220 and CSC 240 ask for a syllabus, each with a one-line reason.',
      links: [{ label: 'Bay State request', to: req(bscc?.id) }] },
    { key: 'workbench', title: 'Evaluator workbench: course 4', say: 'Open CSC 220: syllabus next to CS 112 (CS 111 second), credit maths shown. Choose BU equivalent CS 112.',
      hint: 'Sign in as faculty.cs@bu.edu or admin@bu.edu to decide.', links: [{ label: 'Bay State request', to: req(bscc?.id) }] },
    { key: 'quarter', title: 'Quarter course: course 6', say: 'CIS 150: 4 quarter credits x 2/3 = 2.66 semester credits against MA 242 (4). Shortfall shown; pick equivalent or elective.',
      links: [{ label: 'Pioneer Valley request', to: req(pvtc?.id) }] },
    { key: 'posting', title: 'Posting', say: 'Approve the remaining stages; all six courses are posted and the student totals and degree progress update.',
      hint: 'Student view: Dashboard shows posted credits.', links: [{ label: 'Bay State request', to: req(bscc?.id) }, { label: 'Pioneer Valley request', to: req(pvtc?.id) }] },
    { key: 'learning_loop', title: 'Learning loop', say: 'The next student from the same college with CSC 220 is applied automatically, with no review.',
      links: [...(secondLink ? [{ label: 'Second student request', to: secondLink }] : []), { label: 'Equivalencies', to: '/admin/equivalencies' }] },
  ];

  return (
    <div className="w-[95%] max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Presentation size={24} className="text-brand-800" /> Demo scenario</h1>
            <Badge tone="purple">Presenter tool</Badge>
          </div>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            The Maya Rivera six-course walkthrough (synthetic data). Reset puts the demo back to upload state so it can be played again; it only touches the demo requests
            and the equivalencies created by the CSC 220, CSC 240 and CIS 150 decisions. Real data is never changed.
          </p>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Starting a live walkthrough from zero: <strong>Hard reset</strong> wipes everything, then <strong>Build baseline</strong> gives Maya a solid
            secured-credit position before you go on stage. Generate the matching paperwork on the{' '}
            <Link to="/superadmin/settings/demo-documents" className="text-brand-800 underline">Demo documents</Link> page, then drop a document live
            via Smart Upload during the demo itself to show the auto-populate step.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" icon={<UserPlus size={16} />} disabled={busy || !data?.scenarioPresent} onClick={() => setConfirm('second')}>Add second student (learning loop)</Button>
          <Button icon={<RotateCcw size={16} />} disabled={busy} onClick={() => setConfirm('reset')}>Reset Maya scenario</Button>
          <Button variant="outline" icon={<Layers size={16} />} disabled={busy} onClick={() => setConfirm('baseline')}>Build baseline (secured credits)</Button>
          <Button variant="danger" icon={<Flame size={16} />} disabled={busy} onClick={() => setConfirm('hard')}>Hard reset (wipe everything)</Button>
        </div>
      </div>

      {error ? (
        <Card className="p-4 text-sm text-red-700 flex items-center gap-2"><AlertTriangle size={16} /> Could not load the demo status. <button className="underline" onClick={() => refetch()}>Retry</button></Card>
      ) : null}
      {data && !data.catalogueReady ? (
        <Card className="p-4 text-sm text-amber-800 bg-amber-50 border-amber-200 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> The Bay State / Pioneer Valley demo catalogue is missing. Apply <code>database/seed/015_demo_maya_scenario.sql</code> first.</Card>
      ) : null}
      {data && data.catalogueReady && !data.workflowReady ? (
        <Card className="p-4 text-sm text-amber-800 bg-amber-50 border-amber-200 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> The approval workflow tables (migration 013) are not applied: requests will have no timeline.</Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {isLoading ? <Card className="p-6 text-sm text-gray-500">Loading...</Card> : null}
          {stepDefs.map((def, i) => {
            const st = data?.steps.find((s) => s.key === def.key);
            const state: StepState = st?.state ?? 'upcoming';
            return (
              <Card key={def.key} className={cn('p-4 sm:p-5', state === 'current' && 'ring-2 ring-brand-800/30', state === 'done' && 'bg-green-50/40')}>
                <div className="flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    {state === 'done' ? <CheckCircle2 size={22} className="text-green-600" /> : state === 'current' ? <Circle size={22} className="text-brand-800 fill-brand-100" /> : <Circle size={22} className="text-gray-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold text-gray-900">{i + 1}. {def.title}</h2>
                      {state === 'current' ? <Badge tone="brand">Next</Badge> : state === 'done' ? <Badge tone="green">Done</Badge> : null}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{def.say}</p>
                    {st ? <p className="text-xs font-medium text-gray-800 mt-2">Live: {st.detail}</p> : null}
                    {def.hint ? <p className="text-xs text-gray-500 mt-1">{def.hint}</p> : null}
                    <div className="flex gap-2 flex-wrap mt-3">
                      {def.links.map((l) => (
                        <Link key={l.label} to={l.to} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-800 bg-brand-50 hover:bg-brand-100 rounded-lg px-2.5 py-1.5">
                          {l.label} <ExternalLink size={12} />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Right now</h2>
            <dl className="text-sm space-y-2">
              <Row label="Scenario">{data ? (data.scenarioPresent ? <Badge tone="green">Loaded</Badge> : <Badge tone="amber">Not loaded</Badge>) : '-'}</Row>
              <Row label="Secure credits">{data ? fmt(data.secureCredits) : '-'}</Row>
              <Row label="CSC 220 equivalency">{data?.equivalencies.csc220 ? <Badge tone="green">{data.equivalencies.csc220.buCode}</Badge> : <Badge>None</Badge>}</Row>
              <Row label="CSC 240 equivalency">{data?.equivalencies.csc240 ? <Badge tone="green">{data.equivalencies.csc240.buCode}</Badge> : <Badge>None</Badge>}</Row>
              <Row label="CIS 150 equivalency">{data?.equivalencies.cis150 ? <Badge tone="green">{data.equivalencies.cis150.buCode}</Badge> : <Badge>None</Badge>}</Row>
              <Row label="Second student">
                {data?.secondStudent ? <Badge tone={data.secondStudent.autoApplied ? 'green' : 'amber'}>{data.secondStudent.autoApplied ? 'Auto-applied' : 'Not applied'}</Badge> : <Badge>Not added</Badge>}
              </Row>
            </dl>
            {data?.learningLoop === 'not_applied' ? (
              <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-2 mt-3">CSC 220 was not auto-applied. Decide CSC 220 for Maya, then add the second student again.</p>
            ) : null}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Maya's six courses</h2>
            {data && data.courses.length ? (
              <ul className="divide-y divide-gray-100">
                {data.courses.map((c) => {
                  const lane = LANE[c.lane] ?? LANE.pending;
                  const posted = c.status === 'posted' || c.status === 'decided';
                  return (
                    <li key={`${c.institutionCode}-${c.code}`} className="py-2 flex items-start justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">{c.code} <span className="text-gray-400 font-normal">{c.institutionCode}</span></div>
                        <div className="text-xs text-gray-500">
                          {c.originalCredits} cr{c.normalisedCredits != null && c.normalisedCredits !== c.originalCredits ? ` = ${fmt(c.normalisedCredits)} semester cr` : ''} · {c.grade}
                          {c.decidedBuCode ? ` · ${c.decidedBuCode} (${fmt(c.awardedCredits)} cr)` : ''}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge tone={lane.tone}>{lane.label}</Badge>
                        {posted ? <Badge tone="blue">{c.status === 'posted' ? 'Posted' : 'Decided'}</Badge> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-gray-500">No demo courses yet. Press "Reset Maya scenario".</p>}
            {data?.transcripts.length ? (
              <p className="text-xs text-gray-500 mt-3">
                {data.transcripts.map((t) => `${t.institutionCode}: ${t.currentStage ?? t.workflowStatus ?? t.status}`).join(' · ')}
              </p>
            ) : null}
          </Card>

          <Card className="p-4 sm:p-5 text-xs text-gray-600 space-y-1">
            <h2 className="font-semibold text-sm text-gray-900 mb-1">Demo logins</h2>
            <p>Student Maya: student@test.edu / Student@123!</p>
            <p>Faculty: faculty.cs@bu.edu / Faculty@123!</p>
            <p>Admin: admin@bu.edu / Admin@123!</p>
            <p className="pt-1 text-gray-500">Full script: docs/DEMO_SCRIPT.md</p>
          </Card>
        </div>
      </div>

      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-gray-900">
                {confirm === 'reset' ? 'Reset the Maya scenario?' : confirm === 'second' ? 'Add the second student?' : confirm === 'hard' ? 'Hard reset Maya?' : 'Build a baseline transcript?'}
              </h3>
              <button aria-label="Close" onClick={() => setConfirm(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-600">
              {confirm === 'reset'
                ? 'This deletes the demo requests for Maya (and Noah), including every decision made on them, removes the equivalencies those decisions created for CSC 220, CSC 240 and CIS 150, and rebuilds the six courses at upload state. Nothing else is touched.'
                : confirm === 'second'
                ? 'Noah Chen, from Bay State, submits a transcript with CSC 220 through the normal submission path. If CSC 220 already has an equivalency it is applied automatically. Any earlier second-student request is replaced.'
                : confirm === 'hard'
                ? 'This deletes EVERY transcript, course, evaluation and document Maya has - not just the scripted scenario, but anything submitted or uploaded while rehearsing too - and creates nothing in its place. Her account and profile are untouched. Use "Build baseline" or Demo documents afterwards to give her a fresh curriculum.'
                : 'Submits a real transcript for Maya from a real university\'s catalogue, picking enough courses that already have an active equivalency to a BU course to reach the target below - they apply automatically on submission. Run "Hard reset" first for a clean baseline. Afterwards, use the Demo documents page to generate matching paperwork for the same courses.'}
            </p>
            {confirm === 'baseline' && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                Target secured credits
                <input
                  type="number" min={1} max={120} value={baselineCredits}
                  onChange={(e) => setBaselineCredits(e.target.value)}
                  className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
              <Button
                variant={confirm === 'reset' || confirm === 'hard' ? 'danger' : 'primary'}
                disabled={busy}
                onClick={() => {
                  if (confirm === 'reset') reset.mutate();
                  else if (confirm === 'second') second.mutate();
                  else if (confirm === 'hard') hardReset.mutate();
                  else baseline.mutate();
                }}
              >
                {busy ? 'Working...' : confirm === 'reset' ? 'Reset' : confirm === 'second' ? 'Add student' : confirm === 'hard' ? 'Wipe everything' : 'Build baseline'}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {toast ? (
        <div role="status" className={cn('fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-sm z-50 rounded-xl px-4 py-3 text-sm shadow-lg flex items-start gap-2',
          toast.kind === 'ok' ? 'bg-green-700 text-white' : 'bg-red-700 text-white')}>
          <span className="flex-1">{toast.text}</span>
          <button aria-label="Dismiss" onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 font-medium">{children}</dd>
    </div>
  );
}
