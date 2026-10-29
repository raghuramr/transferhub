import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnnouncementsBanner } from '../../components/blocks/AnnouncementsBanner';
import { DashboardView } from '../../components/dashboard/DashboardView';
import { useAuthStore } from '../../store/auth';

const LINKS = [
  { to: '/superadmin/users', label: 'Users' },
  { to: '/superadmin/universities', label: 'Universities' },
  { to: '/superadmin/programs', label: 'Programs' },
  { to: '/admin/equivalencies', label: 'Equivalencies' },
  { to: '/admin/verification', label: 'Course verification' },
  { to: '/superadmin/audit', label: 'Audit log' },
  { to: '/superadmin/settings/import', label: 'Data import' },
  { to: '/superadmin/settings', label: 'System settings' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function SuperAdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8b8183]">{today}</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#1d1517]">
            {greeting()}{user?.firstName ? `, ${user.firstName}` : ''}
          </h1>
          <p className="text-sm text-[#5b5153]">Transfer credit across every university, at a glance.</p>
        </div>
        <nav aria-label="Quick links" className="flex max-w-full flex-wrap gap-1.5">
          {LINKS.map(({ to, label }) => (
            <Link
              key={to} to={to}
              className="group inline-flex items-center gap-1 rounded-full border border-[#ece4e6] bg-white px-2.5 py-1 text-xs text-[#5b5153] transition-colors hover:border-[#d9c9cc] hover:text-[#1d1517]"
            >
              {label}
              <ArrowUpRight size={12} className="text-[#b9afb1] transition-colors group-hover:text-[#770816]" />
            </Link>
          ))}
        </nav>
      </header>

      <AnnouncementsBanner />

      <DashboardView />
    </div>
  );
}
