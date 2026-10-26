import { useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { coursesApi, universitiesApi, programSharingApi, courseTopicsApi } from '../../lib/api';
import { BookOpen, ListTree, Trash2, Pencil, Plus } from 'lucide-react';
import { CourseTopicsEditor } from '../ui/CourseTopicsEditor';
import { usePermissions } from '../../hooks/usePermissions';
import type { CourseTopic } from '../../types';

export interface Program {
  id: number;
  institutionId: number;
  institutionCode: string | null;
  institutionName: string | null;
  area: string | null;
  name: string;
  degree: string | null;
  school: string | null;
  keyRules: string | null;
  source: string | null;
  matchStrength: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface University {
  id: number;
  code: string;
  name: string;
}

export type ProgramForm = {
  institutionId: string;
  name: string;
  area: string;
  degree: string;
  school: string;
  notes: string;
};

export const emptyForm: ProgramForm = { institutionId: '', name: '', area: '', degree: '', school: '', notes: '' };

export function ProgramFields({
  form,
  onChange,
  universities,
}: {
  form: ProgramForm;
  onChange: (next: ProgramForm) => void;
  universities: University[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">University</label>
        <select
          value={form.institutionId}
          onChange={(e) => onChange({ ...form, institutionId: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Select a university…</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.code})
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="e.g. BA in Computer Science"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Area (optional)</label>
          <input
            value={form.area}
            onChange={(e) => onChange({ ...form, area: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="e.g. Computer Science"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Degree (optional)</label>
          <input
            value={form.degree}
            onChange={(e) => onChange({ ...form, degree: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="e.g. BA"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">School (optional)</label>
          <input
            value={form.school}
            onChange={(e) => onChange({ ...form, school: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
        <textarea
          value={form.notes}
          onChange={(e) => onChange({ ...form, notes: e.target.value })}
          rows={3}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
    </div>
  );
}

export function programToForm(program: Program): ProgramForm {
  return {
    institutionId: String(program.institutionId),
    name: program.name,
    area: program.area ?? '',
    degree: program.degree ?? '',
    school: program.school ?? '',
    notes: program.notes ?? '',
  };
}

export function ProgramEditForm({
  program,
  universities,
  onSave,
  isSaving,
}: {
  program: Program;
  universities: University[];
  onSave: (form: ProgramForm) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<ProgramForm>(() => programToForm(program));

  return (
    <div className="p-5 bg-gray-50 border-t border-gray-200">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <ProgramFields form={form} onChange={setForm} universities={universities} />
          <div className="flex gap-3 mt-5">
            <button
              onClick={() => setForm(programToForm(program))}
              className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 bg-white"
            >
              Reset
            </button>
            <button
              onClick={() => onSave(form)}
              disabled={isSaving || !form.name || !form.institutionId}
              className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              {isSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        <div>
          <ProgramUniversitiesList program={program} allUniversities={universities} />
          <ProgramCoursesList program={program} />
        </div>
      </div>
      <p className="mt-4 text-xs text-gray-400">Click the row again to collapse.</p>
    </div>
  );
}

interface ProgramUniversityRow {
  institutionId: number;
  code: string;
  name: string;
}

interface UniversityDetail {
  id: number;
  code: string;
  name: string;
  calendar: string;
  type: string;
}

/** Edit a University's own fields without leaving the Program screen. */
function UniversityQuickEdit({ universityId }: { universityId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['university', universityId],
    queryFn: () => universitiesApi.get(universityId),
  });
  const uni = data?.data as UniversityDetail | undefined;
  const [form, setForm] = useState<{ code: string; name: string; calendar: string; type: string } | null>(null);
  const current = form ?? (uni ? { code: uni.code, name: uni.name, calendar: uni.calendar, type: uni.type } : null);

  const saveMutation = useMutation({
    mutationFn: () => universitiesApi.update(universityId, current),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['universities'] });
      qc.invalidateQueries({ queryKey: ['university', universityId] });
      qc.invalidateQueries({ queryKey: ['program-universities'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
      setForm(null);
    },
  });

  if (!current) return <p className="text-xs text-gray-400 mt-2">Loading…</p>;
  const input = 'w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500';
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <input className={input} value={current.code} onChange={(e) => setForm({ ...current, code: e.target.value })} placeholder="Code" />
      <input className={input} value={current.name} onChange={(e) => setForm({ ...current, name: e.target.value })} placeholder="Name" />
      <select className={input} value={current.calendar} onChange={(e) => setForm({ ...current, calendar: e.target.value })}>
        <option value="semester">Semester</option>
        <option value="quarter">Quarter</option>
        <option value="trimester">Trimester</option>
      </select>
      <input className={input} value={current.type} onChange={(e) => setForm({ ...current, type: e.target.value })} placeholder="Type" />
      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || !form || !current.code || !current.name}
        className="col-span-2 py-1.5 bg-brand-800 text-white rounded-lg text-xs font-medium hover:bg-brand-900 disabled:bg-brand-400"
      >
        {saveMutation.isPending ? 'Saving…' : 'Save university'}
      </button>
      {saveMutation.isError && <p className="col-span-2 text-xs text-red-600">Could not save.</p>}
    </div>
  );
}

/**
 * Universities a Program is offered at (migration 011: ProgramUniversities).
 * The owning University (program.institutionId) always appears here too
 * (backfilled server-side) and can't be removed from this list — only
 * changed by editing the Program's own "University" field.
 */
function ProgramUniversitiesList({
  program,
  allUniversities,
}: {
  program: Program;
  allUniversities: University[];
}) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const [assignId, setAssignId] = useState('');
  const [editingUniId, setEditingUniId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['program-universities', program.id],
    queryFn: () => programSharingApi.listUniversities(program.id),
  });
  const universities: ProgramUniversityRow[] = (data?.data as ProgramUniversityRow[]) ?? [];
  const assignedIds = new Set(universities.map((u) => u.institutionId));
  const assignable = allUniversities.filter((u) => !assignedIds.has(u.id));

  const invalidate = () => qc.invalidateQueries({ queryKey: ['program-universities', program.id] });

  const addMutation = useMutation({
    mutationFn: (institutionId: number) => programSharingApi.addUniversity(program.id, institutionId),
    onSuccess: () => {
      setAssignId('');
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (institutionId: number) => programSharingApi.removeUniversity(program.id, institutionId),
    onSuccess: invalidate,
  });

  return (
    <div className="pl-4 border-l-2 border-brand-200">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Universities offering this program</h3>
      {isLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {universities.map((u) => (
            <li
              key={u.institutionId}
              className="text-sm bg-white border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <div className="flex items-center justify-between">
              <span className="text-gray-800">
                {u.name} <span className="text-gray-400">({u.code})</span>
                {u.institutionId === program.institutionId && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-brand-100 text-brand-800">Owner</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {can('universities', 'edit') && (
                  <button
                    onClick={() => setEditingUniId(editingUniId === u.institutionId ? null : u.institutionId)}
                    className="text-gray-400 hover:text-brand-700"
                    title="Edit university"
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {u.institutionId !== program.institutionId && can('programs', 'edit') && (
                  <button
                    onClick={() => removeMutation.mutate(u.institutionId)}
                    disabled={removeMutation.isPending}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </span>
              </div>
              {editingUniId === u.institutionId && <UniversityQuickEdit universityId={u.institutionId} />}
            </li>
          ))}
        </ul>
      )}

      {can('programs', 'edit') && assignable.length > 0 && (
        <div className="flex gap-2">
          <select
            value={assignId}
            onChange={(e) => setAssignId(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Assign another university…</option>
            {assignable.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
            ))}
          </select>
          <button
            onClick={() => assignId && addMutation.mutate(Number(assignId))}
            disabled={addMutation.isPending || !assignId}
            className="px-3 py-1.5 border border-brand-300 text-brand-800 rounded-lg text-xs font-medium hover:bg-brand-50 disabled:opacity-50"
          >
            {addMutation.isPending ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      )}
    </div>
  );
}

interface ProgramCourseRow {
  id: number;
  code: string;
  title: string;
  institutionCode: string;
}

/**
 * Topics for one Course, shown as a matrix with one active/inactive
 * checkbox column per University the Program is offered at (migration 011:
 * UniversityTopicStatus) — "pull the topics, set active/inactive respective
 * to the university".
 */
function CourseTopicsUniversityMatrix({
  courseId,
  universities,
}: {
  courseId: number;
  universities: ProgramUniversityRow[];
}) {
  const qc = useQueryClient();
  const { can } = usePermissions();

  const results = useQueries({
    queries: universities.map((u) => ({
      queryKey: ['course-topics', courseId, u.institutionId],
      queryFn: () => courseTopicsApi.list(courseId, u.institutionId),
    })),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ topicId, institutionId, isActive }: { topicId: number; institutionId: number; isActive: boolean }) =>
      courseTopicsApi.setUniversityStatus(topicId, institutionId, isActive),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['course-topics', courseId, vars.institutionId] });
    },
  });

  if (results.some((r) => r.isLoading)) {
    return <p className="text-xs text-gray-400 pl-4">Loading topics…</p>;
  }

  // Union of topics across every university's response (same underlying
  // CourseTopics rows — each response just carries that university's
  // isActiveForUniversity override alongside them).
  const topicsById = new Map<number, CourseTopic>();
  results.forEach((r) => {
    const topics = (r.data?.data as CourseTopic[]) ?? [];
    topics.forEach((t) => topicsById.set(t.id, t));
  });
  const topics = Array.from(topicsById.values()).sort((a, b) => a.title.localeCompare(b.title));

  if (topics.length === 0) {
    return <p className="text-xs text-gray-400 pl-4">No topics on this course yet.</p>;
  }

  return (
    <div className="pl-4 mt-2 overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left font-semibold text-gray-500 pr-4 pb-1">Topic</th>
            {universities.map((u) => (
              <th key={u.institutionId} className="text-center font-semibold text-gray-500 px-3 pb-1">{u.code}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topics.map((t) => (
            <tr key={t.id} className="border-t border-gray-100">
              <td className="pr-4 py-1 text-gray-800">{t.title}</td>
              {universities.map((u, i) => {
                const topicForUni = (results[i].data?.data as CourseTopic[] | undefined)?.find((x) => x.id === t.id);
                const isActive = topicForUni?.isActiveForUniversity ?? true;
                return (
                  <td key={u.institutionId} className="text-center px-3 py-1">
                    <input
                      type="checkbox"
                      checked={isActive}
                      disabled={!can('course_topics', 'edit') || toggleMutation.isPending}
                      onChange={(e) =>
                        toggleMutation.mutate({ topicId: t.id, institutionId: u.institutionId, isActive: e.target.checked })
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Edit a Course's own fields from the Program screen. */
function CourseQuickEdit({ courseId, onSaved }: { courseId: number; onSaved: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => coursesApi.get(courseId),
  });
  const course = data?.data as { code: string; title: string; credits: number; description?: string | null } | undefined;
  const [form, setForm] = useState<{ code: string; title: string; credits: string; description: string } | null>(null);
  const current =
    form ??
    (course
      ? { code: course.code, title: course.title, credits: String(course.credits), description: course.description ?? '' }
      : null);

  const saveMutation = useMutation({
    mutationFn: () =>
      coursesApi.update(courseId, {
        code: current!.code.trim(),
        title: current!.title.trim(),
        credits: Number(current!.credits),
        description: current!.description,
      }),
    onSuccess: () => {
      setForm(null);
      qc.invalidateQueries({ queryKey: ['course', courseId] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: ['courses-by-institution'] });
      onSaved();
    },
  });

  if (!current) return <p className="text-xs text-gray-400">Loading course…</p>;
  const input = 'px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500';
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-600 mb-1">Course details</h4>
      <div className="flex flex-wrap gap-2">
        <input className={`${input} w-24`} value={current.code} onChange={(e) => setForm({ ...current, code: e.target.value })} />
        <input className={`${input} flex-1 min-w-[160px]`} value={current.title} onChange={(e) => setForm({ ...current, title: e.target.value })} />
        <input className={`${input} w-20`} type="number" value={current.credits} onChange={(e) => setForm({ ...current, credits: e.target.value })} />
        <textarea
          className={`${input} w-full`}
          rows={2}
          placeholder="Description"
          value={current.description}
          onChange={(e) => setForm({ ...current, description: e.target.value })}
        />
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !form || !current.code.trim() || !current.title.trim()}
          className="px-3 py-1.5 bg-brand-800 text-white rounded-lg text-xs font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save course'}
        </button>
        {saveMutation.isError && <span className="text-xs text-red-600">Could not save.</span>}
      </div>
    </div>
  );
}

/**
 * Courses a Program pulls in (migration 011: ProgramCourses, many-to-many
 * — a Course may belong to more than one Program). Attaching a course
 * picks from one of the Program's assigned Universities' own catalogs.
 */
function ProgramCoursesList({ program }: { program: Program }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const [expandedCourseId, setExpandedCourseId] = useState<number | null>(null);
  const [attachInstitutionId, setAttachInstitutionId] = useState(String(program.institutionId));
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [newCourse, setNewCourse] = useState({ code: '', title: '', credits: '4' });
  const [attachCourseId, setAttachCourseId] = useState('');

  const { data: universitiesData } = useQuery({
    queryKey: ['program-universities', program.id],
    queryFn: () => programSharingApi.listUniversities(program.id),
  });
  const universities: ProgramUniversityRow[] = (universitiesData?.data as ProgramUniversityRow[]) ?? [];

  // Courses may come from ANY university's catalogue, not only the ones the
  // Program is offered at (a brand-new Program only has its owner, which
  // may have no courses yet — that left the picker empty).
  const { data: allUniversitiesData } = useQuery({
    queryKey: ['universities'],
    queryFn: () => universitiesApi.list({ isActive: true }),
  });
  const allUniversities: University[] = (allUniversitiesData?.data as University[]) ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['program-courses', program.id],
    queryFn: () => programSharingApi.listCourses(program.id),
  });
  const courses: ProgramCourseRow[] = (data?.data as ProgramCourseRow[]) ?? [];

  const { data: pickerCoursesData } = useQuery({
    queryKey: ['courses-by-institution', attachInstitutionId],
    queryFn: () => coursesApi.byInstitution(Number(attachInstitutionId)),
    enabled: !!attachInstitutionId,
  });
  const attachedIds = new Set(courses.map((c) => c.id));
  const pickerCourses: { id: number; code: string; title: string }[] = (
    (pickerCoursesData?.data as { id: number; code: string; title: string }[]) ?? []
  ).filter((c) => !attachedIds.has(c.id));

  const invalidate = () => qc.invalidateQueries({ queryKey: ['program-courses', program.id] });

  const attachMutation = useMutation({
    mutationFn: (courseId: number) => programSharingApi.addCourse(program.id, courseId),
    onSuccess: () => {
      setAttachCourseId('');
      invalidate();
    },
  });

  const createCourseMutation = useMutation({
    mutationFn: async () => {
      const created = await coursesApi.create({
        institutionId: Number(attachInstitutionId),
        code: newCourse.code.trim(),
        title: newCourse.title.trim(),
        credits: Number(newCourse.credits) || 0,
      });
      await programSharingApi.addCourse(program.id, (created.data as { id: number }).id);
    },
    onSuccess: () => {
      setNewCourse({ code: '', title: '', credits: '4' });
      setShowNewCourse(false);
      invalidate();
      qc.invalidateQueries({ queryKey: ['courses-by-institution'] });
    },
  });

  const detachMutation = useMutation({
    mutationFn: (courseId: number) => programSharingApi.removeCourse(program.id, courseId),
    onSuccess: invalidate,
  });

  return (
    <div className="pl-4 border-l-2 border-brand-200 mt-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Courses in this program</h3>
      {isLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="text-xs text-gray-400 mb-2">No courses attached yet.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {courses.map((c) => (
            <li key={c.id} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5">
              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => setExpandedCourseId(expandedCourseId === c.id ? null : c.id)}
                  className="flex items-center gap-1.5 text-left text-gray-800 hover:text-brand-800"
                >
                  <ListTree size={13} />
                  <span className="text-gray-400">{c.institutionCode}</span> {c.code} — {c.title}
                </button>
                {can('programs', 'edit') && (
                  <button
                    onClick={() => detachMutation.mutate(c.id)}
                    disabled={detachMutation.isPending}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                    title="Detach"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {expandedCourseId === c.id && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-4">
                  {can('courses', 'edit') && <CourseQuickEdit courseId={c.id} onSaved={invalidate} />}
                  <CourseTopicsEditor
                    courseId={c.id}
                    courseLabel={`${c.code} — ${c.title}`}
                    canEdit={can('course_topics', 'edit')}
                  />
                  {universities.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-600 mb-1">Active per university</h4>
                      <CourseTopicsUniversityMatrix courseId={c.id} universities={universities} />
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {can('programs', 'edit') && (
        <div className="flex flex-wrap gap-2">
          <select
            value={attachInstitutionId}
            onChange={(e) => {
              setAttachInstitutionId(e.target.value);
              setAttachCourseId('');
            }}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">From university…</option>
            {allUniversities.map((u) => (
              <option key={u.id} value={u.id}>{u.code}</option>
            ))}
          </select>
          <select
            value={attachCourseId}
            onChange={(e) => setAttachCourseId(e.target.value)}
            disabled={!attachInstitutionId}
            className="flex-1 min-w-[160px] px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          >
            <option value="">{pickerCourses.length ? 'Select a course…' : 'No courses available'}</option>
            {pickerCourses.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
            ))}
          </select>
          <button
            onClick={() => attachCourseId && attachMutation.mutate(Number(attachCourseId))}
            disabled={attachMutation.isPending || !attachCourseId}
            className="flex items-center gap-1 px-3 py-1.5 bg-brand-800 text-white rounded-lg text-xs font-medium hover:bg-brand-900 disabled:bg-brand-400"
          >
            <BookOpen size={12} /> Attach
          </button>
        </div>
      )}

      {can('courses', 'create') && (
        <div className="mt-3">
          <button
            onClick={() => setShowNewCourse((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline"
          >
            <Plus size={12} /> {showNewCourse ? 'Cancel new course' : 'Create a new course here'}
          </button>
          {showNewCourse && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={newCourse.code}
                onChange={(e) => setNewCourse({ ...newCourse, code: e.target.value })}
                placeholder="Code"
                className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
              />
              <input
                value={newCourse.title}
                onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })}
                placeholder="Title"
                className="flex-1 min-w-[140px] px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
              />
              <input
                type="number"
                value={newCourse.credits}
                onChange={(e) => setNewCourse({ ...newCourse, credits: e.target.value })}
                placeholder="Credits"
                className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
              />
              <button
                onClick={() => createCourseMutation.mutate()}
                disabled={createCourseMutation.isPending || !newCourse.code.trim() || !newCourse.title.trim() || !attachInstitutionId}
                className="px-3 py-1.5 bg-brand-800 text-white rounded-lg text-xs font-medium hover:bg-brand-900 disabled:bg-brand-400"
              >
                {createCourseMutation.isPending ? 'Creating…' : 'Create & attach'}
              </button>
              <p className="w-full text-[11px] text-gray-400">
                Created under the university selected in "From university" above.
              </p>
              {createCourseMutation.isError && <p className="w-full text-xs text-red-600">Could not create the course.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

