import { cn } from '../../lib/cn';
import { useLiveEvents } from '../../hooks/useLiveEvents';

const LABEL = { off: '', connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', polling: 'Updating every 15 s' } as const;

/** Small status pill: green pulsing dot when live, amber while reconnecting, grey when falling back to polling. */
export function LiveIndicator({ className }: { className?: string }) {
  const { status } = useLiveEvents();
  if (status === 'off') return null;
  const live = status === 'live';
  const warn = status === 'reconnecting' || status === 'connecting';
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="live-indicator"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        live && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        warn && 'border-amber-200 bg-amber-50 text-amber-700',
        status === 'polling' && 'border-gray-200 bg-gray-50 text-gray-600',
        className,
      )}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-emerald-500' : warn ? 'bg-amber-500' : 'bg-gray-400')} />
      </span>
      {LABEL[status]}
    </span>
  );
}
