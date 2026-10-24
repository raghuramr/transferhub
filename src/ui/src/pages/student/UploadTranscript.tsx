import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { transcriptsApi } from '../../lib/api';
import { Upload, Info } from 'lucide-react';
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
  term: string;
};

type ValidCourseRow = CourseRow & { course: RawExternalCourse };

const EMPTY_COURSE: CourseRow = { courseId: null, topicId: null, credits: '', grade: '', term: '' };

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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { calendar: 'semester' } });

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
        courses: validCourses.map((c) => ({
          courseCode: c.course.code,
          courseTitle: c.course.title,
          originalCredits: parseFloat(c.credits) || c.course.credits || 3,
          grade: c.grade || 'B',
          term: c.term,
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
              <option value="quarter">Quarter (credits ÷ 1.5)</option>
              <option value="trimester">Trimester</option>
            </select>
          </div>

          <div className="mt-3 flex items-start gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
            <Info size={16} className="shrink-0 mt-0.5" />
            Quarter-system credits are automatically converted to semester credits (÷ 1.5, rounded to nearest 0.5).
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Credits taken</label>
          <input
            value={row.credits}
            onChange={(e) => onChange({ credits: e.target.value })}
            placeholder="4"
            type="number"
            step="0.5"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Grade</label>
          <input
            value={row.grade}
            onChange={(e) => onChange({ grade: e.target.value })}
            placeholder="A"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Term</label>
            <input
              value={row.term}
              onChange={(e) => onChange({ term: e.target.value })}
              placeholder="F23"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={!removable}
            className="text-gray-400 hover:text-red-500 disabled:opacity-30 pb-2"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
