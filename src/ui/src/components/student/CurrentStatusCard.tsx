import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, ChevronDown, Compass, Flag, GraduationCap, School, Upload, Pencil, Check, X, Loader2 } from 'lucide-react';
import { api, transcriptsApi } from '../../lib/api';
import type { JourneyCourse } from './journeyTypes';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';
import { fmtCredits, type JourneyOverview } from './journeyTypes';

const BUCKET_TONE: Record<string, 'green' | 'blue' | 'amber' | 'gray'> = { secure: 'green', likely: 'blue', pending: 'amber', not_counted: 'gray' };
const BUCKET_LABEL: Record<string, string> = { secure: 'Secured', likely: 'Likely', pending: 'Pending', not_counted: 'Not counted' };
const SOURCE_LABEL = { transcript: 'from your latest transcript request', profile: 'from your profile', education: 'from your education history' } as const;

/** "Where I am now": current institution, program, courses and credits, and where the student is headed. */
export function CurrentStatusCard({ className }: { className?: string }) {
  const [showAll, setShowAll] = useState(false);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<JourneyCourse | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student', 'overview'],
    queryFn: async () => (await api.get<JourneyOverview>('/student/overview')).data,
  });

  if (isLoading) return <div className={cn('rounded-2xl border border-brand-100/60 bg-white p-6 text-sm text-gray-400', className)}>Loading where you are now...</div>;
  if (isError || !data) return null; // the dashboard keeps working without this card

  const o = data;
  const hasCourses = o.courses.length > 0;
  const shown = showAll ? o.courses : o.courses.slice(0, 5);
  const t = o.atTarget;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      className={cn('overflow-hidden rounded-2xl border border-brand-100/60 bg-white shadow-sm shadow-brand-900/5', className)}
      aria-label="Where I am now"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100/60 bg-brand-50/50 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-800 text-white"><Compass size={18} /></span>
          <div>
            <h2 className="font-semibold text-gray-900">Where I am now</h2>
            <p className="text-xs text-gray-500">Your current school, courses and where you are headed</p>
          </div>
        </div>
        <Link to="/student/explore" className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50">
          <School size={14} /> Explore universities
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-px bg-brand-100/50 md:grid-cols-3">
        <div className="bg-white p-5 sm:px-6">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500"><School size={13} /> Currently at</p>
          {o.institution ? (
            <>
              <p className="mt-1.5 break-words text-lg font-semibold text-gray-900">{o.institution.name}</p>
              <p className="text-xs text-gray-400">{SOURCE_LABEL[o.institution.source]}</p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-gray-500">Not set yet. Add your school in your profile or submit a transcript.</p>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500"><GraduationCap size={13} /> Program / major</p>
          <p className="mt-1 break-words text-sm font-medium text-gray-800">{o.program ?? <span className="font-normal text-gray-500">Not set yet</span>}</p>
        </div>

        <div className="bg-white p-5 sm:px-6">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500"><BookOpen size={13} /> Credits accumulated</p>
          {hasCourses ? (
            <>
              <p className="mt-1.5 text-3xl font-bold text-brand-800">{fmtCredits(o.totals.convertedCredits)}</p>
              <p className="text-xs text-gray-500">
                across {o.totals.courses} course{o.totals.courses === 1 ? '' : 's'}
                {o.totals.originalCredits !== o.totals.convertedCredits && ` (${fmtCredits(o.totals.originalCredits)} as printed; quarter credits count 2/3)`}
              </p>
            </>
          ) : o.profileCredits != null ? (
            <>
              <p className="mt-1.5 text-3xl font-bold text-brand-800">{fmtCredits(o.profileCredits)}</p>
              <p className="text-xs text-gray-500">credits reported in your education history. Submit a transcript to see course by course.</p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-gray-500">No courses yet. Submit a transcript and they will appear here.</p>
          )}
        </div>

        <div className="bg-white p-5 sm:px-6">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500"><Flag size={13} /> Heading to</p>
          {o.target ? (
            <>
              <p className="mt-1.5 break-words text-lg font-semibold text-gray-900">{o.target.institutionName}</p>
              <p className="break-words text-sm text-gray-600">{o.target.programName ?? 'Program not chosen yet'}</p>
              {t ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="green">{fmtCredits(t.secure)} secured</Badge>
                  <Badge tone="blue">{t.likelyLow === t.likelyHigh ? fmtCredits(t.likelyLow) : `${fmtCredits(t.likelyLow)}-${fmtCredits(t.likelyHigh)}`} likely</Badge>
                  {t.pending > 0 && <Badge tone="amber">{fmtCredits(t.pending)} pending</Badge>}
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">Credit position appears once your courses are submitted.</p>
              )}
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-gray-500">You have not picked a target university yet.</p>
              <Link to="/student/explore" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">Compare universities</Link>
            </>
          )}
        </div>
      </div>

      {hasCourses ? (
        <div className="px-5 py-4 sm:px-6">
          <ul className="divide-y divide-gray-100">
            {shown.map((c) =>
              editing?.id === c.id ? (
                <li key={c.id} className="py-2">
                  <CourseEditRow
                    course={c}
                    onCancel={() => setEditing(null)}
                    onSaved={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['student'] }); }}
                  />
                </li>
              ) : (
                <li key={c.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="w-24 shrink-0 font-medium text-gray-900">{c.code}</span>
                  <span className="min-w-0 flex-1 basis-40 break-words text-gray-700">{c.title}</span>
                  <span className="text-xs text-gray-500">{[c.term, c.grade && `Grade ${c.grade}`].filter(Boolean).join(' - ')}</span>
                  <span className="text-xs tabular-nums text-gray-600">
                    {fmtCredits(c.convertedCredits)} cr{c.convertedCredits !== c.originalCredits && ` (${fmtCredits(c.originalCredits)} orig.)`}
                  </span>
                  {c.bucket && <Badge tone={BUCKET_TONE[c.bucket] ?? 'gray'}>{BUCKET_LABEL[c.bucket] ?? c.bucket}</Badge>}
                  {c.bucket !== 'secure' && (
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-brand-700"
                      aria-label={`Edit ${c.code}`}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </li>
              ),
            )}
          </ul>
          {o.courses.length > 5 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              <ChevronDown size={14} className={cn('transition-transform', showAll && 'rotate-180')} />
              {showAll ? 'Show fewer courses' : `Show all ${o.courses.length} courses`}
            </button>
          )}
          {t && (
            <p className="mt-3 text-xs text-gray-500">
              Credit position is measured against {o.target?.institutionName}'s rules (cap {fmtCredits(t.cap)}, {fmtCredits(t.capRemaining)} still available).
              {t.isProvisional && ' Some courses are still waiting on a decision, so this can change.'}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
          <p className="text-sm text-gray-500">Nothing submitted yet.</p>
          <Link to="/student/upload" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-900"><Upload size={14} /> Submit your courses</Link>
        </div>
      )}
    </motion.section>
  );
}

