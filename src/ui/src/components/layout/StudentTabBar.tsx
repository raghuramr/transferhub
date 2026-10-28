import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass, LayoutDashboard, ListChecks, ScanText, UserCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

interface Tab {
  to: string;
  label: string;
  icon: React.ReactNode;
  active: (path: string, hash: string) => boolean;
}

const TABS: Tab[] = [
  { to: '/student', label: 'Home', icon: <LayoutDashboard size={22} />, active: (p, h) => p === '/student' && h !== '#requests' },
  { to: '/student/documents', label: 'Scan', icon: <ScanText size={22} />, active: (p) => p.startsWith('/student/documents') || p.startsWith('/student/upload') },
  { to: '/student#requests', label: 'Requests', icon: <ListChecks size={22} />, active: (p, h) => p.startsWith('/student/transcript') || (p === '/student' && h === '#requests') },
  { to: '/student/explore', label: 'Explore', icon: <Compass size={22} />, active: (p) => p.startsWith('/student/explore') },
  { to: '/profile', label: 'Profile', icon: <UserCircle size={22} />, active: (p) => p.startsWith('/profile') },
];

/** Thumb-reach navigation for the student role on phones (<md). The drawer menu stays available from the top bar. */
export function StudentTabBar() {
  const { pathname, hash } = useLocation();

  // "Requests" jumps to the transcript list on the dashboard once it has rendered (it loads asynchronously).
  useEffect(() => {
    if (pathname !== '/student' || hash !== '#requests') return;
    const timers = [60, 350, 900, 1800].map((ms) => window.setTimeout(() => document.getElementById('requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), ms));
    return () => timers.forEach(window.clearTimeout);
  }, [pathname, hash]);

  return (
    <nav
      aria-label="Student navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-xl items-stretch">
        {TABS.map((t) => {
          const on = t.active(pathname, hash);
          return (
            <li key={t.label} className="flex-1">
              <Link
                to={t.to}
                aria-current={on ? 'page' : undefined}
                className={cn('flex h-14 min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium', on ? 'text-brand-800' : 'text-gray-500')}
              >
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', on && 'bg-brand-50')}>{t.icon}</span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
