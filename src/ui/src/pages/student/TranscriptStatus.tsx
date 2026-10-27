import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requestsApi, transcriptsApi } from '../../lib/api';
import { GeneralNotes, RequestTimeline } from '../../components/workflow/RequestTimeline';
import { DocumentsPanel, NoteComposer, ReminderPanel } from '../../components/workflow/RequestPanels';
import type { RequestTimeline as TimelineData } from '../../types/workflow';
import { CheckCircle, Clock, AlertCircle, BookOpen, Sparkles, FileDown, FileCheck2 } from 'lucide-react';
import { TransferWorkflowStepper, TRANSCRIPT_STEPS } from '../../components/ui/TransferWorkflowStepper';
import { CreditHubCard, EvaluationKindBanner, FlagList } from '../../components/policy/PolicyBits';
import AppealModal from '../../components/policy/AppealModal';
import type { TranscriptCourse } from '../../types';
import ExchangePanel, { OpenRequestsBanner } from '../../components/transfers/ExchangePanel';

const APPEAL_LABEL: Record<string, string> = {
  equivalent: 'Appeal granted: BU equivalent', elective: 'Appeal granted: elective credit', no_credit: 'Appeal decided: no credit', denied: 'Appeal denied',
};
const canAppeal = (c: TranscriptCourse, kind?: string) =>
  kind !== 'preview' && !c.isOutsideUS && c.appeal?.status !== 'submitted' &&
  (['applied', 'not_eligible', 'elective_only'].includes(c.lane) || !!c.evaluation?.outcome);

function downloadDocument(id: string, fileName: string) {
  transcriptsApi.document(id).then((res) => {
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  });
}

const laneConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  applied:       { label: 'Auto-Applied',    color: 'text-green-700',  bg: 'bg-green-50',  icon: <CheckCircle size={16} /> },
  likely:        { label: 'AI Match Found',  color: 'text-blue-700',   bg: 'bg-blue-50',   icon: <Sparkles size={16} /> },
  needs_syllabus:{ label: 'Needs Syllabus',  color: 'text-amber-700',  bg: 'bg-amber-50',  icon: <AlertCircle size={16} /> },
  elective_only: { label: 'Elective Only',   color: 'text-orange-700', bg: 'bg-orange-50', icon: <BookOpen size={16} /> },
  not_eligible:  { label: 'Not Eligible',    color: 'text-red-700',    bg: 'bg-red-50',    icon: <AlertCircle size={16} /> },
  pending:       { label: 'Pending Review',  color: 'text-gray-600',   bg: 'bg-gray-50',   icon: <Clock size={16} /> },
};