const SEASONS = ['', 'fall', 'spring', 'summer', 'winter', 'other'];

/** Inline editor for one submitted course (student fixes code/title/credits/grade/term); re-triages on save. */
function CourseEditRow({ course, onCancel, onSaved }: { course: JourneyCourse; onCancel: () => void; onSaved: () => void }) {
  const parsed = /(fall|spring|summer|winter)\s*(\d{4})?/i.exec(course.term ?? '');
  const [form, setForm] = useState({
    courseCode: course.code,
    courseTitle: course.title,
    originalCredits: String(course.originalCredits ?? ''),
    grade: course.grade ?? '',
    termSeason: (parsed?.[1] ?? '').toLowerCase(),
    termYear: parsed?.[2] ?? '',
  });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const season = form.termSeason;
      const term = season ? `${season[0].toUpperCase()}${season.slice(1)} ${form.termYear}`.trim() : (course.term ?? undefined);
      return transcriptsApi.updateCourse(course.id, {
        courseCode: form.courseCode.trim(),
        courseTitle: form.courseTitle.trim(),
        originalCredits: parseFloat(form.originalCredits) || course.originalCredits,
        grade: form.grade.trim().toUpperCase() || undefined,
        term,
        termSeason: season || undefined,
        termYear: form.termYear ? Number(form.termYear) : undefined,
      });
    },
    onSuccess: onSaved,
    onError: (e: unknown) => {
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setErr((Array.isArray(m) ? m.join(', ') : m) ?? 'Could not save this course.');
    },
  });
  const field = 'rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input value={form.courseCode} onChange={(e) => setForm((f) => ({ ...f, courseCode: e.target.value }))} placeholder="Code" className={field} />
        <input value={form.courseTitle} onChange={(e) => setForm((f) => ({ ...f, courseTitle: e.target.value }))} placeholder="Title" className={`${field} col-span-2 sm:col-span-3`} />
        <input value={form.originalCredits} onChange={(e) => setForm((f) => ({ ...f, originalCredits: e.target.value }))} placeholder="Credits" type="number" step="0.5" className={field} />
        <input value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))} placeholder="Grade" className={field} />
        <select value={form.termSeason} onChange={(e) => setForm((f) => ({ ...f, termSeason: e.target.value }))} className={field}>
          {SEASONS.map((s) => <option key={s} value={s}>{s ? s[0].toUpperCase() + s.slice(1) : 'Term…'}</option>)}
        </select>
        <input value={form.termYear} onChange={(e) => setForm((f) => ({ ...f, termYear: e.target.value.replace(/\D/g, '').slice(0, 4) }))} placeholder="Year" inputMode="numeric" className={field} />
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-brand-800 px-3 py-1 text-xs font-medium text-white hover:bg-brand-900 disabled:opacity-60">
          {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save &amp; re-check
        </button>
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">
          <X size={13} /> Cancel
        </button>
      </div>
    </div>
  );
}
