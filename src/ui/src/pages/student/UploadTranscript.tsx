import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { transcriptsApi } from '../../lib/api';
import { Upload, Info } from 'lucide-react';

const schema = z.object({
  institutionName: z.string().min(2, 'Enter the institution name'),
  institutionCode: z.string().min(1, 'Enter a code (e.g. NU, NYU)').max(10),
  calendar: z.enum(['semester', 'quarter', 'trimester']),
  studentName: z.string().optional(),
  studentId: z.string().optional(),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

type CourseRow = {
  code: string;
  title: string;
  credits: string;
  grade: string;
  term: string;
};

const EMPTY_COURSE: CourseRow = { code: '', title: '', credits: '', grade: '', term: '' };

export default function UploadTranscript() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseRow[]>([{ ...EMPTY_COURSE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const addCourse = () => setCourses((prev) => [...prev, { ...EMPTY_COURSE }]);
  const removeCourse = (i: number) =>
    setCourses((prev) => prev.filter((_, idx) => idx !== i));
  const updateCourse = (i: number, field: keyof CourseRow, value: string) =>
    setCourses((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));

  const onSubmit = async (data: FormData) => {
    const validCourses = courses.filter((c) => c.code && c.title);
    if (validCourses.length === 0) {
      setError('Add at least one course.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await transcriptsApi.submit({
        ...data,
        courses: validCourses.map((c) => ({
          courseCode: c.code,
          courseTitle: c.title,
          originalCredits: parseFloat(c.credits) || 3,
          grade: c.grade || 'B',
          term: c.term,
        })),
      });
      navigate(`/student/transcript/${(res.data as any).id}`);
    } catch {
      setError('Submission failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Submit Transcript</h1>
      <p className="text-gray-500 mb-8">Enter your transfer institution and course details.</p>

      {error && (
        <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Institution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Institution Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Institution Name *
              </label>
              <input
                {...register('institutionName')}
                placeholder="e.g. Northeastern University"
                className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${errors.institutionName ? 'border-red-400' : 'border-gray-300'}`}
              />
              {errors.institutionName && <p className="text-xs text-red-600 mt-1">{errors.institutionName.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Institution Code *
              </label>
              <input
                {...register('institutionCode')}
                placeholder="e.g. NU"
                className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${errors.institutionCode ? 'border-red-400' : 'border-gray-300'}`}
              />
              {errors.institutionCode && <p className="text-xs text-red-600 mt-1">{errors.institutionCode.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Calendar System *
              </label>
              <select
                {...register('calendar')}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="semester">Semester</option>
                <option value="quarter">Quarter (credits ÷ 1.5)</option>
                <option value="trimester">Trimester</option>
              </select>
            </div>
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
              className="text-sm text-brand-800 hover:text-brand-900 font-medium"
            >
              + Add course
            </button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-1">
              <div className="col-span-2">Course Code</div>
              <div className="col-span-4">Title</div>
              <div className="col-span-2">Credits</div>
              <div className="col-span-2">Grade</div>
              <div className="col-span-1">Term</div>
              <div className="col-span-1"></div>
            </div>

            {courses.map((course, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  value={course.code}
                  onChange={(e) => updateCourse(i, 'code', e.target.value)}
                  placeholder="CS3500"
                  className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <input
                  value={course.title}
                  onChange={(e) => updateCourse(i, 'title', e.target.value)}
                  placeholder="Object-Oriented Design"
                  className="col-span-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <input
                  value={course.credits}
                  onChange={(e) => updateCourse(i, 'credits', e.target.value)}
                  placeholder="4"
                  type="number"
                  step="0.5"
                  className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <input
                  value={course.grade}
                  onChange={(e) => updateCourse(i, 'grade', e.target.value)}
                  placeholder="A"
                  className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <input
                  value={course.term}
                  onChange={(e) => updateCourse(i, 'term', e.target.value)}
                  placeholder="F23"
                  className="col-span-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={() => removeCourse(i)}
                  disabled={courses.length === 1}
                  className="col-span-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/student')}
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