export default function TranscriptStatus() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['transcript', id],
    queryFn: () => transcriptsApi.get(id!),
    refetchInterval: 30_000,
  });

  const transcript = data?.data;

  const qc = useQueryClient();
  const timelineQuery = useQuery({
    queryKey: ['request', id],
    queryFn: () => requestsApi.timeline(id!),
    refetchInterval: 30_000,
    retry: false,
  });
  const timeline = timelineQuery.data?.data;
  const setTimeline = (t: TimelineData) => qc.setQueryData(['request', id], { data: t });
  const [appealing, setAppealing] = useState<TranscriptCourse | null>(null);

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading…</div>;
  if (error || !transcript) return <div className="p-8 text-center text-red-500">Failed to load transcript.</div>;

  const total = transcript.courses?.length ?? 0;
  const applied = transcript.courses?.filter((c) => c.lane === 'applied').length ?? 0;
  const credits = transcript.courses
    ?.filter((c) => c.lane === 'applied')
    .reduce((sum, c) => sum + (c.normalisedCredits ?? c.originalCredits ?? 0), 0) ?? 0;

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {transcript.institution?.name ?? 'Transcript'}
        </h1>
        <p className="text-gray-500 mt-1">
          Submitted {new Date(transcript.receivedAt).toLocaleDateString()} ·{' '}
          <span className="capitalize font-medium">{transcript.status}</span>
        </p>
        {transcript.documentFileName && (
          <button
            onClick={() => downloadDocument(transcript.id, transcript.documentFileName!)}
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand-800 hover:text-brand-900 font-medium"
          >
            <FileDown size={15} /> {transcript.documentFileName}
          </button>
        )}
      </div>

      <EvaluationKindBanner kind={transcript.evaluationKind} expiresAt={transcript.preapprovalExpiresAt} />
      <OpenRequestsBanner transcriptId={transcript.id} />

      {/* Workflow progress: the per-university approval stages when the request has them, else the simple 3-step status */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        {timeline?.transcript.workflow ? (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">Where your request is</h2>
              {timeline.transcript.workflowStatus && timeline.transcript.workflowStatus !== 'active' && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize text-gray-700">
                  {timeline.transcript.workflowStatus === 'bypassed' ? 'approved' : timeline.transcript.workflowStatus}
                </span>
              )}
            </div>
            <RequestTimeline stages={timeline.stages} />
            <div className="mt-6"><GeneralNotes notes={timeline.generalNotes} /></div>
          </>
        ) : (
          <TransferWorkflowStepper currentStatus={transcript.status} steps={TRANSCRIPT_STEPS} />
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total courses', value: total },
          { label: 'Auto-applied', value: applied },
          { label: 'Credits earned', value: `${credits}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-sm text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <CreditHubCard credit={transcript.credit} className="mb-8" />

      {/* Courses */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Course Evaluation Status</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {transcript.courses?.map((course) => {
            const cfg = laneConfig[course.lane] ?? laneConfig.pending;
            return (
              <div key={course.id} className="px-6 py-4 flex items-start gap-4">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color} ${cfg.bg} shrink-0 mt-0.5`}>
                  {cfg.icon}
                  {cfg.label}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">
                    {course.courseCode} — {course.courseTitle}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {course.originalCredits} credits · Grade: {course.grade}
                    {course.normalisedCredits && course.normalisedCredits !== course.originalCredits && (
                      <> · Normalised to {course.normalisedCredits} BU credits</>
                    )}
                  </p>
                  {course.evaluation?.outcome && (
                    <p className="text-xs text-green-700 mt-1 font-medium">
                      BU equivalent: {course.evaluation.decidedBUCourse?.code} —{' '}
                      {course.evaluation.decidedBUCourse?.title} ({course.evaluation.awardedCredits} cr)
                    </p>
                  )}
                  <FlagList flags={course.policyFlags} compact />
                  {course.syllabus?.attached && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700" data-testid="syllabus-attached">
                      <FileCheck2 size={12} /> Syllabus attached{course.syllabus.fileName ? ` (${course.syllabus.fileName})` : course.syllabus.hasCatalogUrl ? ' (catalogue link)' : ''}
                    </p>
                  )}
                  {course.lane === 'needs_syllabus' && !course.syllabus?.attached && (
                    <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800" data-testid="why-we-ask">
                      <span className="font-semibold">Why we ask:</span> we have no existing match for this course, so a reviewer compares your syllabus (topics, outcomes, workload) with the receiving course. Add one under Documents below.
                    </p>
                  )}
                  {course.appeal && (
                    <p className="mt-1 text-xs font-medium text-indigo-700">
                      {course.appeal.status === 'submitted' ? 'Appeal under review' : APPEAL_LABEL[course.appeal.outcome ?? ''] ?? 'Appeal decided'}
                      {course.appeal.denialReason ? `: ${course.appeal.denialReason}` : ''}
                    </p>
                  )}
                  {canAppeal(course, transcript.evaluationKind) && (
                    <button type="button" onClick={() => setAppealing(course)} className="mt-1 text-xs font-medium text-brand-800 hover:underline">
                      Appeal this decision
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ExchangePanel transcriptId={transcript.id} className="mt-8" />

      {timeline && timeline.transcript.workflow && (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <NoteComposer requestId={transcript.id} timeline={timeline} onUpdated={setTimeline} />
          <ReminderPanel
            requestId={transcript.id}
            timeline={timeline}
            onSent={() => void qc.invalidateQueries({ queryKey: ['request', id] })}
          />
          <div className="lg:col-span-2">
            <DocumentsPanel
              requestId={transcript.id}
              timeline={timeline}
              courses={transcript.courses?.map((c) => ({ id: String(c.id), label: c.courseCode }))}
              onUpdated={setTimeline}
            />
          </div>
        </div>
      )}
      {appealing && (
        <AppealModal
          requestId={transcript.id}
          course={appealing}
          onClose={() => setAppealing(null)}
          onSubmitted={() => {
            setAppealing(null);
            void qc.invalidateQueries({ queryKey: ['transcript', id] });
            void qc.invalidateQueries({ queryKey: ['request', id] });
          }}
        />
      )}
    </div>
  );
}
