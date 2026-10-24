import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { evaluationsApi } from '../../lib/api';
import { AnnouncementsBanner } from '../../components/blocks/AnnouncementsBanner';
import { ClipboardList, ChevronRight, Sparkles, Clock } from 'lucide-react';

interface QueuedEvaluation {
  id: string;
  status: string;
  queuedAt: string;
  aiCandidatesCount?: number;
  transcriptCourse?: {
    courseCode: string;
    courseTitle: string;
    grade?: string;
    transcript?: { institution?: { name: string } };
  };
}

const statusBadge: Record<string, string> = {
  queued:      'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  decided:     'bg-green-100 text-green-700',
  posted:      'bg-purple-100 text-purple-700',
};

export default function FacultyQueue() {
  const { data, isLoading } = useQuery({
    queryKey: ['evaluations', 'mine'],
    queryFn: () => evaluationsApi.list({ assigned: 'me', status: 'queued,in_progress' }),
    refetchInterval: 60_000,
  });

  const evaluations: QueuedEvaluation[] = (data?.data as QueuedEvaluation[]) ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <ClipboardList className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Queue</h1>
          <p className="text-gray-500">Transfer credit evaluations assigned to you</p>
        </div>
      </div>

      <AnnouncementsBanner />

      {isLoading && <div className="text-center text-gray-400 py-8">Loading queue…</div>}

      {!isLoading && evaluations.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
          <p>Your queue is empty — great work!</p>
        </div>
      )}

      <div className="space-y-3">
        {evaluations.map((ev) => (
          <Link
            key={ev.id}
            to={`/faculty/evaluation/${ev.id}`}
            className="flex items-center gap-4 p-5 bg-white border border-gray-200 rounded-xl hover:border-brand-300 hover:shadow-sm transition-all"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <p className="font-semibold text-gray-900">
                  {ev.transcriptCourse?.courseCode} — {ev.transcriptCourse?.courseTitle}
                </p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[ev.status] ?? ''}`}>
                  {ev.status.replace('_', ' ')}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                From: {ev.transcriptCourse?.transcript?.institution?.name}
                {ev.transcriptCourse?.grade && ` · Grade: ${ev.transcriptCourse.grade}`}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {new Date(ev.queuedAt).toLocaleDateString()}
                </span>
                {(ev.aiCandidatesCount ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-blue-600 font-medium">
                    <Sparkles size={12} />
                    {ev.aiCandidatesCount} AI candidates
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="text-gray-400 shrink-0" size={20} />
          </Link>
        ))}
      </div>
    </div>
  );
}
