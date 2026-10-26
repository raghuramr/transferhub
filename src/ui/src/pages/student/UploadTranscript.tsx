import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { transcriptsApi, uploadsApi } from '../../lib/api';
import { Upload, Info, Paperclip, Loader2, CheckCircle2, X } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import {
  MasterDataCascade,
  MasterDataSelect,
  EMPTY_MASTER_DATA_SELECTION,
  useCourseCatalog,
  useTopicCatalog,
  type MasterDataSelection,
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
  courseId: number | null;
  topicId: number | null;
  credits: string;
  grade: string;
  termSeason: string;
  termYear: string;
  gradingBasis: string;
  deliveryMode: string;
  courseType: string;
};

type ValidCourseRow = CourseRow & { course: RawExternalCourse };

const EMPTY_COURSE: CourseRow = {
  courseId: null, topicId: null, credits: '', grade: '', termSeason: '', termYear: '', gradingBasis: 'graded', deliveryMode: 'in_person', courseType: 'lecture',
};

export default function UploadTranscript() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  // Shared by both the student and agency "submit transcript" routes, so
  // navigation needs to stay under whichever base path brought us here.
  const basePath = user?.role === 'agency' ? '/agency' : '/student';

  // University/Institution/Program picked once for the whole transcript —
  // this is where the courses below are pulled from. Pre-selected from the
  // logged-in user's scope-visibility by MasterDataCascade itself.
  const [masterData, setMasterData] = useState<MasterDataSelection>(EMPTY_MASTER_DATA_SELECTION);
  const { courses: courseOptions, raw: rawCourses, isLoading: coursesLoading } = useCourseCatalog(
    masterData.universityId,
    masterData.programId,
  );

  const [courses, setCourses] = useState<CourseRow[]>([{ ...EMPTY_COURSE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [transcriptFile, setTranscriptFile] = useState<{ id: string; name: string } | null>(null);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [outsideUS, setOutsideUS] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { calendar: 'semester' } });

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDocumentUploading(true);
    setError('');
    try {
      const res = await uploadsApi.upload(file, { entityType: 'transcript' });
      const { id } = res.data as { id: string };
      setTranscriptFile({ id, name: file.name });
    } catch {
      setError('Document upload failed. Please try again.');
    } finally {
      setDocumentUploading(false);
    }
  };

  const addCourse = () => setCourses((prev) => [...prev, { ...EMPTY_COURSE }]);
  const removeCourse = (i: number) =>
    setCourses((prev) => prev.filter((_, idx) => idx !== i));
  const updateCourse = (i: number, patch: Partial<CourseRow>) =>
    setCourses((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const onSubmit = async (data: FormData) => {
    if (!masterData.universityId) {
      setError('Select the institution you are transferring from.');
      return;
    }
    const validCourses = courses
      .map((c) => ({ ...c, course: rawCourses.find((rc) => rc.id === c.courseId) }))
      .filter((c): c is ValidCourseRow => !!c.course);
    if (validCourses.length === 0) {
      setError('Add at least one course.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      // Universities list isn't held locally here — look it up via the
      // course rows' own institution fields, which the API already returns.
      const institutionName = validCourses[0].course.institutionName;
      const institutionCode = validCourses[0].course.institutionCode;

      const res = await transcriptsApi.submit({
        institutionName,
        institutionCode,
        calendar: data.calendar,
        studentName: data.studentName,
        studentId: data.studentId,
        notes: data.notes,
        documentUploadId: transcriptFile?.id,
        isOutsideUS: outsideUS || undefined,
        courses: validCourses.map((c) => ({
          courseCode: c.course.code,
          courseTitle: c.course.title,
          originalCredits: parseFloat(c.credits) || c.course.credits || 3,
          grade: (c.grade || 'B').trim().toUpperCase(),
          term: c.termSeason ? `${c.termSeason[0].toUpperCase()}${c.termSeason.slice(1)} ${c.termYear}`.trim() : undefined,
          termSeason: c.termSeason || undefined,
          termYear: c.termYear ? Number(c.termYear) : undefined,
          gradingBasis: c.gradingBasis || undefined,
          deliveryMode: c.deliveryMode || undefined,
          courseType: c.courseType || undefined,
        })),
      });
      navigate(`${basePath}/transcript/${(res.data as { id: string }).id}`);
    } catch {
      setError('Submission failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Submit Transcript</h1>
      <p className="text-gray-500 mb-8">Select your transfer institution and courses from the catalog below.</p>

      {error && (
        <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Institution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Institution Details</h2>

          <MasterDataCascade
            value={masterData}
            onChange={setMasterData}
            through="program"
            restrictToScope
          />

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Calendar System *</label>
            <select
              {...register('calendar')}
              className="w-full md:w-1/2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="semester">Semester</option>
              <option value="quarter">Quarter (credits × 2/3)</option>
              <option value="trimester">Trimester</option>
            </select>
          </div>

          <div className="mt-3 flex items-start gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
            <Info size={16} className="shrink-0 mt-0.5" />
            Quarter credits are converted at two-thirds (BU policy, e.g. 4 quarter credits = 2.66). Trimester credits are set by a reviewer.
          </div>

          <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={outsideUS} onChange={(e) => setOutsideUS(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
            <span>
              This college is outside the United States
              {outsideUS && (
                <span className="mt-1 block rounded-lg bg-sky-50 p-2 text-xs text-sky-900">
                  Coursework from outside the US is evaluated by BU's Office of International Undergraduate Admissions
                  (<a className="underline" href="mailto:intadvis@bu.edu">intadvis@bu.edu</a>). We will record it and flag it for that office.
                </span>
              )}
            </span>
          </label>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Transcript document <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 cursor-pointer hover:bg-gray-50 w-fit">
                {documentUploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
                {documentUploading ? 'Uploading…' : transcriptFile ? 'Replace file' : 'Attach PDF or image'}
                <input
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  onChange={handleDocumentUpload}
                  disabled={documentUploading}
                />
              </label>
              {transcriptFile && !documentUploading && (
                <span className="flex items-center gap-1.5 text-sm text-gray-600">
                  <CheckCircle2 size={14} className="text-green-600" /> {transcriptFile.name}
                  <button
                    type="button"
                    onClick={() => setTranscriptFile(null)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Attach a scanned copy of your official transcript for the evaluator to review alongside the courses below.
            </p>
          </div>
        </div>

        {/* Courses */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Courses</h2>
            <button
              type="button"
              onClick={addCourse}
              disabled={!masterData.universityId}
              className="text-sm text-brand-800 hover:text-brand-900 font-medium disabled:text-gray-300"
            >
              + Add course
            </button>
          </div>

          {!masterData.universityId && (
            <p className="text-sm text-gray-400 mb-2">Select an institution above to choose courses.</p>
          )}

          <div className="space-y-4">
            {courses.map((course, i) => (
              <CourseRowFields
                key={i}
                row={course}
                courseOptions={courseOptions}
                coursesLoading={coursesLoading}
                disabled={!masterData.universityId}
                onChange={(patch) => updateCourse(i, patch)}
                onRemove={() => removeCourse(i)}
                removable={courses.length > 1}
              />
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate(basePath)}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
          >
            <Upload size={16} />
            {submitting ? 'Submitting…' : 'Submit Transcript'}
          </button>
        </div>
      </form>
    </div>
  );
}

const fieldCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function CourseRowFields({
  row,
  courseOptions,
  coursesLoading,
  disabled,
  onChange,
  onRemove,
  removable,
}: {
  row: CourseRow;
  courseOptions: { id: number; label: string; sublabel?: string }[];
  coursesLoading: boolean;
  disabled: boolean;
  onChange: (patch: Partial<CourseRow>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const { topics } = useTopicCatalog(row.courseId);

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MasterDataSelect
          label="Course"
          placeholder="Select a course…"
          items={courseOptions}
          selectedId={row.courseId}
          disabled={disabled}
          loading={coursesLoading}
          onSelect={(id) => onChange({ courseId: id, topicId: null })}
          canCreate={false}
        />
        {topics.length > 0 && (
          <MasterDataSelect
            label="Topic (optional reference)"
            placeholder="Select a topic for reference…"
            items={topics}
            selectedId={row.topicId}
            disabled={!row.courseId}
            onSelect={(id) => onChange({ topicId: id })}
            canCreate={false}
          />
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Credits taken</label>
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
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
          <select value={row.courseType} onChange={(e) => onChange({ courseType: e.target.value })} className={fieldCls}>
            <option value="lecture">Lecture</option><option value="lab">Lab</option><option value="seminar">Seminar</option>
            <option value="internship">Internship</option><option value="research">Research</option><option value="military">Military training</option>
            <option value="life_experience">Life / work experience</option><option value="other">Other</option>
          </select>
        </div>
        <div className="flex items-end justify-end">
          <button type="button" onClick={onRemove} disabled={!removable} className="pb-2 text-sm text-gray-400 hover:text-red-500 disabled:opacity-30">Remove</button>
        </div>
      </div>
      {(row.gradingBasis !== 'graded' || ['internship', 'research', 'military', 'life_experience'].includes(row.courseType)) && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          {row.gradingBasis !== 'graded'
            ? 'BU does not normally accept Pass/Fail credit (exceptions: Spring 2020, or when your college required P/F). A reviewer will check it.'
            : 'BU does not award transfer credit for internships, research, military or life experience.'}
        </p>
      )}
    </div>
  );
}
