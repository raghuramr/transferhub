import { LayoutDashboard, ClipboardList, Inbox, Gavel, ShieldQuestion } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnnouncementsBanner } from '../../components/blocks/AnnouncementsBanner';
import { DashboardView } from '../../components/dashboard/DashboardView';
import { useAuthStore } from '../../store/auth';

const ACTIONS = [
  { to: '/requests', label: 'Approval queue', hint: 'Requests waiting for your review stage', icon: Inbox },
  { to: '/faculty/queue', label: 'My evaluations', hint: 'Courses assigned to you to evaluate', icon: ClipboardList },
  { to: '/appeals', label: 'Appeals', hint: 'Students asking for a different decision', icon: Gavel },
  { to: '/faculty/verification', label: 'Course verification', hint: 'Raise a course whose details look wrong', icon: ShieldQuestion },
];

export default function FacultyDashboard() {
  const { user } = useAuthStore();
  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.firstName}</h1>
          <p className="text-gray-500">Your reviews, decisions and what is waiting on you</p>
        </div>
      </div>

      <AnnouncementsBanner />

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ACTIONS.map(({ to, label, hint, icon: Icon }) => (
          <Link key={to} to={to} className="flex items-start gap-3 rounded-xl border border-brand-100/60 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
            <span className="rounded-lg bg-brand-50 p-2 text-brand-800"><Icon size={18} /></span>
            <span>
              <span className="block font-semibold text-gray-900">{label}</span>
              <span className="block text-xs text-gray-500">{hint}</span>
            </span>
          </Link>
        ))}
      </div>

      <DashboardView />
    </div>
  );
}
