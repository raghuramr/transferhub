import { Link, Outlet } from 'react-router-dom';
import { ArrowRight, Users } from 'lucide-react';
import { LogoFull } from '../../components/shared/Logo';
import { Button } from '../../components/ui/Button';

/** Link to the team / project overview page (published from _designs by scripts/copy-overview.mjs). A plain <a>: it is a static file, not an app route. */
export function TeamLink() {
  return (
    <a
      href="/clopay-codecrafters.html"
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-50"
    >
      <Users size={15} /> <span className="hidden sm:inline">Meet the team</span><span className="sm:hidden">Team</span>
    </a>
  );
}

/** Frame for Custom Pages viewed by anonymous visitors: same top bar as the public home page. */
export default function PublicPageShell() {
  return (
    <div className="min-h-screen bg-[#faf7f8]">
      <header className="flex items-center justify-between px-6 md:px-10 py-5 max-w-6xl mx-auto">
        <Link to="/" aria-label="TransferHub home">
          <LogoFull height={72} />
        </Link>
        <div className="flex items-center gap-2">
          <TeamLink />
          <Link to="/login">
            <Button size="sm" icon={<ArrowRight size={14} />}>Log in</Button>
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto pb-20">
        <Outlet />
      </main>
    </div>
  );
}
