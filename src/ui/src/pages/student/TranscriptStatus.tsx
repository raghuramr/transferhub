import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { transcriptsApi } from '../../lib/api';
import { CheckCircle, Clock, AlertCircle, BookOpen, Sparkles, FileDown } from 'lucide-react';
import { TransferWorkflowStepper, TRANSCRIPT_STEPS } from '../../components/ui/TransferWorkflowStepper';

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

      {/* Workflow progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <TransferWorkflowStepper currentStatus={transcript.status} steps={TRANSCRIPT_STEPS} />
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
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
