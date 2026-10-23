import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Users, ScrollText, Activity } from 'lucide-react';
import { usersApi, transcriptsApi } from '../../lib/api';
import { AnnouncementsBanner } from '../../components/blocks/AnnouncementsBanner';
import { Link } from 'react-router-dom';

export default function SuperAdminDashboard() {
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() });
  const { data: transcripts } = useQuery({ queryKey: ['transcripts'], queryFn: () => transcriptsApi.list() });

  const allUsers: any[] = (users?.data as any) ?? [];
  const allTranscripts: any[] = (transcripts?.data as any) ?? [];

  const byRole = allUsers.reduce((acc: any, u: any) => {
    const role = u.role || 'unknown';
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <LayoutDashboard className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Super Admin Dashboard</h1>
          <p className="text-gray-500">Full system overview and controls</p>
        </div>
      </div>

      <AnnouncementsBanner />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">Total Users</p>
            <Users className="text-brand-700" size={20} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{allUsers.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">Transcripts</p>
            <ScrollText className="text-blue-500" size={20} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{allTranscripts.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">Locked Accounts</p>
            <Activity className="text-red-500" size={20} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{allUsers.filter((u: any) => u.isLocked).length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">Agencies</p>
            <Users className="text-green-500" size={20} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{byRole.agency || 0}</p>
        </div>
      </div>

      {/* User breakdown */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Users by Role</h2>
          <div className="space-y-2">
            {Object.entries(byRole).map(([role, count]) => (
              <div key={role} className="flex items-center justify-between">
                <span className="text-sm text-gray-600 capitalize">{role.replace('_', ' ')}</span>
                <span className="text-sm font-semibold text-gray-900">{count as number}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Quick Links</h2>
          <div className="space-y-2">
            {[
              { to: '/superadmin/users', label: 'User Management' },
              { to: '/superadmin/audit', label: 'Audit Log' },
              { to: '/admin/transcripts', label: 'All Transcripts' },
              { to: '/admin/courses', label: 'Course Database' },
              { to: '/superadmin/settings', label: 'System Settings' },
            ].map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-brand-50 hover:text-brand-900 transition-colors text-sm"
              >
                {label}
                <span>→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
