import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

const variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

/**
 * Wraps a route's content with a fluid fade + slide transition.
 * Used per-page (not around <Routes>) so React Router's own element
 * swapping still works; AnimatePresence lives in App.tsx around <Outlet/>.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Scroll/mount-triggered reveal for sections within a page (21st.dev-style stagger). */
export function Reveal({
  children,
  index = 0,
  direction = 'up',
}: {
  children: ReactNode;
  index?: number;
  direction?: 'up' | 'left' | 'right';
}) {
  const offset =
    direction === 'left' ? { x: -16 } : direction === 'right' ? { x: 16 } : { y: 16 };
  return (
    <motion.div
      initial={{ opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
