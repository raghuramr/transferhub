import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'brand' | 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'purple';

const toneClasses: Record<Tone, string> = {
  brand:  'bg-brand-50 text-brand-800',
  green:  'bg-green-100 text-green-700',
  amber:  'bg-amber-100 text-amber-700',
  red:    'bg-red-100 text-red-700',
  blue:   'bg-blue-100 text-blue-700',
  gray:   'bg-gray-100 text-gray-700',
  purple: 'bg-purple-100 text-purple-700',
};

export function Badge({
  tone = 'gray',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
