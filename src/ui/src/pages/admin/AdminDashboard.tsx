import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard } from 'lucide-react';
import { transcriptsApi } from '../../lib/api';
import { AnnouncementsBanner } from '../../components/blocks/AnnouncementsBanner';
import { DashboardView } from '../../components/dashboard/DashboardView';
import { Link } from 'react-router-dom';
import type { TranscriptSummary } from '../../types';

export default function AdminDashboard() {
  const { data: transcripts } = useQuery({
    queryKey: ['transcripts', 'all'],
    queryFn: () => transcriptsApi.list(),
  });
  const recent: TranscriptSummary[] = (transcripts?.data ?? []).slice(0, 5);

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-500">Students and transfer requests for the universities you manage</p>
        </div>
      </div>

      <AnnouncementsBanner />

      <DashboardView />

      <div className="mt-8 bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Recent Transcripts</h2>
          <Link to="/admin/transcripts" className="text-sm text-brand-800 hover:underline">View all</Link>
        </div>
        <div className="divide-y divide-gray-100">
          {recent.length === 0 && <p className="px-6 py-6 text-sm text-gray-400">No transcripts yet.</p>}
          {recent.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="font-medium text-sm text-gray-900">{t.studentName}</p>
                <p className="text-xs text-gray-500">{t.institution?.name} · {t.courseCount} courses</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                t.status === 'complete' ? 'bg-green-100 text-green-700' :
                t.status === 'received' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {t.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
