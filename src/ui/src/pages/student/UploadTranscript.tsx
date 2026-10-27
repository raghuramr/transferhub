import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { accountApi, documentsApi, transcriptsApi, universitiesApi, uploadsApi } from '../../lib/api';
import {
  Upload,
  Info,
  Paperclip,
  Loader2,
  CheckCircle2,
  X,
  Sparkles,
  GraduationCap,
  BookOpen,
  FileText,
  Plus,
  ChevronDown,
  Search,
} from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import {
  MasterDataSelect,
  useCourseCatalog,
  useTopicCatalog,
  type RawExternalCourse,
} from '../../components/ui/CascadingMasterDataSelect';

const schema = z.object({
  calendar: z.enum(['semester', 'quarter', 'trimester']),
  studentName: z.string().optional(),
  studentId: z.string().optional(),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

type CourseRow = {
  /** When the student picked this course from a known college's catalogue, its catalogue id (enables the Topic reference). */
  catalogId: number | null;
  code: string;
  title: string;
  topicId: number | null;
  credits: string;
  grade: string;
  termSeason: string;
  termYear: string;
  gradingBasis: string;
  deliveryMode: string;
  courseType: string;
  /** Optional per-course syllabus: an uploaded file (entityType/documentType 'syllabus') and/or a catalogue link. */
  syllabus: { id: string; name: string } | null;
  catalogUrl: string;
};

const EMPTY_COURSE: CourseRow = {
  catalogId: null, code: '', title: '', topicId: null, credits: '', grade: '', termSeason: '', termYear: '',
  gradingBasis: 'graded', deliveryMode: 'in_person', courseType: 'lecture', syllabus: null, catalogUrl: '',
};

type KnownCollege = { id: number; code: string; name: string };

/** Build a short, stable institution code (≤20 chars) for a free-typed college name. */
function codeFromName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  let code: string;
  if (words.length >= 2) code = words.map((w) => w[0]).join('').toUpperCase();
  else code = (words[0] ?? 'EXT').toUpperCase();
  return code.slice(0, 20) || 'EXT';
}

const quarterConvert = (c: number) => Math.floor((c * 2) / 3 * 100) / 100;

export default function UploadTranscript() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  // Shared by both the student and agency "submit transcript" routes, so
  // navigation needs to stay under whichever base path brought us here.
  const basePath = user?.role === 'agency' ? '/agency' : '/student';

  // ── Where the courses were taken (the source college). A known university
  // unlocks its catalogue for one-tap course picking; a free-typed name works
  // just as well — the backend creates the institution if it doesn't exist. ──
  const [collegeId, setCollegeId] = useState<number | null>(null);
  const [collegeName, setCollegeName] = useState('');
  const universitiesQuery = useQuery({ queryKey: ['md-universities'], queryFn: () => universitiesApi.list({ isActive: true }) });
  const knownColleges: KnownCollege[] = useMemo(
    () => (universitiesQuery.data?.data as KnownCollege[]) ?? [],
    [universitiesQuery.data],
  );
  const selectedKnown = collegeId ? knownColleges.find((c) => c.id === collegeId) ?? null : null;
  const { courses: courseOptions, raw: rawCourses, isLoading: coursesLoading } = useCourseCatalog(collegeId);

  // Prefill the source college from the student's own profile ("current institution").
  // Skipped for agencies and when a Smart-Upload document is driving the prefill instead.
  const [searchParamsEarly] = useSearchParams();
  const hasIntake = !!searchParamsEarly.get('intake');
  const overviewQuery = useQuery({
    queryKey: ['account-overview-upload'],
    queryFn: () => accountApi.studentOverview(),
    enabled: user?.role === 'student' && !hasIntake,
    retry: false,
  });
  const [collegePrefilled, setCollegePrefilled] = useState(false);
  useEffect(() => {
    if (collegePrefilled || hasIntake) return;
    const cur = overviewQuery.data?.data?.currentInstitution?.trim();
    if (!cur || !universitiesQuery.data) return;
    const norm = (v: string) => v.trim().toLowerCase();
    const match = knownColleges.find((c) => norm(c.name) === norm(cur));
    if (match) { setCollegeId(match.id); setCollegeName(match.name); }
    else setCollegeName(cur);
    setCollegePrefilled(true);
  }, [overviewQuery.data, universitiesQuery.data, knownColleges, collegePrefilled, hasIntake]);

  const [courses, setCourses] = useState<CourseRow[]>([{ ...EMPTY_COURSE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [transcriptFile, setTranscriptFile] = useState<{ id: string; name: string } | null>(null);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [outsideUS, setOutsideUS] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { calendar: 'semester' } });
  const calendar = watch('calendar');

  // ── Prefill from a document the student uploaded on the Smart upload page (?intake=<id>) ──
  const [searchParams] = useSearchParams();
  const intakeId = searchParams.get('intake');
  const prefillQuery = useQuery({ queryKey: ['documents', 'prefill', intakeId], queryFn: async () => (await documentsApi.prefill(intakeId!)).data, enabled: !!intakeId, retry: false });
  const intakeDetail = useQuery({ queryKey: ['documents', 'intake-name', intakeId], queryFn: async () => (await documentsApi.get(intakeId!)).data, enabled: !!intakeId, retry: false });
  const prefill = prefillQuery.data;
  const [prefillApplied, setPrefillApplied] = useState(false);

  useEffect(() => {
    if (!prefill || prefillApplied || !universitiesQuery.data) return;
    const norm = (v: string) => v.trim().toLowerCase();
    const match = knownColleges.find((u) => prefill.institutionCode && norm(u.code) === norm(prefill.institutionCode))
      ?? knownColleges.find((u) => norm(u.name) === norm(prefill.institutionName));
    if (match) {
      setCollegeId(match.id);
      setCollegeName(match.name);
    } else if (prefill.institutionName) {
      setCollegeName(prefill.institutionName);
    }
    if (['semester', 'quarter', 'trimester'].includes(prefill.calendar)) setValue('calendar', prefill.calendar as FormData['calendar']);
    if (prefill.studentName) setValue('studentName', prefill.studentName);
    if (prefill.studentId) setValue('studentId', prefill.studentId);
    setOutsideUS(!!prefill.isOutsideUS);
    if (prefill.documentUploadId) setTranscriptFile({ id: prefill.documentUploadId, name: intakeDetail.data?.fileName ?? 'Your uploaded document' });

    // Every course from the document becomes an editable row — nothing is dropped now.
    const key = (v: string) => v.replace(/[\s\-_.]/g, '').toLowerCase();
    const rows: CourseRow[] = prefill.courses.map((c) => {
      const season = (c.termSeason ?? c.term?.match(/fall|spring|summer|winter/i)?.[0] ?? '').toLowerCase();
      const year = c.termYear ?? Number(c.term?.match(/(19|20)\d{2}/)?.[0] ?? 0);
      return {
        ...EMPTY_COURSE,
        code: c.courseCode ?? '',
        title: c.courseTitle ?? '',
        credits: String(c.originalCredits ?? ''),
        grade: c.grade ?? '',
        termSeason: ['fall', 'spring', 'summer', 'winter'].includes(season) ? season : '',
        termYear: year ? String(year) : '',
      };
    });
    if (rows.length) setCourses(rows);
    setPrefillApplied(true);
  }, [prefill, prefillApplied, universitiesQuery.data, knownColleges, intakeDetail.data, setValue]);

  // When a known college's catalogue loads, back-fill the catalogId (and Topic access) for any
  // prefilled/typed rows whose code matches a catalogue course — without overwriting what's typed.
  useEffect(() => {
    if (coursesLoading || rawCourses.length === 0) return;
    const key = (v: string) => v.replace(/[\s\-_.]/g, '').toLowerCase();
    setCourses((prev) =>
      prev.map((r) => {
        if (r.catalogId || !r.code) return r;
        const hit = rawCourses.find((rc) => key(rc.code) === key(r.code));
        return hit ? { ...r, catalogId: hit.id } : r;
      }),
    );
  }, [rawCourses, coursesLoading]);

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDocumentUploading(true);
    setError('');
    try {
      const res = await uploadsApi.upload(file, { entityType: 'transcript', documentType: 'transcript' });
      const { id } = res.data as { id: string };
      setTranscriptFile({ id, name: file.name });
    } catch {
      setError('Document upload failed. Please try again.');
    } finally {
      setDocumentUploading(false);
    }
  };

  const addCourse = () => setCourses((prev) => [...prev, { ...EMPTY_COURSE }]);
  const removeCourse = (i: number) => setCourses((prev) => prev.filter((_, idx) => idx !== i));
  const updateCourse = (i: number, patch: Partial<CourseRow>) =>
    setCourses((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  // Running credit tally (only rows with a title/code and a credits value count).
  const filledCourses = courses.filter((c) => (c.code.trim() || c.title.trim()));
  const totalCredits = filledCourses.reduce((sum, c) => sum + (parseFloat(c.credits) || 0), 0);
  const estimatedBuCredits = calendar === 'quarter' ? quarterConvert(totalCredits) : totalCredits;

  const onSubmit = async (data: FormData) => {
    const name = (selectedKnown?.name ?? collegeName).trim();
    if (!name) {
      setError('Tell us which college you took these courses at.');
      return;
    }
    const valid = courses.filter((c) => c.code.trim() || c.title.trim());
    if (valid.length === 0) {
      setError('Add at least one course — a course code or name is enough to start.');
      return;
    }
    const missingCredits = valid.find((c) => !(parseFloat(c.credits) > 0));
    if (missingCredits) {
      setError(`Enter the credits for ${missingCredits.code || missingCredits.title || 'each course'}.`);
      return;
    }
    const badUrl = valid.find((c) => c.catalogUrl.trim() && !/^https?:\/\/\S+$/i.test(c.catalogUrl.trim()));
    if (badUrl) {
      setError(`The catalogue link for ${badUrl.code || badUrl.title} must start with http:// or https://.`);
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      const institutionName = name;
      const institutionCode = selectedKnown?.code ?? codeFromName(name);

      const res = await transcriptsApi.submit({
        institutionName,
        institutionCode,
        calendar: data.calendar,
        studentName: data.studentName,
        studentId: data.studentId,
        notes: data.notes,
        documentUploadId: transcriptFile?.id,
        isOutsideUS: outsideUS || undefined,
        courses: valid.map((c) => ({
          courseCode: (c.code.trim() || c.title.trim()).slice(0, 30),
          courseTitle: (c.title.trim() || c.code.trim()),
          originalCredits: parseFloat(c.credits) || 3,
          grade: (c.grade || 'B').trim().toUpperCase(),
          term: c.termSeason ? `${c.termSeason[0].toUpperCase()}${c.termSeason.slice(1)} ${c.termYear}`.trim() : undefined,
          termSeason: c.termSeason || undefined,
          termYear: c.termYear ? Number(c.termYear) : undefined,
          gradingBasis: c.gradingBasis || undefined,
          deliveryMode: c.deliveryMode || undefined,
          courseType: c.courseType || undefined,
          syllabusUploadId: c.syllabus?.id || undefined,
          catalogUrl: c.catalogUrl.trim() || undefined,
        })),
      });
      navigate(`${basePath}/transcript/${(res.data as { id: string }).id}`);
    } catch {
      setError('Submission failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto pb-28">
      {/* Intro */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Submit your courses for transfer credit</h1>
        <p className="mt-1 text-gray-500">
          List the courses you've already taken elsewhere. We'll check each one and show you — course by course —
          what's likely to transfer, what needs a syllabus, and what a reviewer still has to decide.
        </p>
      </div>

      {/* Smart upload shortcut */}
      {!intakeId && (
        <Link
          to={`${basePath}/documents`}
          className="mb-6 flex items-start gap-3 rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-4 transition hover:border-brand-300 hover:shadow-sm"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-white">
            <Sparkles size={18} />
          </span>
          <span>
            <span className="block font-semibold text-brand-900">Have a transcript PDF or photo? Let us fill this in for you.</span>
            <span className="block text-sm text-brand-800/80">
              Upload it on Smart Upload and we'll read the college, courses, grades and credits, then bring you back here to check them.
            </span>
          </span>
        </Link>
      )}

      {intakeId && prefill && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>We filled this in from your uploaded document — please check every field, especially credits and grades, before submitting.</span>
        </div>
      )}
      {intakeId && prefillQuery.isError && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">We could not read that document. You can still fill in the form by hand below.</div>
      )}

      {error && (
        <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* ── Step 1: the source college ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
          <StepHeader n={1} icon={<GraduationCap size={18} />} title="Where did you study?" subtitle="The college or university these courses were taken at." />

          <SourceCollegeField
            colleges={knownColleges}
            selectedId={collegeId}
            name={collegeName}
            onPickKnown={(c) => { setCollegeId(c.id); setCollegeName(c.name); }}
            onTypeFree={(v) => { setCollegeId(null); setCollegeName(v); }}
          />
          {selectedKnown ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-green-700">
              <CheckCircle2 size={13} /> We have this college's course catalogue — you can pick courses from it below.
            </p>
          ) : collegeName.trim() ? (
            <p className="mt-2 text-xs text-gray-500">We'll record "{collegeName.trim()}" as your transfer college. Type your courses in below.</p>
          ) : null}

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Calendar system *</label>
              <select
                {...register('calendar')}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="semester">Semester</option>
                <option value="quarter">Quarter (credits × 2/3)</option>
                <option value="trimester">Trimester</option>
              </select>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700 sm:pt-7">
              <input type="checkbox" checked={outsideUS} onChange={(e) => setOutsideUS(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
              <span>This college is outside the United States</span>
            </label>
          </div>

          {calendar === 'quarter' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
              <Info size={16} className="mt-0.5 shrink-0" />
              Quarter credits convert to two-thirds at BU (e.g. 4 quarter credits = 2.66 BU credits). We'll show the converted total below.
            </div>
          )}
          {calendar === 'trimester' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
              <Info size={16} className="mt-0.5 shrink-0" />
              Trimester credits are confirmed by a reviewer, so the BU total below is shown as pending.
            </div>
          )}
          {outsideUS && (
            <div className="mt-3 rounded-lg bg-sky-50 p-3 text-xs text-sky-900">
              Coursework from outside the US is evaluated by BU's Office of International Undergraduate Admissions
              (<a className="underline" href="mailto:intadvis@bu.edu">intadvis@bu.edu</a>). We'll record it and flag it for that office.
            </div>
          )}
        </section>

        {/* ── Step 2: courses ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
          <StepHeader n={2} icon={<BookOpen size={18} />} title="Your courses" subtitle="One row per course you took. Add as many as you need." />

          <div className="space-y-4">
            {courses.map((course, i) => (
              <CourseRowFields
                key={i}
                index={i}
                row={course}
                hasCatalog={!!selectedKnown}
                courseOptions={courseOptions}
                rawCourses={rawCourses}
                coursesLoading={coursesLoading}
                onChange={(patch) => updateCourse(i, patch)}
                onRemove={() => removeCourse(i)}
                removable={courses.length > 1}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addCourse}
            className="mt-4 flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-brand-800 hover:border-brand-300 hover:bg-brand-50"
          >
            <Plus size={16} /> Add another course
          </button>
        </section>

        {/* ── Step 3: transcript document ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
          <StepHeader n={3} icon={<FileText size={18} />} title="Transcript document" subtitle="Optional — attach a scan so reviewers can cross-check." />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 cursor-pointer hover:bg-gray-50 w-fit">
              {documentUploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
              {documentUploading ? 'Uploading…' : transcriptFile ? 'Replace file' : 'Attach PDF or image'}
              <input type="file" accept=".pdf,image/*" className="hidden" onChange={handleDocumentUpload} disabled={documentUploading} />
            </label>
            {transcriptFile && !documentUploading && (
              <span className="flex items-center gap-1.5 text-sm text-gray-600">
                <CheckCircle2 size={14} className="text-green-600" /> {transcriptFile.name}
                <button type="button" onClick={() => setTranscriptFile(null)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
              </span>
            )}
          </div>
        </section>
      </form>

      {/* ── Sticky summary + submit bar (offset past the desktop sidebar so it never covers it) ── */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 z-20 border-t border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="text-sm">
            <span className="font-semibold text-gray-900">{filledCourses.length}</span>
            <span className="text-gray-500"> course{filledCourses.length === 1 ? '' : 's'}</span>
            <span className="mx-2 text-gray-300">•</span>
            <span className="font-semibold text-gray-900">{totalCredits || 0}</span>
            <span className="text-gray-500"> credits entered</span>
            {calendar !== 'semester' && (
              <>
                <span className="mx-2 text-gray-300">•</span>
                <span className="text-gray-500">≈ </span>
                <span className="font-semibold text-brand-800">{calendar === 'trimester' ? 'pending' : estimatedBuCredits}</span>
                <span className="text-gray-500"> BU credits</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate(basePath)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</button>
            <button
              type="button"
              onClick={handleSubmit(onSubmit)}
              disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {submitting ? 'Submitting…' : 'Submit for evaluation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepHeader({ n, icon, title, subtitle }: { n: number; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-800">{icon}</span>
      <div>
        <h2 className="font-semibold text-gray-900">
          <span className="mr-1.5 text-brand-700">{n}.</span>{title}
        </h2>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}

const fieldCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

/** Searchable college picker: pick a known university, or type any college name (free text). */
function SourceCollegeField({
  colleges,
  selectedId,
  name,
  onPickKnown,
  onTypeFree,
}: {
  colleges: KnownCollege[];
  selectedId: number | null;
  name: string;
  onPickKnown: (c: KnownCollege) => void;
  onTypeFree: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const q = name.trim().toLowerCase();
  const filtered = q
    ? colleges.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    : colleges;

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">Transfer college *</label>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={name}
          onChange={(e) => { onTypeFree(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search for your college, or type its name…"
          className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
      </div>

      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 && !name.trim() && (
            <div className="px-3 py-2 text-sm text-gray-400">Start typing your college's name…</div>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onPickKnown(c); setOpen(false); }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand-50 ${selectedId === c.id ? 'bg-brand-50' : ''}`}
            >
              <span className="text-gray-800">{c.name}</span>
              <span className="text-xs text-gray-400">{c.code}</span>
            </button>
          ))}
          {name.trim() && !colleges.some((c) => c.name.toLowerCase() === name.trim().toLowerCase()) && (
            <button
              type="button"
              onClick={() => { onTypeFree(name.trim()); setOpen(false); }}
              className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-sm text-brand-800 hover:bg-brand-50"
            >
              <Plus size={14} /> Use “{name.trim()}” — my college isn't listed
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CourseRowFields({
  index,
  row,
  hasCatalog,
  courseOptions,
  rawCourses,
  coursesLoading,
  onChange,
  onRemove,
  removable,
}: {
  index: number;
  row: CourseRow;
  hasCatalog: boolean;
  courseOptions: { id: number; label: string; sublabel?: string }[];
  rawCourses: RawExternalCourse[];
  coursesLoading: boolean;
  onChange: (patch: Partial<CourseRow>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const { topics } = useTopicCatalog(row.catalogId);
  const [sylUploading, setSylUploading] = useState(false);
  const [sylError, setSylError] = useState('');

  const pickFromCatalog = (id: number | null) => {
    if (!id) { onChange({ catalogId: null, topicId: null }); return; }
    const hit = rawCourses.find((rc) => rc.id === id);
    if (!hit) return;
    onChange({ catalogId: id, topicId: null, code: hit.code, title: hit.title, credits: String(hit.credits ?? '') });
  };

  const attachSyllabus = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSylUploading(true);
    setSylError('');
    try {
      const res = await uploadsApi.upload(file, { entityType: 'syllabus', documentType: 'syllabus' });
      onChange({ syllabus: { id: (res.data as { id: string }).id, name: file.name } });
    } catch {
      setSylError('Could not upload the syllabus. You can skip it and send it later.');
    } finally {
      setSylUploading(false);
    }
  };

  const showPolicyWarning = row.gradingBasis !== 'graded' || ['internship', 'research', 'military', 'life_experience'].includes(row.courseType);

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Course {index + 1}</span>
        {removable && (
          <button type="button" onClick={onRemove} className="text-xs text-gray-400 hover:text-red-500">Remove</button>
        )}
      </div>

      {hasCatalog && (
        <div className="mb-3">
          <MasterDataSelect
            label="Pick from this college's catalogue (optional — fills the fields for you)"
            placeholder="Search this college's courses…"
            items={courseOptions}
            selectedId={row.catalogId}
            loading={coursesLoading}
            onSelect={pickFromCatalog}
            canCreate={false}
          />
        </div>
      )}

      {/* Code + title (always editable, even after a catalogue pick) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,160px)_1fr]">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Course code</label>
          <input value={row.code} onChange={(e) => onChange({ code: e.target.value })} placeholder="e.g. CS 101" className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Course title</label>
          <input value={row.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g. Introduction to Computer Science" className={fieldCls} />
        </div>
      </div>

      {topics.length > 0 && (
        <div className="mt-3">
          <MasterDataSelect
            label="Topic (optional reference)"
            placeholder="Select a topic for reference…"
            items={topics}
            selectedId={row.topicId}
            onSelect={(id) => onChange({ topicId: id })}
            canCreate={false}
          />
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Credits taken *</label>
          <input value={row.credits} onChange={(e) => onChange({ credits: e.target.value })} placeholder="4" type="number" step="0.5" className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Grade</label>
          <input value={row.grade} onChange={(e) => onChange({ grade: e.target.value })} placeholder="A, B+, C, P…" className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Term</label>
          <select value={row.termSeason} onChange={(e) => onChange({ termSeason: e.target.value })} className={fieldCls}>
            <option value="">Select…</option><option value="fall">Fall</option><option value="spring">Spring</option><option value="summer">Summer</option><option value="winter">Winter</option><option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Year</label>
          <input value={row.termYear} onChange={(e) => onChange({ termYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2024" inputMode="numeric" className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Graded as</label>
          <select value={row.gradingBasis} onChange={(e) => onChange({ gradingBasis: e.target.value })} className={fieldCls}>
            <option value="graded">Letter grade</option><option value="pass_fail">Pass / Fail</option><option value="sat_unsat">Satisfactory / Unsatisfactory</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Taken</label>
          <select value={row.deliveryMode} onChange={(e) => onChange({ deliveryMode: e.target.value })} className={fieldCls}>
            <option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option>
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
          <select value={row.courseType} onChange={(e) => onChange({ courseType: e.target.value })} className={fieldCls}>
            <option value="lecture">Lecture</option><option value="lab">Lab</option><option value="seminar">Seminar</option>
            <option value="internship">Internship</option><option value="research">Research</option><option value="military">Military training</option>
            <option value="life_experience">Life / work experience</option><option value="other">Other</option>
          </select>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 p-3" data-testid="syllabus-slot">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-gray-500">Syllabus <span className="font-normal text-gray-400">(optional)</span></span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                {sylUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                {sylUploading ? 'Uploading…' : row.syllabus ? 'Replace' : 'Attach syllabus'}
                <input type="file" accept=".pdf,.doc,.docx,image/*" className="hidden" onChange={attachSyllabus} disabled={sylUploading} />
              </label>
              {row.syllabus && !sylUploading && (
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-gray-600">
                  <CheckCircle2 size={14} className="shrink-0 text-green-600" />
                  <span className="truncate">{row.syllabus.name}</span>
                  <button type="button" onClick={() => onChange({ syllabus: null })} className="text-gray-400 hover:text-red-500" aria-label="Remove syllabus"><X size={14} /></button>
                </span>
              )}
            </div>
            {sylError && <p className="mt-1 text-xs text-red-600">{sylError}</p>}
            <p className="mt-1 text-xs text-gray-400">A syllabus helps the reviewer match this course faster.</p>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-gray-500">Catalogue link <span className="font-normal text-gray-400">(optional)</span></label>
            <input value={row.catalogUrl} onChange={(e) => onChange({ catalogUrl: e.target.value })} placeholder="https://catalog.college.edu/course/…" type="url" inputMode="url" className={fieldCls} />
          </div>
        </div>
      </div>

      {showPolicyWarning && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          {row.gradingBasis !== 'graded'
            ? 'BU does not normally accept Pass/Fail credit (exceptions: Spring 2020, or when your college required P/F). A reviewer will check it.'
            : 'BU does not award transfer credit for internships, research, military or life experience.'}
        </p>
      )}
    </div>
  );
}
