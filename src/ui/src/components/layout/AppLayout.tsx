import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/auth';
import { LogoMark } from '../shared/Logo';
import { authApi, pagesApi } from '../../lib/api';
import { PageTransition } from '../ui/PageTransition';
import { Avatar } from '../shared/Avatar';
import {
  GraduationCap, LayoutDashboard, FileText, BookOpen, FileEdit,
  Users, ClipboardList, Settings, ScrollText, LogOut, Upload, FileQuestion, ListChecks,
  Building2, School, Handshake, ShieldCheck, Menu, X, UserCircle, Inbox, GitBranch, Bot, Gavel, ArrowLeftRight, ShieldQuestion, ScanLine,
} from 'lucide-react';
import type { Role, CmsPage } from '../../types';

type NavEntry = { to: string; label: string; icon: React.ReactNode; group?: string };

const navItems: Record<Role, NavEntry[]> = {
  student: [
    { to: '/student', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/student/upload', label: 'Upload Transcript', icon: <Upload size={18} /> },
    { to: '/profile', label: 'My Profile', icon: <UserCircle size={18} /> },
  ],
  agency: [
    { to: '/agency', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/agency/upload', label: 'Submit Transcript', icon: <Upload size={18} /> },
    { to: '/profile', label: 'My Profile', icon: <UserCircle size={18} /> },
  ],
  faculty: [
    { to: '/faculty', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/requests', label: 'Approval queue', icon: <Inbox size={18} /> },
    { to: '/faculty/queue', label: 'My evaluations', icon: <ClipboardList size={18} /> },
    { to: '/appeals', label: 'Appeals', icon: <Gavel size={18} /> },
    { to: '/faculty/verification', label: 'Course verification', icon: <ShieldQuestion size={18} /> },
    { to: '/profile', label: 'My Profile', icon: <UserCircle size={18} /> },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    // Operations
    { to: '/requests', label: 'Approval queue', icon: <Inbox size={18} />, group: 'Operations' },
    { to: '/appeals', label: 'Appeals', icon: <Gavel size={18} /> },
    { to: '/admin/transcripts', label: 'Transcripts', icon: <FileText size={18} /> },
    { to: '/admin/courses', label: 'Course Database', icon: <BookOpen size={18} /> },
    { to: '/admin/equivalencies', label: 'Equivalencies', icon: <ArrowLeftRight size={18} /> },
    { to: '/admin/verification', label: 'Course verification', icon: <ShieldQuestion size={18} /> },
    { to: '/admin/intake', label: 'Student intake', icon: <ScanLine size={18} /> },
    { to: '/admin/pages', label: 'Custom Pages', icon: <FileEdit size={18} /> },
    { to: '/admin/forms', label: 'Custom Forms', icon: <ListChecks size={18} /> },
    // Users
    { to: '/admin/users', label: 'Users', icon: <Users size={18} />, group: 'Users' },
    // Settings
    { to: '/admin/workflows', label: 'Workflows', icon: <GitBranch size={18} />, group: 'Settings' },
    { to: '/admin/ai-controls', label: 'AI Controls', icon: <Bot size={18} /> },
    // Account
    { to: '/profile', label: 'My Profile', icon: <UserCircle size={18} />, group: 'Account' },
  ],
  super_admin: [
    { to: '/superadmin', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    // Master Data
    { to: '/superadmin/universities', label: 'Universities', icon: <Building2 size={18} />, group: 'Master Data' },
    { to: '/superadmin/institutions', label: 'Institutions', icon: <School size={18} /> },
    { to: '/superadmin/programs', label: 'Programs', icon: <GraduationCap size={18} /> },
    { to: '/superadmin/agencies', label: 'Agencies', icon: <Handshake size={18} /> },
    // Operations
    { to: '/requests', label: 'Approval queue', icon: <Inbox size={18} />, group: 'Operations' },
    { to: '/appeals', label: 'Appeals', icon: <Gavel size={18} /> },
    { to: '/admin/transcripts', label: 'Transcripts', icon: <FileText size={18} /> },
    { to: '/admin/courses', label: 'Course Database', icon: <BookOpen size={18} /> },
    { to: '/admin/equivalencies', label: 'Equivalencies', icon: <ArrowLeftRight size={18} /> },
    { to: '/admin/verification', label: 'Course verification', icon: <ShieldQuestion size={18} /> },
    { to: '/admin/intake', label: 'Student intake', icon: <ScanLine size={18} /> },
    { to: '/admin/pages', label: 'Custom Pages', icon: <FileEdit size={18} /> },
    { to: '/admin/forms', label: 'Custom Forms', icon: <ListChecks size={18} /> },
    // Users
    { to: '/superadmin/users', label: 'Users', icon: <Users size={18} />, group: 'Users' },
    // Reports
    { to: '/superadmin/audit', label: 'Audit Log', icon: <ScrollText size={18} />, group: 'Reports' },
    // Settings
    { to: '/superadmin/settings', label: 'Settings', icon: <Settings size={18} />, group: 'Settings' },
    { to: '/superadmin/settings/roles-permissions', label: 'Roles & Permissions', icon: <ShieldCheck size={18} /> },
    { to: '/superadmin/settings/workflows', label: 'Workflows', icon: <GitBranch size={18} /> },
    { to: '/superadmin/settings/ai-controls', label: 'AI Controls', icon: <Bot size={18} /> },
    { to: '/superadmin/settings/import', label: 'Data Import', icon: <Upload size={18} /> },
  ],
};

export default function AppLayout() {
  const { user, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const renderNavItems = (entries: NavEntry[]) => {
    const rendered: React.ReactNode[] = [];
    let currentGroup: string | undefined = undefined;
    entries.forEach((item, i) => {
      if (item.group && item.group !== currentGroup) {
        currentGroup = item.group;
        rendered.push(
          <p
            key={`group-${i}`}
            className="px-3 pt-4 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider"
          >
            {item.group}
          </p>
        );
      }
      rendered.push(<NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} />);
    });
    return rendered;
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-brand-100/60">
        <LogoMark size={36} className="shrink-0" />
        <div>
          <p className="font-bold text-gray-900 text-sm leading-tight">TransferHub</p>
          <p className="text-xs text-gray-500">Credit Evaluation</p>
        </div>
        <button
          onClick={() => setMobileNavOpen(false)}
          className="ml-auto md:hidden text-gray-400 hover:text-gray-700 p-1"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {renderNavItems(items)}

        {navPages.length > 0 && (
          <div className="pt-4 mt-2 border-t border-brand-100/60">
            <p className="px-3 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
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
        <NavLink
          to="/profile"
          className="flex items-center gap-3 mb-3 w-full text-left rounded-lg px-1 -mx-1 py-1 hover:bg-brand-50 transition-colors"
        >
          <Avatar userId={user?.id} firstName={user?.firstName} lastName={user?.lastName} hasPhoto={user?.hasAvatar} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-gray-500 capitalize">
              {user?.role.replace('_', ' ')}
            </p>
          </div>
        </NavLink>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:text-brand-800 hover:bg-brand-50 rounded-lg transition-colors"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-[#faf7f8]">
      <aside className="hidden md:flex w-64 h-screen sticky top-0 bg-white border-r border-brand-100/60 flex-col shrink-0">
        {sidebarContent}
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white flex flex-col shadow-xl">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-brand-100/60 sticky top-0 z-30">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="text-gray-600 hover:text-brand-800 p-1 -ml-1"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <LogoMark size={28} className="shrink-0" />
          <p className="font-bold text-gray-900 text-sm">TransferHub</p>
        </div>

        <main className="flex-1 overflow-auto">
          <AnimatePresence mode="wait" initial={false}>
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>
        </main>
      </div>
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
