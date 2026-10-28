import { cn } from '../../lib/cn';
import type { AgreementLevel } from '../../lib/api-network';

const STYLE: Record<AgreementLevel, string> = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-gray-100 text-gray-600',
  none: 'bg-gray-100 text-gray-500',
};
const LABEL: Record<AgreementLevel, string> = {
  high: 'Strong agreement', medium: 'Some agreement', low: 'Weak agreement', none: 'No data yet',
};

/** Green / amber / grey chip for how concentrated the other universities' decisions are. */
export function AgreementChip({ level, agreement }: { level: AgreementLevel; agreement: number }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', STYLE[level])} data-testid="agreement-chip"
      title="Share of the universities that accepted this course as equivalent which picked the same receiving course">
      {LABEL[level]}{level !== 'none' && <> · {Math.round(agreement * 100)}%</>}
    </span>
  );
}
