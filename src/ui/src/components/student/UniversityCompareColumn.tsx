import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Flag, School, Upload, X } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';
import { fmtCredits, type JourneyUniversity, type MatchedCourse, type ProgramRollup, type UniversityComparison } from './journeyTypes';

function ConfidenceChip({ m }: { m: MatchedCourse }) {
  if (m.kind === 'known') return <Badge tone="green">{m.outcome === 'elective' ? 'Known - elective' : 'Known match'}</Badge>;
  const pct = Math.round((m.confidence ?? 0) * 100);
  return <Badge tone={pct >= 50 ? 'blue' : 'amber'}>Suggested {pct}%</Badge>;
}

function MatchRow({ m }: { m: MatchedCourse }) {
  return (
    <li className="py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium text-gray-800">{m.studentCode}</span>
        <span className="text-gray-400">maps to</span>
        <span className="min-w-0 break-words font-medium text-brand-800">{m.universityCode}</span>
        <span className="ml-auto tabular-nums text-gray-700">{fmtCredits(m.transferCredits)} cr</span>
      </div>
      <p className="mt-0.5 break-words text-gray-500">{m.universityTitle} ({fmtCredits(m.universityCredits)} cr)</p>
      <div className="mt-1 flex flex-wrap items-start gap-1.5">
        <ConfidenceChip m={m} />
        <span className="min-w-0 flex-1 basis-32 break-words text-gray-400">{m.reason}</span>
      </div>
    </li>
  );
}

