import { LayoutDashboard } from 'lucide-react';
import { AnnouncementsBanner } from '../../components/blocks/AnnouncementsBanner';
import { DashboardView } from '../../components/dashboard/DashboardView';
import { Link } from 'react-router-dom';

const LINKS = [
  { to: '/superadmin/users', label: 'User Management' },
  { to: '/superadmin/universities', label: 'Universities' },
  { to: '/superadmin/programs', label: 'Programs' },
  { to: '/admin/equivalencies', label: 'Equivalencies' },
  { to: '/admin/verification', label: 'Course verification' },
  { to: '/superadmin/audit', label: 'Audit Log' },
  { to: '/superadmin/settings/import', label: 'Data Import' },
  { to: '/superadmin/settings', label: 'System Settings' },
];

export default function SuperAdminDashboard() {
  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Super Admin Dashboard</h1>
          <p className="text-gray-500">Everything across every university</p>
        </div>
      </div>

      <AnnouncementsBanner />

      <DashboardView />

      <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Quick Links</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {LINKS.map(({ to, label }) => (
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
  );
}
