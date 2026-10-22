import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { authApi } from '../../lib/api';
import {
  GraduationCap, LayoutDashboard, FileText, BookOpen,
  Users, ClipboardList, Settings, ScrollText, LogOut, Upload
} from 'lucide-react';
import type { Role } from '../../types';

const navItems: Record<Role, { to: string; label: string; icon: React.ReactNode }[]> = {
  student: [
    { to: '/student', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/student/upload', label: 'Upload Transcript', icon: <Upload size={18} /> },
  ],
  agency: [
    { to: '/student', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/student/upload', label: 'Submit Transcript', icon: <Upload size={18} /> },
  ],
  faculty: [
    { to: '/faculty', label: 'Review Queue', icon: <ClipboardList size={18} /> },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/admin/transcripts', label: 'Transcripts', icon: <FileText size={18} /> },
    { to: '/admin/courses', label: 'Course Database', icon: <BookOpen size={18} /> },
    { to: '/admin/users', label: 'Users', icon: <Users size={18} /> },
  ],
  super_admin: [
    { to: '/superadmin', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/admin/transcripts', label: 'Transcripts', icon: <FileText size={18} /> },
    { to: '/admin/courses', label: 'Course Database', icon: <BookOpen size={18} /> },
    { to: '/superadmin/users', label: 'Users', icon: <Users size={18} /> },
    { to: '/superadmin/audit', label: 'Audit Log', icon: <ScrollText size={18} /> },
    { to: '/superadmin/settings', label: 'Settings', icon: <Settings size={18} /> },
  ],
};

export default function AppLayout() {
  const { user, clearAuth } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearAuth();
    navigate('/login');
  };

  const items = user ? navItems[user.role] ?? [] : [];

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-200">
          <GraduationCap className="text-indigo-600" size={28} />
          <div>
            <p className="font-bold text-gray-900 text-sm leading-tight">BU Transfer</p>
            <p className="text-xs text-gray-500">Credit Evaluation</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {items.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to.split('/').length <= 2}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              {icon}
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User + logout */}
        <div className="border-t border-gray-200 px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">
              {user?.firstName[0]}{user?.lastName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 capitalize">
                {user?.role.replace('_', ' ')}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