function ProgramBlock({ p, onTarget, isTargetProgram }: { p: ProgramRollup; onTarget: (programId: number) => void; isTargetProgram: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-gray-100 bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left" aria-expanded={open}>
        <ChevronDown size={16} className={cn('mt-0.5 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium text-gray-900">{p.name}{p.degree ? ` (${p.degree})` : ''}</span>
          <span className="text-xs text-gray-500">{p.coursesCovered} course{p.coursesCovered === 1 ? '' : 's'} covered</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold text-brand-800">{fmtCredits(p.transferableCredits)} cr</span>
          <span className="text-[11px] text-gray-400">{fmtCredits(p.knownCredits)} known</span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-gray-100 px-3 pb-3">
              <ul className="divide-y divide-gray-100">{p.matched.map((m) => <MatchRow key={m.studentCourseId} m={m} />)}</ul>
              {p.capped && <p className="mt-1 text-[11px] text-amber-700">Trimmed to the university's external credit cap.</p>}
              <button
                onClick={() => onTarget(p.programId)}
                disabled={isTargetProgram}
                className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:text-gray-400"
              >
                <Flag size={12} /> {isTargetProgram ? 'This is your target program' : 'Make this my target program'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

interface Props {
  index: number;
  universities: JourneyUniversity[];
  value: number;
  /** Omitted when this is the only university shown (the last one cannot be removed). */
  onRemove?: () => void;
  data: UniversityComparison | undefined;
  loading: boolean;
  error: boolean;
  targetInstitutionId: number | null;
  targetProgramId: number | null;
  /** The student's own total credits, for the my-credits vs would-transfer comparison. */
  myTotalCredits: number;
}

/** One selected university's full preview, with a remove button when more than one is shown. */
export function UniversityCompareColumn({ index, universities, value, onRemove, data, loading, error, targetInstitutionId, targetProgramId, myTotalCredits }: Props) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setTarget = useMutation({
    mutationFn: async (programId: number | null) =>
      (await api.put('/account/target', { institutionId: value, ...(programId ? { programId } : {}) })).data,
    onSuccess: () => {
      setMsg({ ok: true, text: 'Saved. This is now your target.' });
      qc.invalidateQueries({ queryKey: ['student', 'overview'] });
      qc.invalidateQueries({ queryKey: ['progress'] });
    },
    onError: (e: any) => {
      const status = e?.response?.status;
      setMsg({ ok: false, text: status === 404 ? 'Changing your target is not available yet. Please try again later.' : e?.response?.data?.message ?? 'Could not update your target.' });
    },
  });

  const uni = universities.find((u) => u.id === value) ?? null;
  const isTarget = value === targetInstitutionId;
  const s = data?.summary;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: index * 0.06 }}
      className="min-w-0 rounded-2xl border border-brand-100/60 bg-white shadow-sm shadow-brand-900/5"
    >
      <div className="border-b border-brand-100/60 bg-brand-50/50 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <School size={18} className="shrink-0 text-brand-700" />
          <h2 className="min-w-0 flex-1 break-words text-sm font-semibold text-gray-900">{uni?.name ?? `University ${value}`}</h2>
          {onRemove && (
            <button onClick={onRemove} aria-label={`Remove ${uni?.name ?? 'this university'} from the comparison`} className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-white hover:text-gray-700"><X size={16} /></button>
          )}
        </div>
        {isTarget && <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={13} /> Your current target</p>}
      </div>

      {loading ? (
        <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : error || !data || !s ? (
        <p className="p-4 text-sm text-red-600">Could not load the comparison for {uni?.name ?? 'this university'}.</p>
      ) : (
        <div className="space-y-4 p-3 sm:p-4">
          {/* Your credits vs what would transfer to this university, side by side. */}
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-2xl font-bold leading-none text-gray-800">{fmtCredits(myTotalCredits)}</p>
              <p className="mt-1 text-[11px] text-gray-500">your total credits</p>
            </div>
            <div className="rounded-xl bg-brand-800 p-3 text-white">
              <p className="text-2xl font-bold leading-none">{fmtCredits(s.transferableCredits)}</p>
              <p className="mt-1 text-[11px] text-brand-100">would transfer to {uni?.name ?? 'here'}</p>
            </div>
          </div>
          <div className="rounded-xl bg-brand-50 p-3 text-center">
            <p className="text-lg font-bold leading-none text-brand-800">{s.coursesMatched} <span className="text-sm font-medium text-gray-500">of {s.studentCourses}</span></p>
            <p className="mt-1 text-[11px] text-gray-500">courses matched ({s.percentMatched}%)</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge tone="green">{fmtCredits(s.knownCredits)} cr known ({s.coursesKnown})</Badge>
            <Badge tone="blue">{fmtCredits(s.suggestedCredits)} cr suggested ({s.coursesSuggested})</Badge>
            {s.capped && <Badge tone="amber">Trimmed to the {fmtCredits(data.cap)}-credit cap</Badge>}
          </div>
          <p className="text-[11px] text-gray-400">Credits still needed for the degree are confirmed by the department after admission.</p>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Programs that fit your courses ({data.programs.length})</h3>
            {data.programs.length ? (
              <ul className="space-y-2">
                {data.programs.map((p) => (
                  <ProgramBlock key={p.programId} p={p} isTargetProgram={isTarget && targetProgramId === p.programId} onTarget={(pid) => { setMsg(null); setTarget.mutate(pid); }} />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500">No program here lists a course that matches yours yet.</p>
            )}
          </div>

          {data.otherMatches.length > 0 && (
            <details className="rounded-xl border border-gray-100 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-gray-700">Other matches outside a listed program ({data.otherMatches.length})</summary>
              <ul className="mt-1 divide-y divide-gray-100">{data.otherMatches.map((m) => <MatchRow key={m.studentCourseId} m={m} />)}</ul>
            </details>
          )}
          {data.noMatch.length > 0 && (
            <details className="rounded-xl border border-gray-100 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-gray-700">No match yet ({data.noMatch.length})</summary>
              <ul className="mt-1 divide-y divide-gray-100">
                {data.noMatch.map((n) => (
                  <li key={n.studentCourseId} className="py-1.5 text-xs">
                    <span className="font-medium text-gray-800">{n.studentCode}</span> <span className="break-words text-gray-500">{n.studentTitle}</span>
                    <p className="text-gray-400">{n.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
            <button
              onClick={() => { setMsg(null); setTarget.mutate(null); }}
              disabled={isTarget || setTarget.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-gray-200 disabled:text-gray-500"
            >
              <Flag size={15} /> {isTarget ? 'This is my target university' : setTarget.isPending ? 'Saving...' : 'Make this my target university'}
            </button>
            <Link to="/student/upload" className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50">
              <Upload size={15} /> Start evaluation for this university
            </Link>
            {msg && <p role="status" className={cn('text-xs', msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</p>}
          </div>
        </div>
      )}
    </motion.div>
  );
}
