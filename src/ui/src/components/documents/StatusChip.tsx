import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, Sparkles, UploadCloud } from 'lucide-react';
import type { IntakeStatus } from '../../lib/api';
import { cn } from '../../lib/cn';

const META: Record<IntakeStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  uploaded: { label: 'Uploaded', cls: 'bg-gray-100 text-gray-700', icon: <UploadCloud size={12} /> },
  reading: { label: 'Reading…', cls: 'bg-blue-50 text-blue-700', icon: <Loader2 size={12} className="animate-spin" /> },
  read: { label: 'Read', cls: 'bg-green-50 text-green-700', icon: <Sparkles size={12} /> },
  needs_review: { label: 'Needs review', cls: 'bg-amber-100 text-amber-800', icon: <AlertTriangle size={12} /> },
  confirmed: { label: 'Confirmed', cls: 'bg-green-100 text-green-800', icon: <CheckCircle2 size={12} /> },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700', icon: <AlertTriangle size={12} /> },
  skipped: { label: 'Choose a type', cls: 'bg-slate-100 text-slate-700', icon: <CircleSlash size={12} /> },
};

export function StatusChip({ status }: { status: IntakeStatus }) {
  const m = META[status] ?? META.uploaded;
  return (
    <motion.span
      key={status}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn('relative inline-flex items-center gap-1 overflow-hidden rounded-full px-2.5 py-0.5 text-xs font-medium', m.cls)}
    >
      {status === 'reading' && (
        <motion.span
          className="absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-white/70 to-transparent"
          animate={{ left: ['-100%', '100%'] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <span className="relative flex items-center gap-1">{m.icon}{m.label}</span>
    </motion.span>
  );
}

export function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? '#2f8a4c' : value >= 0.6 ? '#d97706' : '#dc2626';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500" title={`Confidence ${pct}%`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
        <motion.span className="block h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} />
      </span>
      {pct}%
    </span>
  );
}

