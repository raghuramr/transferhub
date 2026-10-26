import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BookOpenCheck, Clock3, Globe2, Info, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { CreditSummary, EvaluationKind, PolicyFlag } from '../../types/policy';

/** Per-course BU policy flags (pass/fail, age, cap, accreditation, international…). */
export function FlagList({ flags, compact }: { flags?: PolicyFlag[]; compact?: boolean }) {
  if (!flags?.length) return null;
  return (
    <ul className={cn('space-y-1', compact ? 'mt-1' : 'mt-2')}>
      {flags.map((f, i) => {
        const tone =
          f.code === 'international' ? 'text-sky-700' : f.severity === 'block' ? 'text-red-700' : f.severity === 'review' ? 'text-amber-700' : 'text-gray-500';
        const Icon = f.code === 'international' ? Globe2 : f.severity === 'block' ? XCircle : f.severity === 'review' ? AlertTriangle : Info;
        return (
          <li key={`${f.code}-${i}`} className={cn('flex items-start gap-1.5 text-xs', tone)}>
            <Icon size={12} className="mt-0.5 shrink-0" /> <span>{f.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** External-credit position against BU's cap, plus the Hub reminder transfer students need. */
export function CreditHubCard({ credit, className }: { credit?: CreditSummary | null; className?: string }) {
  if (!credit) return null;
  const pct = credit.cap > 0 ? Math.min(100, Math.round((credit.used / credit.cap) * 100)) : 0;
  return (
    <div className={cn('grid gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-2', className)}>
      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="font-semibold text-gray-900">Outside credit counted</span>
          <span className="text-gray-500">{credit.used} of {credit.cap}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          BU counts at most {credit.cap} credits from outside BU (transfer courses plus AP, IB and A-level{credit.examCredits ? `: ${credit.examCredits} from exams` : ''}).
          {credit.remaining === 0 && ' You have reached the limit, so further courses will not add credit.'}
        </p>
      </div>
      <div className="flex gap-3">
        <BookOpenCheck className="mt-0.5 shrink-0 text-indigo-600" size={20} />
        <div className="text-sm">
          <div className="font-semibold text-gray-900">BU Hub: {credit.hubRequirements} requirements at BU</div>
          <p className="mt-0.5 text-xs text-gray-500">
            Transfer courses never count toward the Hub, even when they earn a BU course equivalent. Most transfer students finish the Hub in 4 to 5 BU courses
            {credit.hubCocurricularAllowed ? `, and up to ${credit.hubCocurricularAllowed} can be a Hub cocurricular` : ''}.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Preview (before admission) or pre-approval banner. */
export function EvaluationKindBanner({ kind, expiresAt, action }: { kind?: EvaluationKind; expiresAt?: string | null; action?: React.ReactNode }) {
  if (!kind || kind === 'official') return null;
  if (kind === 'preview') {
    return (
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex gap-3">
          <Clock3 size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Preview, not a guarantee</p>
            <p className="mt-0.5 text-amber-800">
              BU evaluates transfer credit officially only after admission. This preview applies BU's equivalency database and published rules;
              once you are admitted it becomes an official evaluation and goes to the departments.
            </p>
          </div>
        </div>
        {action}
      </div>
    );
  }
  return (
    <div className="mb-6 flex gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
      <Info size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">Pre-approval for a course taken outside BU</p>
        <p className="mt-0.5 text-indigo-800">
          {expiresAt
            ? `Approved decisions are valid until ${new Date(expiresAt).toLocaleDateString()}. Take the course before then and send your final transcript.`
            : 'Get this approved before you enrol in the course. Once decided, approvals are valid for one year.'}
        </p>
      </div>
    </div>
  );
}

/** Search BU's catalogue (any signed-in user) and pick a course. */
export function BuCoursePicker({ value, onChange, placeholder }: {
  value: { id: number; code: string; title: string } | null;
  onChange: (c: { id: number; code: string; title: string; credits: number } | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['bu-course-search', q],
    queryFn: () => api.get<{ id: number; code: string; title: string; credits: number }[]>('/courses/bu', { params: { search: q } }),
    enabled: q.trim().length >= 2,
  });
  const results = (data?.data ?? []).slice(0, 8);
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-gray-300 px-3 py-2 text-sm">
        <span><strong>{value.code}</strong> {value.title}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-500 hover:underline">Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? 'Search BU courses by code or title…'}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onChange(c); setQ(''); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50">
                <strong>{c.code}</strong> {c.title} <span className="text-xs text-gray-400">({c.credits} cr)</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
