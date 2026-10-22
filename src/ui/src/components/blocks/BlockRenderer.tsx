import DOMPurify from 'dompurify';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Info, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import type { Block } from '../../types';
import { Reveal } from '../ui/PageTransition';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

const noticeStyles = {
  info:    { bg: 'bg-brand-50', text: 'text-brand-800', icon: <Info size={18} /> },
  warning: { bg: 'bg-amber-50', text: 'text-amber-800', icon: <AlertTriangle size={18} /> },
  success: { bg: 'bg-green-50', text: 'text-green-800', icon: <CheckCircle2 size={18} /> },
};

function sanitize(html: string) {
  return DOMPurify.sanitize(html, { ALLOWED_ATTR: ['href', 'target', 'rel'] });
}

function isInternalHref(href: string) {
  return href.startsWith('/');
}

/** Renders one page's worth of CMS blocks, in order, each with a subtle reveal animation. */
export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  const visible = blocks.filter((b) => b.visible);

  return (
    <div className="space-y-6">
      {visible.map((block, index) => (
        <Reveal key={block.id} index={index}>
          <BlockView block={block} />
        </Reveal>
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'hero':
      return (
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
            <h1 className="text-3xl md:text-5xl font-bold text-white tracking-tight">{block.title}</h1>
            {block.subtitle && (
              <p className="mt-4 text-brand-200 text-base md:text-lg">{block.subtitle}</p>
            )}
            {block.ctaLabel && block.ctaHref && (
              <div className="mt-8">
                {isInternalHref(block.ctaHref) ? (
                  <Link to={block.ctaHref}>
                    <Button size="lg" variant="secondary" icon={<ArrowRight size={18} />}>
                      {block.ctaLabel}
                    </Button>
                  </Link>
                ) : (
                  <a href={block.ctaHref} target="_blank" rel="noopener noreferrer">
                    <Button size="lg" variant="secondary" icon={<ArrowRight size={18} />}>
                      {block.ctaLabel}
                    </Button>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      );

    case 'heading':
      return (
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{block.text}</h2>
          {block.subtitle && <p className="text-gray-500 mt-1">{block.subtitle}</p>}
        </div>
      );

    case 'richtext':
      return (
        <div
          className="prose prose-sm max-w-none text-gray-700 prose-strong:text-gray-900 prose-a:text-brand-700"
          dangerouslySetInnerHTML={{ __html: sanitize(block.html) }}
        />
      );

    case 'notice': {
      const style = noticeStyles[block.tone] ?? noticeStyles.info;
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`flex items-start gap-3 p-4 rounded-xl ${style.bg} ${style.text}`}
        >
          <span className="shrink-0 mt-0.5">{style.icon}</span>
          <p className="text-sm">{block.text}</p>
        </motion.div>
      );
    }

    case 'cards':
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {block.items
            .filter((item) => item.visible)
            .map((item, i) => (
              <Reveal key={item.id} index={i}>
                <Card className="p-5 h-full">
                  <p className="font-semibold text-gray-900 mb-1.5">{item.title}</p>
                  <p className="text-sm text-gray-600">{item.body}</p>
                </Card>
              </Reveal>
            ))}
        </div>
      );

    case 'cta':
      return (
        <Card className="p-6 flex items-center justify-between gap-4 bg-gradient-to-br from-brand-800 to-brand-900 border-none text-white">
          <p className="font-medium">{block.text}</p>
          {isInternalHref(block.buttonHref) ? (
            <Link to={block.buttonHref}>
              <Button variant="secondary" icon={<ArrowRight size={16} />}>
                {block.buttonLabel}
              </Button>
            </Link>
          ) : (
            <a href={block.buttonHref} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" icon={<ArrowRight size={16} />}>
                {block.buttonLabel}
              </Button>
            </a>
          )}
        </Card>
      );

    case 'divider':
      return <hr className="border-brand-100" />;

    case 'image':
      return (
        <figure>
          <img src={block.url} alt={block.caption ?? ''} className="rounded-xl w-full" />
          {block.caption && (
            <figcaption className="text-xs text-gray-500 mt-2 text-center">{block.caption}</figcaption>
          )}
        </figure>
      );

    default:
      return null;
  }
}
