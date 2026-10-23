import { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuthStore } from '../../store/auth';
import { authApi, pagesApi, usersApi, api } from '../../lib/api';
import { PageTransition } from '../ui/PageTransition';
import {
  GraduationCap, LayoutDashboard, FileText, BookOpen, FileEdit,
  Users, ClipboardList, Settings, ScrollText, LogOut, Upload, FileQuestion, ListChecks,
  Building2, School, Handshake, X,
} from 'lucide-react';
import type { Role, CmsPage } from '../../types';

const navItems: Record<Role, { to: string; label: string; icon: React.ReactNode }[]> = {
  student: [
    { to: '/student', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/student/upload', label: 'Upload Transcript', icon: <Upload size={18} /> },
  ],
  agency: [
    { to: '/agency', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/agency/upload', label: 'Submit Transcript', icon: <Upload size={18} /> },
  ],
  faculty: [
    { to: '/faculty', label: 'Review Queue', icon: <ClipboardList size={18} /> },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/admin/transcripts', label: 'Transcripts', icon: <FileText size={18} /> },
    { to: '/admin/courses', label: 'Course Database', icon: <BookOpen size={18} /> },
    { to: '/admin/users', label: 'Users', icon: <Users size={18} /> },
    { to: '/admin/pages', label: 'Custom Pages', icon: <FileEdit size={18} /> },
    { to: '/admin/forms', label: 'Custom Forms', icon: <ListChecks size={18} /> },
  ],
  super_admin: [
    { to: '/superadmin', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/admin/transcripts', label: 'Transcripts', icon: <FileText size={18} /> },
    { to: '/admin/courses', label: 'Course Database', icon: <BookOpen size={18} /> },
    { to: '/admin/pages', label: 'Custom Pages', icon: <FileEdit size={18} /> },
    { to: '/admin/forms', label: 'Custom Forms', icon: <ListChecks size={18} /> },
    { to: '/superadmin/users', label: 'Users', icon: <Users size={18} /> },
    { to: '/superadmin/universities', label: 'Universities', icon: <Building2 size={18} /> },
    { to: '/superadmin/institutions', label: 'Institutions', icon: <School size={18} /> },
    { to: '/superadmin/agencies', label: 'Agencies', icon: <Handshake size={18} /> },
    { to: '/superadmin/audit', label: 'Audit Log', icon: <ScrollText size={18} /> },
    { to: '/superadmin/settings', label: 'Settings', icon: <Settings size={18} /> },
  ],
};

export default function AppLayout() {
  const { user, clearAuth, updateUser } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [showProfile, setShowProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const openProfile = () => {
    setProfileForm({ firstName: user?.firstName ?? '', lastName: user?.lastName ?? '', email: user?.email ?? '' });
    setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
    setProfileError('');
    setPasswordError('');
    setPasswordSuccess(false);
    setShowProfile(true);
  };

  const profileMutation = useMutation({
    mutationFn: () => usersApi.update(user!.id, profileForm),
    onSuccess: () => {
      updateUser(profileForm);
      setProfileError('');
    },
    onError: (err: any) => setProfileError(err?.response?.data?.message || 'Could not update profile'),
  });

  const passwordMutation = useMutation({
    mutationFn: () => {
      if (passwordForm.newPassword !== passwordForm.confirm) {
        return Promise.reject(new Error('New passwords do not match'));
      }
      return api.post('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
    },
    onSuccess: () => {
      setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
      setPasswordError('');
      setPasswordSuccess(true);
    },
    onError: (err: any) =>
      setPasswordError(err?.response?.data?.message || err?.message || 'Could not change password'),
  });

  const { data: navPagesData } = useQuery({
    queryKey: ['pages', 'nav'],
    queryFn: () => pagesApi.nav(),
    staleTime: 60_000,
  });
  const navPages = (navPagesData?.data as CmsPage[]) ?? [];

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearAuth();
    navigate('/login');
  };

  const items = user ? navItems[user.role] ?? [] : [];

  return (
    <div className="flex min-h-screen bg-[#faf7f8]">
      {/* Sidebar — sticky to the viewport so the nav/footer never scroll away
          with long page content (only the nav list itself scrolls). */}
      <aside className="w-64 h-screen sticky top-0 bg-white border-r border-brand-100/60 flex flex-col shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-brand-100/60">
          <div className="w-9 h-9 rounded-xl bg-brand-800 flex items-center justify-center shrink-0">
            <GraduationCap className="text-white" size={20} />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm leading-tight">TransferHub</p>
            <p className="text-xs text-gray-500">Credit Evaluation</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {items.map(({ to, label, icon }) => (
            <NavItem key={to} to={to} label={label} icon={icon} />
          ))}

          {navPages.length > 0 && (
            <div className="pt-4 mt-2 border-t border-brand-100/60">
              <p className="px-3 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Resources
              </p>
              {navPages.map((p) => (
                <NavItem
                  key={p.slug}
                  to={`/pages/${p.slug}`}
                  label={p.navLabel || p.title}
                  icon={<FileQuestion size={18} />}
                />
              ))}
            </div>
          )}
        </nav>

        {/* User + logout */}
        <div className="border-t border-brand-100/60 px-4 py-4 shrink-0">
          <button
            onClick={openProfile}
            className="flex items-center gap-3 mb-3 w-full text-left rounded-lg px-1 -mx-1 py-1 hover:bg-brand-50 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-brand-800 text-white flex items-center justify-center text-sm font-bold shrink-0">
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
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:text-brand-800 hover:bg-brand-50 rounded-lg transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Profile panel */}
      {showProfile && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">My Profile</h2>
              <button onClick={() => setShowProfile(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {profileError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                  {profileError}
                </div>
              )}
              {[
                { name: 'firstName' as const, label: 'First Name' },
                { name: 'lastName' as const, label: 'Last Name' },
                { name: 'email' as const, label: 'Email' },
              ].map(({ name, label }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    value={profileForm[name]}
                    onChange={(e) => setProfileForm((f) => ({ ...f, [name]: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              ))}
              <button
                onClick={() => profileMutation.mutate()}
                disabled={profileMutation.isPending}
                className="w-full py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
              >
                {profileMutation.isPending ? 'Saving…' : 'Save Profile'}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-100 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Change Password</h3>
              {passwordError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs">
                  Password changed successfully.
                </div>
              )}
              {[
                { name: 'currentPassword' as const, label: 'Current Password' },
                { name: 'newPassword' as const, label: 'New Password' },
                { name: 'confirm' as const, label: 'Confirm New Password' },
              ].map(({ name, label }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type="password"
                    value={passwordForm[name]}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, [name]: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              ))}
              <button
                onClick={() => passwordMutation.mutate()}
                disabled={passwordMutation.isPending}
                className="w-full py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {passwordMutation.isPending ? 'Changing…' : 'Change Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main — fluid page transitions on route change */}
      <main className="flex-1 overflow-auto">
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </AnimatePresence>
      </main>
    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to.split('/').length <= 2}
      className="relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group"
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId="nav-active-pill"
              className="absolute inset-0 bg-brand-50 rounded-lg"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className={`relative z-10 ${isActive ? 'text-brand-800' : 'text-gray-500 group-hover:text-gray-800'}`}>
            {icon}
          </span>
          <span className={`relative z-10 ${isActive ? 'text-brand-800' : 'text-gray-600 group-hover:text-gray-900'}`}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
