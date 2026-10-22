import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, FileText, Users, BookOpen, Clock, CheckCircle } from 'lucide-react';
import { transcriptsApi, usersApi } from '../../lib/api';
import { AnnouncementsBanner } from '../../components/blocks/AnnouncementsBanner';
import { Link } from 'react-router-dom';

function StatCard({ label, value, icon, to }: { label: string; value: string | number; icon: React.ReactNode; to: string }) {
  return (
    <Link to={to} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <span className="text-brand-500">{icon}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
    </Link>
  );
}

export default function AdminDashboard() {
  const { data: transcripts } = useQuery({
    queryKey: ['transcripts', 'all'],
    queryFn: () => transcriptsApi.list(),
  });
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  });

  const allTranscripts: any[] = (transcripts?.data as any) ?? [];
  const allUsers: any[] = (users?.data as any) ?? [];

  const pending = allTranscripts.filter((t) => t.Status === 'pending').length;
  const complete = allTranscripts.filter((t) => t.Status === 'complete').length;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <LayoutDashboard className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-500">System overview</p>
        </div>
      </div>

      <AnnouncementsBanner />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Transcripts" value={allTranscripts.length} icon={<FileText size={20} />} to="/admin/transcripts" />
        <StatCard label="Pending Review" value={pending} icon={<Clock size={20} />} to="/admin/transcripts?status=pending" />
        <StatCard label="Completed" value={complete} icon={<CheckCircle size={20} />} to="/admin/transcripts?status=complete" />
        <StatCard label="Total Users" value={allUsers.length} icon={<Users size={20} />} to="/admin/users" />
      </div>

      {/* Recent transcripts */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Recent Transcripts</h2>
          <Link to="/admin/transcripts" className="text-sm text-brand-800 hover:underline">View all</Link>
        </div>
        <div className="divide-y divide-gray-100">
          {allTranscripts.slice(0, 5).map((t: any) => (
            <div key={t.Id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="font-medium text-sm text-gray-900">{t.StudentName}</p>
                <p className="text-xs text-gray-500">{t.InstitutionName} · {t.CourseCount} courses</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                t.Status === 'complete' ? 'bg-green-100 text-green-700' :
                t.Status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {t.Status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
