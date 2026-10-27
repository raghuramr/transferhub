import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, GraduationCap, Info, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type Bucket = 'secure' | 'likely' | 'pending' | 'not_counted';

interface Totals { secure: number; likelyLow: number; likelyHigh: number; pending: number; notCounted: number }
interface CourseProgress {
  id: string; courseCode: string; courseTitle: string; lane: string; bucket: Bucket; grade: string | null;
  originalCredits: number; convertedCredits: number; awardedCredits: number | null; low: number; high: number;
  buCourse: string | null; nextStep: string;
}
interface RequestProgress {
  id: string; institutionName: string; kind: string; status: string; receivedAt: string | null; totals: Totals; courses: CourseProgress[];
}
export interface ProgressResult {
  totals: Totals;
  cap: { limit: number; examCredits: number; used: number; projectedMax: number; remaining: number; applicantType: string | null };
  hub: { requirements: number; cocurricularAllowed: number; note: string };
  requests: RequestProgress[];
  isProvisional: boolean;
}

const BUCKETS: Record<Bucket, { label: string; bar: string; dot: string; pill: string }> = {
  secure: { label: 'Secured', bar: 'bg-emerald-600', dot: 'bg-emerald-600', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  likely: { label: 'Likely', bar: 'bg-brand-600', dot: 'bg-brand-600', pill: 'bg-brand-50 text-brand-700 ring-brand-200' },
  pending: { label: 'Pending', bar: 'bg-amber-400', dot: 'bg-amber-400', pill: 'bg-amber-50 text-amber-700 ring-amber-200' },
  not_counted: { label: 'Not counted', bar: 'bg-gray-300', dot: 'bg-gray-300', pill: 'bg-gray-100 text-gray-600 ring-gray-200' },
};

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const range = (lo: number, hi: number) => (lo === hi ? fmt(lo) : `${fmt(lo)}-${fmt(hi)}`);

interface Props {
  /** Staff view of another student; omit for the signed-in student's own progress. */
  studentUserId?: string;
  className?: string;
}

export function DegreeProgressCard({ studentUserId, className }: Props) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['progress', studentUserId ?? 'me'],
    queryFn: async () => (await api.get<ProgressResult>(studentUserId ? `/progress/student/${studentUserId}` : '/progress/me')).data,
  });

  const shell = cn('bg-white rounded-2xl border border-brand-100/60 shadow-sm shadow-brand-900/5 overflow-hidden', className);

  if (isLoading) {
    return (
      <div className={cn(shell, 'p-6')} aria-busy="true">
        <div className="h-4 w-40 rounded bg-gray-100 animate-pulse mb-4" />
        <div className="h-10 w-24 rounded bg-gray-100 animate-pulse mb-4" />
        <div className="h-4 w-full rounded-full bg-gray-100 animate-pulse" />
      </div>
    );
  }
  if (isError || !data) {
    return <div className={cn(shell, 'p-6 text-sm text-gray-500')}>Your credit progress could not be loaded right now.</div>;
  }

  const hasCourses = data.requests.some((r) => r.courses.length > 0);
  if (!hasCourses) {
    return (
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className={cn(shell, 'p-8 text-center')}>
        <GraduationCap className="mx-auto text-brand-300 mb-3" size={36} />
        <h2 className="font-semibold text-gray-900">Your credit progress</h2>
        <p className="text-sm text-gray-500 mt-1 mb-4 max-w-md mx-auto">
          Once you submit a transcript you will see how many credits are secured, likely and still pending, measured against the {data.cap.limit}-credit transfer limit.
        </p>
        <Link to="/student/upload" className="inline-flex items-center gap-2 px-4 py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900">
          <Upload size={16} /> Submit a transcript
        </Link>
      </motion.div>
    );
  }

  const t = data.totals;
  const cap = data.cap;
  const exam = cap.examCredits;
  const scale = Math.max(cap.limit, exam + t.secure + t.likelyHigh + t.pending + t.notCounted, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const hasRange = t.likelyHigh > 0;
  const low = t.secure + t.likelyLow;
  const high = t.secure + t.likelyHigh;

  const segments: { key: string; value: number; cls: string; label: string }[] = [
    ...(exam > 0 ? [{ key: 'exam', value: exam, cls: 'bg-emerald-900/70', label: 'AP / IB / A-level' }] : []),
    { key: 'secure', value: t.secure, cls: BUCKETS.secure.bar, label: 'Secured' },
    { key: 'likelyLow', value: t.likelyLow, cls: BUCKETS.likely.bar, label: 'Likely' },
    { key: 'likelyRange', value: t.likelyHigh - t.likelyLow, cls: 'bg-brand-300', label: 'Likely, upper end' },
    { key: 'pending', value: t.pending, cls: BUCKETS.pending.bar, label: 'Pending' },
    { key: 'notCounted', value: t.notCounted, cls: BUCKETS.not_counted.bar, label: 'Not counted' },
  ];

  const legend: { b: Bucket; value: string; hint: string }[] = [
    { b: 'secure', value: fmt(t.secure), hint: 'decided or auto-applied' },
    { b: 'likely', value: range(t.likelyLow, t.likelyHigh), hint: 'waiting for confirmation' },
    { b: 'pending', value: fmt(t.pending), hint: 'in review or needs a syllabus' },
    { b: 'not_counted', value: fmt(t.notCounted), hint: 'not eligible, over cap or no credit' },
  ];

  const overCap = cap.projectedMax > cap.limit;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={shell}
      aria-label="Degree progress"
    >
      <div className="bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 text-white px-5 sm:px-6 pt-5 pb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">Transfer credit progress</p>
          {data.isProvisional && (
            <span className="text-[11px] font-medium bg-white/15 rounded-full px-2.5 py-0.5">Provisional</span>
          )}
        </div>
        <div className="mt-3 flex items-end gap-3 flex-wrap">
          <motion.span
            key={t.secure}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="text-5xl sm:text-6xl font-bold leading-none tabular-nums"
          >
            {fmt(t.secure)}
          </motion.span>
          <span className="pb-1 text-brand-100 text-sm sm:text-base">credits secured</span>
        </div>
        <p className="mt-2 text-sm sm:text-base text-brand-50">
          {hasRange
            ? <>Between <strong className="font-semibold">{fmt(low)}</strong> and <strong className="font-semibold">{fmt(high)}</strong> credits likely in total once pending decisions are confirmed.</>
            : t.pending > 0
              ? <>{fmt(t.pending)} more credits are still being reviewed.</>
              : <>No further credits are waiting on a decision.</>}
        </p>
      </div>

      <div className="px-5 sm:px-6 py-5">
        <div className="flex items-baseline justify-between gap-2 text-xs text-gray-500 mb-2">
          <span>Against the {cap.limit}-credit limit on external credit</span>
          <span className="tabular-nums">{fmt(cap.used)} used{cap.remaining > 0 ? `, ${fmt(cap.remaining)} left` : ''}</span>
        </div>
        <div className="relative">
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-100" role="img"
            aria-label={`Secured ${fmt(t.secure)}, likely ${range(t.likelyLow, t.likelyHigh)}, pending ${fmt(t.pending)}, not counted ${fmt(t.notCounted)} of ${cap.limit} credits`}>
            {segments.filter((s) => s.value > 0).map((s, i) => (
              <motion.div
                key={s.key}
                title={`${s.label}: ${fmt(s.value)}`}
                className={cn('h-full border-r border-white/70 last:border-r-0', s.cls)}
                initial={{ width: 0 }}
                animate={{ width: pct(s.value) }}
                transition={{ duration: 0.7, delay: 0.2 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              />
            ))}
          </div>
          {scale > cap.limit && (
            <div className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-brand-900" style={{ left: pct(cap.limit) }} title={`${cap.limit}-credit limit`} />
          )}
        </div>
        {overCap && <p className="mt-2 text-xs text-amber-700">If every likely course is confirmed you would reach the {cap.limit}-credit limit; any credit above it is not counted.</p>}

        <dl className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {legend.map((l) => (
            <div key={l.b} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 min-w-0">
              <dt className="flex items-center gap-2 text-xs font-medium text-gray-600">
                <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', BUCKETS[l.b].dot)} />
                {BUCKETS[l.b].label}
              </dt>
              <dd className="mt-1 text-xl font-semibold text-gray-900 tabular-nums">{l.value}</dd>
              <p className="text-[11px] text-gray-400 leading-snug">{l.hint}</p>
            </div>
          ))}
        </dl>

        {exam > 0 && <p className="mt-3 text-xs text-gray-500">Includes {fmt(exam)} AP / IB / A-level credits counted toward the same limit.</p>}

        <div className="mt-4 flex gap-2 rounded-xl bg-brand-50/70 border border-brand-100 px-3 py-2.5 text-xs text-brand-900">
          <Info size={14} className="mt-0.5 shrink-0 text-brand-700" />
          <p>{data.hub.note}</p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-5 w-full flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <span>{open ? 'Hide' : 'Show'} course-by-course detail</span>
          <ChevronDown size={18} className={cn('transition-transform text-gray-500', open && 'rotate-180')} />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="pt-4 space-y-5">
                {data.requests.filter((r) => r.courses.length).map((r) => (
                  <div key={r.id}>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <Link to={`/student/transcript/${r.id}`} className="text-sm font-semibold text-gray-900 hover:text-brand-700">{r.institutionName}</Link>
                      {r.kind === 'preview' && <span className="text-[11px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">Preview</span>}
                      {r.kind === 'preapproval' && <span className="text-[11px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">Pre-approval</span>}
                    </div>
                    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                      {r.courses.map((c) => (
                        <li key={c.id} className="px-3 sm:px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 break-words">
                                {c.courseCode}
                                <span className="font-normal text-gray-500"> {c.courseTitle}</span>
                              </p>
                              <p className="mt-0.5 text-xs text-gray-600 break-words">{c.nextStep}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', BUCKETS[c.bucket].pill)}>
                                {BUCKETS[c.bucket].label}
                              </span>
                              <p className="mt-1 text-xs text-gray-500 tabular-nums">
                                {c.bucket === 'secure' || c.bucket === 'likely'
                                  ? `${range(c.low, c.high)} cr`
                                  : `${fmt(c.convertedCredits)} cr`}
                              </p>
                            </div>
                          </div>
                          {c.originalCredits !== c.convertedCredits && (
                            <p className="mt-1 text-[11px] text-gray-400">{fmt(c.originalCredits)} quarter credits convert to {fmt(c.convertedCredits)}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

export default DegreeProgressCard;
