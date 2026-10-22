import type { HTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl border border-brand-100/60 shadow-sm shadow-brand-900/5',
        className,
      )}
      {...props}
    />
  );
}

/** Same as Card but animates in — use for dashboard stat tiles / list rows. */
export function MotionCard({
  className,
  index = 0,
  ...props
}: HTMLAttributes<HTMLDivElement> & { index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className={cn(
        'bg-white rounded-2xl border border-brand-100/60 shadow-sm shadow-brand-900/5',
        'transition-shadow hover:shadow-md hover:shadow-brand-900/10',
        className,
      )}
      {...(props as any)}
    />
  );
}
