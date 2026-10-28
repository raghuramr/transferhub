import { useEffect, useState } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/auth';
import { LogoFull, LogoMark } from '../shared/Logo';
import { authApi, pagesApi } from '../../lib/api';
import { PageTransition } from '../ui/PageTransition';
import { Avatar } from '../shared/Avatar';
import { UniversityHeader } from './UniversityHeader';
import { LiveEventsProvider } from '../live/LiveEventsProvider';
import { StudentTabBar } from './StudentTabBar';
import {
  GraduationCap, LayoutDashboard, FileText, BookOpen, FileEdit,
  Users, ClipboardList, Settings, ScrollText, LogOut, Upload, FileQuestion, ListChecks,
  Building2, School, Handshake, ShieldCheck, Menu, X, UserCircle, Inbox, GitBranch, Bot, Gavel, ArrowLeftRight, ScanText, ShieldQuestion, ScanLine, ArrowRightLeft,
  Presentation, Compass, PanelLeftClose, PanelLeftOpen, ChevronDown,
} from 'lucide-react';
import type { Role, CmsPage } from '../../types';

type NavEntry = { to: string; label: string; icon: React.ReactNode; group?: string };

const navItems: Record<Role, NavEntry[]> = {
  student: [
    { to: '/student', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { to: '/student/documents', label: 'Smart upload', icon: <ScanText size={18} /> },
    { to: '/student/upload', label: 'Upload Transcript', icon: <Upload size={18} /> },
    { to: '/student/explore', label: 'Explore universities', icon: <Compass size={18} /> },
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
    { to: '/transfers', label: 'Transfers', icon: <ArrowRightLeft size={18} /> },
    { to: '/faculty/queue', label: 'My evaluations', icon: <ClipboardList size={18} /> },
    { to: '/appeals', label: 'Appeals', icon: <Gavel size={18} /> },
    { to: '/faculty/verification', label: 'Course verification', icon: <ShieldQuestion size={18} /> },
    { to: '/profile', label: 'My Profile', icon: <UserCircle size={18} /> },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    // Operations
    { to: '/requests', label: 'Approval queue', icon: <Inbox size={18} />, group: 'Operations' },
    { to: '/transfers', label: 'Transfers', icon: <ArrowRightLeft size={18} /> },
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
    // Operations
    { to: '/requests', label: 'Approval queue', icon: <Inbox size={18} />, group: 'Operations' },
    { to: '/transfers', label: 'Transfers', icon: <ArrowRightLeft size={18} /> },
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
    // Master Data (sits just before Settings)
    { to: '/superadmin/universities', label: 'Universities', icon: <Building2 size={18} />, group: 'Master Data' },
    { to: '/superadmin/institutions', label: 'Institutions', icon: <School size={18} /> },
    { to: '/superadmin/programs', label: 'Programs', icon: <GraduationCap size={18} /> },
    { to: '/superadmin/agencies', label: 'Agencies', icon: <Handshake size={18} /> },
    // Settings
    { to: '/superadmin/settings', label: 'Settings', icon: <Settings size={18} />, group: 'Settings' },
    { to: '/superadmin/settings/roles-permissions', label: 'Roles & Permissions', icon: <ShieldCheck size={18} /> },
    { to: '/superadmin/settings/workflows', label: 'Workflows', icon: <GitBranch size={18} /> },
    { to: '/superadmin/settings/ai-controls', label: 'AI Controls', icon: <Bot size={18} /> },
    { to: '/superadmin/settings/import', label: 'Data Import', icon: <Upload size={18} /> },
    // Demo (presenter tools, kept apart from real settings)
    { to: '/superadmin/settings/demo-scenario', label: 'Demo scenario', icon: <Presentation size={18} />, group: 'Demo' },
    { to: '/superadmin/settings/demo-documents', label: 'Demo documents', icon: <ScanText size={18} /> },
  ],
};

export default function AppLayout() {
  const { user, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Desktop sidebar can shrink to an icon rail; the choice is remembered per browser.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('th.sidebar.collapsed') === '1'; } catch { return false; }
  });
  // Menu sections (Operations, Users, ...) fold up to their heading; the choice is remembered per browser.
  const [foldedGroups, setFoldedGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('th.nav.folded') || '[]') as string[]; } catch { return []; }
  });
  const toggleGroup = (g: string) => setFoldedGroups((cur) => {
    const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
    try { localStorage.setItem('th.nav.folded', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const toggleCollapsed = () => setCollapsed((c) => {
    try { localStorage.setItem('th.sidebar.collapsed', c ? '0' : '1'); } catch { /* ignore */ }
    return !c;
  });
  useEffect(() => {
    // Fixed bars that sit beside the sidebar (e.g. the submit-transcript action bar) read this.
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '4rem' : '16rem');
  }, [collapsed]);

  const { data: navPagesData } = useQuery({
    queryKey: ['pages', 'nav'],
    queryFn: () => pagesApi.nav(),
    staleTime: 60_000,
  });
  const navPages = (navPagesData?.data as CmsPage[]) ?? [];

  // Sign out immediately; revoking the refresh token on the server happens in the background.
  const handleLogout = () => {
    const refreshToken = localStorage.getItem('refreshToken') ?? undefined;
    const accessToken = localStorage.getItem('accessToken') ?? undefined;
    clearAuth();
    navigate('/login');
    void authApi.logout(refreshToken, accessToken).catch(() => undefined);
  };

  const items = user ? navItems[user.role] ?? [] : [];

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Navigating into a folded section (e.g. from a link on a page) opens it.
  useEffect(() => {
    let group: string | undefined;
    let best = -1;
    for (const it of items) {
      if (it.group) group = it.group;
      const on = location.pathname === it.to || location.pathname.startsWith(it.to + '/');
      if (on && it.to.length > best && group) { best = it.to.length; setFoldedGroups((cur) => (cur.includes(group!) ? cur.filter((x) => x !== group) : cur)); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const dashboardPath = items[0]?.to ?? '/';

  const renderNavItems = (entries: NavEntry[], compact: boolean) => {
    // Split into the ungrouped lead items and one section per group.
    const lead: NavEntry[] = [];
    const sections: { group: string; items: NavEntry[] }[] = [];
    for (const item of entries) {
      if (item.group) sections.push({ group: item.group, items: [item] });
      else if (sections.length) sections[sections.length - 1].items.push(item);
      else lead.push(item);
    }
    const row = (item: NavEntry) => <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} compact={compact} />;
    return (
      <>
        {lead.map(row)}
        {sections.map((sec) => {
          const open = compact || !foldedGroups.includes(sec.group);
          return (
            <div key={sec.group}>
              {compact ? (
                <div className="mx-3 mt-3 mb-1 border-t border-brand-100/60" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(sec.group)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between px-3 pt-4 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hover:text-brand-800"
                >
                  <span>{sec.group}</span>
                  <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
                </button>
              )}
              {open && sec.items.map(row)}
            </div>
          );
        })}
      </>
    );
  };

  const renderSidebar = (compact: boolean) => (
    <>
      {/* Logo */}
      <div className={`flex items-center border-b border-brand-100/60 ${compact ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'}`}>
        <Link to={dashboardPath} aria-label="TransferHub dashboard" title="Go to dashboard" className="shrink-0">
          {compact ? <LogoMark size={36} className="shrink-0" /> : <LogoFull height={88} className="shrink-0" />}
        </Link>
        <button
          onClick={() => setMobileNavOpen(false)}
          className="ml-auto md:hidden text-gray-400 hover:text-gray-700 p-1"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>
      <div className={`hidden md:flex ${compact ? 'justify-center' : 'justify-end pr-3'} pt-2`}>
        <button
          onClick={toggleCollapsed}
          className="text-gray-400 hover:text-brand-800 hover:bg-brand-50 rounded-lg p-1.5"
          aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
          title={compact ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {compact ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Nav */}
      <nav className={`flex-1 py-2 overflow-y-auto overflow-x-hidden ${compact ? 'px-2' : 'px-3'}`}>
        {renderNavItems(items, compact)}

        {navPages.length > 0 && (
          <div className="pt-4 mt-2 border-t border-brand-100/60">
            {!compact && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Resources
              </p>
            )}
            {navPages.map((p) => (
              <NavItem
                key={p.slug}
                to={`/pages/${p.slug}`}
                label={p.navLabel || p.title}
                icon={<FileQuestion size={18} />}
                compact={compact}
              />
            ))}
          </div>
        )}
      </nav>

      {/* User + logout */}
      <div className={`border-t border-brand-100/60 py-4 shrink-0 ${compact ? 'px-2' : 'px-4'}`}>
        <NavLink
          to="/profile"
          className={`flex items-center mb-3 w-full text-left rounded-lg py-1 hover:bg-brand-50 transition-colors ${compact ? 'justify-center' : 'gap-3 px-1 -mx-1'}`}
          title={compact ? `${user?.firstName} ${user?.lastName}` : undefined}
        >
          <Avatar userId={user?.id} firstName={user?.firstName} lastName={user?.lastName} hasPhoto={user?.hasAvatar} size="sm" />
          <div className={`flex-1 min-w-0 ${compact ? 'hidden' : ''}`}>
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
          className={`flex items-center w-full py-2 text-sm text-gray-600 hover:text-brand-800 hover:bg-brand-50 rounded-lg transition-colors ${compact ? 'justify-center' : 'gap-2 px-3'}`}
          title={compact ? 'Sign out' : undefined}
          aria-label="Sign out"
        >
          <LogOut size={16} />
          {!compact && 'Sign out'}
        </button>
      </div>
    </>
  );

  return (
    <LiveEventsProvider>
    <div className="flex min-h-screen bg-[#faf7f8]">
      <aside className={`hidden md:flex h-screen sticky top-0 bg-white border-r border-brand-100/60 flex-col shrink-0 transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-64'}`}>
        {renderSidebar(collapsed)}
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white flex flex-col shadow-xl">
            {renderSidebar(false)}
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
          <Link to={dashboardPath} aria-label="TransferHub dashboard" className="shrink-0"><LogoFull height={44} className="shrink-0" /></Link>
        </div>

        <UniversityHeader />

        <main className={`flex-1 overflow-auto${user?.role === 'student' ? ' student-app' : ''}`}>
          <AnimatePresence mode="wait" initial={false}>
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>
        </main>
      </div>
      {user?.role === 'student' && <StudentTabBar />}
    </div>
    </LiveEventsProvider>
  );
}

function NavItem({ to, label, icon, compact = false }: { to: string; label: string; icon: React.ReactNode; compact?: boolean }) {
  return (
    <NavLink
      to={to}
      end={to.split('/').length <= 2}
      title={compact ? label : undefined}
      aria-label={label}
      className={`relative flex items-center rounded-lg text-sm font-medium transition-colors group ${compact ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'}`}
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
          {!compact && (
            <span className={`relative z-10 ${isActive ? 'text-brand-800' : 'text-gray-600 group-hover:text-gray-900'}`}>
              {label}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
