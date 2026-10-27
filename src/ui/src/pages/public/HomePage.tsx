import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { LogoFull } from '../../components/shared/Logo';
import { pagesApi } from '../../lib/api';
import { BlockRenderer } from '../../components/blocks/BlockRenderer';
import { Button } from '../../components/ui/Button';
import { Reveal } from '../../components/ui/PageTransition';
import type { CmsPage } from '../../types';

/**
 * Public landing page shown to anonymous visitors at "/". Its body is a
 * normal Custom Page (slug "home") editable from Admin -> Custom Pages —
 * the same blocks-as-JSON system used for the dashboard announcements
 * banner and the FAQ page. If no "home" page has been published yet, a
 * sensible default hero is shown instead so the site is never blank.
 */
export default function HomePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['pages', 'home'],
    queryFn: () => pagesApi.bySlug('home'),
    retry: false,
  });

  const page = data?.data as CmsPage | undefined;
  const hasCustomContent = !isLoading && page && page.blocks.some((b) => b.visible);

  return (
    <div className="min-h-screen bg-[#faf7f8]">
      {/* Top bar — always present regardless of CMS content, so there is
          always an obvious way to sign in. */}
      <header className="flex items-center justify-between px-6 md:px-10 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <LogoFull height={72} />
        </div>
        <Link to="/login">
          <Button size="sm" icon={<ArrowRight size={14} />}>Log in</Button>
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-6 md:px-10 pb-20">
        {isLoading && <div className="text-center text-gray-400 py-20">Loading…</div>}

        {hasCustomContent && page ? (
          <BlockRenderer blocks={page.blocks} />
        ) : (
          !isLoading && <DefaultHero />
        )}
      </main>
    </div>
  );
}

function DefaultHero() {
  return (
    <div className="space-y-10">
      <div className="relative overflow-hidden rounded-3xl bg-brand-950 px-8 py-16 md:py-24 text-center">
        <motion.div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-brand-700/40 blur-3xl"
          animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-24 -right-16 w-[28rem] h-[28rem] rounded-full bg-brand-500/30 blur-3xl"
          animate={{ x: [0, -24, 0], y: [0, -24, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="relative max-w-2xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-3xl md:text-5xl font-bold text-white tracking-tight"
          >
            Smarter Transfer Credit Evaluation
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-4 text-brand-200 text-base md:text-lg"
          >
            TransferHub's AI-assisted platform for evaluating transfer credit across universities — for students,
            faculty, agencies, and administrators.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-8"
          >
            <Link to="/login">
              <Button size="lg" variant="secondary" icon={<ArrowRight size={18} />}>
                Get started
              </Button>
            </Link>
          </motion.div>
        </div>
      </div>

      <Reveal>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: 'For Students & Agencies', body: 'Submit transcripts and track evaluation status in real time.' },
            { title: 'For Faculty', body: 'Review AI-ranked course matches and record transfer decisions quickly.' },
            { title: 'For Administrators', body: 'Manage the course catalog, users, and system-wide content from one place.' },
          ].map((c) => (
            <div key={c.title} className="bg-white rounded-2xl border border-brand-100/60 p-5">
              <p className="font-semibold text-gray-900 mb-1.5">{c.title}</p>
              <p className="text-sm text-gray-600">{c.body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
