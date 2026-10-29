import { Link, Outlet } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { LogoFull } from '../../components/shared/Logo';
import { Button } from '../../components/ui/Button';

/** Frame for Custom Pages viewed by anonymous visitors: same top bar as the public home page. */
export default function PublicPageShell() {
  return (
    <div className="min-h-screen bg-[#faf7f8]">
      <header className="flex items-center justify-between px-6 md:px-10 py-5 max-w-6xl mx-auto">
        <Link to="/" aria-label="TransferHub home">
          <LogoFull height={72} />
        </Link>
        <Link to="/login">
          <Button size="sm" icon={<ArrowRight size={14} />}>Log in</Button>
        </Link>
      </header>
      <main className="max-w-5xl mx-auto pb-20">
        <Outlet />
      </main>
    </div>
  );
}
