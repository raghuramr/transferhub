import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { transcriptsApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { MotionCard } from '../../components/ui/Card';
import { Reveal } from '../../components/ui/PageTransition';
import { TRANSCRIPT_STEPS, stepProgressLabel } from '../../components/ui/TransferWorkflowStepper';
import {
  Upload, Clock, CheckCircle, AlertCircle, ChevronRight, Users,
} from 'lucide-react';
import type { TranscriptSummary } from '../../types';

const statusColor: Record<string, string> = {
  received: 'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-700',
  complete: 'bg-green-100 text-green-700',
};

/**
 * Agency role's own dashboard — the API already scopes GET /transcripts to
 * `submittedByUserId = this agency user` for the `agency` role
 * (see transcripts.controller.ts), so this is real per-agency data, not a
 * placeholder: every transcript shown here was submitted by this agency
 * on behalf of a student.
 */
export default function AgencyDashboard() {
  const { user } = useAuthStore();
  const { data, isLoading, error } = useQuery({
    queryKey: ['transcripts', 'submitted-by-me'],
    queryFn: () => transcriptsApi.list(),
  });

  const transcripts: TranscriptSummary[] = data?.data ?? [];
  const inProgress = transcripts.filter((t) => t.status !== 'complete').length;
  const completed = transcripts.filter((t) => t.status === 'complete').length;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome, {user?.firstName}
        </h1>
        <p className="text-gray-500 mt-1">
          Submitted on behalf of students — track their transfer credit evaluations here.
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link to="/agency/upload">
          <MotionCard index={0} className="flex items-center gap-4 p-5 bg-brand-800 border-none text-white hover:bg-brand-900 h-full">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <Upload size={20} />
            </div>
            <div>
              <p className="font-semibold">Submit Transcript</p>
              <p className="text-sm text-brand-200">On behalf of a student</p>
            </div>
          </MotionCard>
        </Link>

        <MotionCard index={1} className="flex items-center gap-4 p-5">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
            <Clock className="text-amber-600" size={20} />
          </div>
          <div>
            <p className="font-semibold text-gray-900">{inProgress}</p>
            <p className="text-sm text-gray-500">In progress</p>
          </div>
        </MotionCard>

        <MotionCard index={2} className="flex items-center gap-4 p-5">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
            <CheckCircle className="text-green-600" size={20} />
          </div>
          <div>
            <p className="font-semibold text-gray-900">{completed}</p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>
        </MotionCard>
      </div>

      {/* Submissions */}
      <Reveal index={3}>
      <div className="bg-white rounded-2xl border border-brand-100/60">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users size={18} className="text-brand-800" />
          <h2 className="font-semibold text-gray-900">Student Submissions</h2>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        )}
        {error && (
          <div className="p-8 text-center text-red-500 flex items-center justify-center gap-2">
            <AlertCircle size={18} />
            Could not load submissions
          </div>
        )}
        {!isLoading && transcripts.length === 0 && (
          <div className="p-12 text-center">
            <Users className="mx-auto text-gray-300 mb-3" size={40} />
            <p className="text-gray-500 mb-4">No transcripts submitted yet.</p>
            <Link
              to="/agency/upload"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
            >
              <Upload size={16} />
              Submit your first transcript
            </Link>
          </div>
        )}

        {transcripts.map((t) => {
          const stepLabel = stepProgressLabel(t.status, TRANSCRIPT_STEPS);
          return (
            <Link
              key={t.id}
              to={`/agency/transcript/${t.id}`}
              className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 hover:bg-gray-50 transition-colors last:border-0"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <p className="font-medium text-gray-900">
                    {t.studentName ?? t.institution?.name ?? 'Unknown institution'}
                  </p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[t.status] ?? ''}`}>
                    {t.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500">
                  {t.institution?.name} · Submitted {new Date(t.receivedAt).toLocaleDateString()}
                </p>
                {stepLabel && (
                  <p className="text-xs text-brand-700 font-medium mt-1">{stepLabel}</p>
                )}
              </div>
              <ChevronRight className="text-gray-400 shrink-0" size={20} />
            </Link>
          );
        })}
      </div>
      </Reveal>
    </div>
  );
}
