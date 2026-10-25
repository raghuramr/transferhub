import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { aiControlsApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { ReadinessItem } from '../../types/workflow';

const ICON = {
  ok: <CheckCircle2 size={16} className="text-emerald-600" />,
  warn: <TriangleAlert size={16} className="text-amber-600" />,
  error: <CircleAlert size={16} className="text-red-600" />,
};

/** Setup checklist: shows what would silently stop requests from flowing (keys, migrations, approvers, stalled automation). */
export default function ReadinessCard() {
  const { data } = useQuery({ queryKey: ['readiness'], queryFn: () => aiControlsApi.readiness(), refetchInterval: 120_000, retry: false });
  const r = data?.data;
  const problems = r?.items.filter((i) => i.status !== 'ok') ?? [];
  const [open, setOpen] = useState(false);
  if (!r) return null;
  const show: ReadinessItem[] = open ? r.items : problems;

  return (
    <div className={cn('mb-6 rounded-xl border p-4', problems.length === 0 ? 'border-emerald-200 bg-emerald-50/50' : r.ready ? 'border-amber-200 bg-amber-50/50' : 'border-red-200 bg-red-50/50')}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          {problems.length === 0 ? ICON.ok : r.ready ? ICON.warn : ICON.error}
          {problems.length === 0 ? 'Everything is set up' : `${problems.length} thing${problems.length === 1 ? '' : 's'} need attention`}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">{open ? 'Hide all checks' : 'Show all checks'}{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {show.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {show.map((i) => (
            <li key={i.key} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 shrink-0">{ICON[i.status]}</span>
              <span>
                <span className="font-medium text-gray-800">{i.label}.</span> <span className="text-gray-600">{i.detail}</span>
                {i.hint && <span className="mt-0.5 block text-xs text-gray-500">{i.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
