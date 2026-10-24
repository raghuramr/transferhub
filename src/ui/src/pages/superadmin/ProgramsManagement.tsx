import { useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { coursesApi, universitiesApi, programSharingApi, courseTopicsApi } from '../../lib/api';
import { GraduationCap, Plus, Power, BookOpen, ListTree, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { usePermissions } from '../../hooks/usePermissions';
import type { CourseTopic } from '../../types';

interface Program {
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

interface University {
  id: number;
  code: string;
  name: string;
}

type ProgramForm = {
  institutionId: string;
  name: string;
  area: string;
  degree: string;
  school: string;
  notes: string;
};

const emptyForm: ProgramForm = { institutionId: '', name: '', area: '', degree: '', school: '', notes: '' };

function ProgramFields({
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

function programToForm(program: Program): ProgramForm {
  return {
    institutionId: String(program.institutionId),
    name: program.name,
    area: program.area ?? '',
    degree: program.degree ?? '',
    school: program.school ?? '',
    notes: program.notes ?? '',
  };
}

function ProgramEditForm({
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
              className="flex items-center justify-between text-sm bg-white border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <span className="text-gray-800">
                {u.name} <span className="text-gray-400">({u.code})</span>
                {u.institutionId === program.institutionId && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-brand-100 text-brand-800">Owner</span>
                )}
              </span>
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

/**
 * Courses a Program pulls in (migration 011: ProgramCourses, many-to-many
 * — a Course may belong to more than one Program). Attaching a course
 * picks from one of the Program's assigned Universities' own catalogs.
 */
function ProgramCoursesList({ program }: { program: Program }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const [expandedCourseId, setExpandedCourseId] = useState<number | null>(null);
  const [attachInstitutionId, setAttachInstitutionId] = useState('');
  const [attachCourseId, setAttachCourseId] = useState('');

  const { data: universitiesData } = useQuery({
    queryKey: ['program-universities', program.id],
    queryFn: () => programSharingApi.listUniversities(program.id),
  });
  const universities: ProgramUniversityRow[] = (universitiesData?.data as ProgramUniversityRow[]) ?? [];

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
              {expandedCourseId === c.id && universities.length > 0 && (
                <CourseTopicsUniversityMatrix courseId={c.id} universities={universities} />
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
            {universities.map((u) => (
              <option key={u.institutionId} value={u.institutionId}>{u.code}</option>
            ))}
          </select>
          <select
            value={attachCourseId}
            onChange={(e) => setAttachCourseId(e.target.value)}
            disabled={!attachInstitutionId}
            className="flex-1 min-w-[160px] px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          >
            <option value="">Select a course…</option>
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
    </div>
  );
}

export default function ProgramsManagement() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createForm, setCreateForm] = useState<ProgramForm>(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ['programs', 'all'],
    queryFn: () => coursesApi.programs(undefined, true),
  });
  const programs: Program[] = (data?.data as Program[]) ?? [];

  const { data: universitiesData } = useQuery({
    queryKey: ['universities'],
    queryFn: () => universitiesApi.list({ isActive: true }),
  });
  const universities: University[] = (universitiesData?.data as University[]) ?? [];

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['programs'] });

  const createMutation = useMutation({
    mutationFn: (form: ProgramForm) =>
      coursesApi.createProgram({
        institutionId: Number(form.institutionId),
        name: form.name,
        area: form.area || undefined,
        degree: form.degree || undefined,
        school: form.school || undefined,
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      invalidateAll();
      setShowCreatePanel(false);
      setCreateForm(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: ProgramForm }) =>
      coursesApi.updateProgram(id, {
        institutionId: Number(form.institutionId),
        name: form.name,
        area: form.area || null,
        degree: form.degree || null,
        school: form.school || null,
        notes: form.notes || null,
      }),
    onSuccess: invalidateAll,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => coursesApi.deactivateProgram(id),
    onSuccess: invalidateAll,
  });

  const bulkDeactivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => coursesApi.deactivateProgram(id))),
    onSuccess: invalidateAll,
  });

  const columns: DataTableColumn<Program>[] = [
    {
      key: 'institutionCode',
      header: 'University',
      render: (p) => p.institutionCode ?? <span className="text-gray-400 italic">—</span>,
    },
    { key: 'name', header: 'Name' },
    { key: 'area', header: 'Area', render: (p) => p.area ?? '—' },
    { key: 'degree', header: 'Degree', render: (p) => p.degree ?? '—' },
    {
      key: 'isActive',
      header: 'Status',
      render: (p) =>
        p.isActive ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">Inactive</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (p) => (
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Click row to edit</span>
          {p.isActive && can('programs', 'delete') && (
            <button
              onClick={() => deactivateMutation.mutate(p.id)}
              className="flex items-center gap-1 text-xs text-red-500 hover:underline"
            >
              <Power size={12} /> Deactivate
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-6 w-[95%] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <GraduationCap className="text-brand-800" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Programs</h1>
            <p className="text-sm text-gray-500">Degree programs offered by each university</p>
          </div>
        </div>
        {can('programs', 'create') && (
          <button
            onClick={() => setShowCreatePanel((s) => !s)}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
          >
            <Plus size={16} /> Add Program
          </button>
        )}
      </div>

      {showCreatePanel && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 max-w-xl">
          <h2 className="font-semibold text-gray-900 mb-4">Add Program</h2>
          <ProgramFields form={createForm} onChange={setCreateForm} universities={universities} />
          <div className="flex gap-3 mt-5">
            <button
              onClick={() => {
                setShowCreatePanel(false);
                setCreateForm(emptyForm);
              }}
              className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate(createForm)}
              disabled={createMutation.isPending || !createForm.name || !createForm.institutionId}
              className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              {createMutation.isPending ? 'Saving…' : 'Create Program'}
            </button>
          </div>
        </div>
      )}

      <DataTable<Program>
        columns={columns}
        rows={programs}
        isLoading={isLoading}
        searchPlaceholder="Search programs…"
        searchKeys={['name', 'area', 'degree', 'institutionCode', 'institutionName']}
        filters={[
          {
            key: 'institutionCode',
            label: 'University',
            options: universities.map((u) => ({ value: u.code, label: u.code })),
          },
          {
            key: 'isActive',
            label: 'Status',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ],
          },
        ]}
        bulkActions={[
          ...(can('programs', 'delete')
            ? [{ label: 'Deactivate', onClick: (selected: Program[]) => bulkDeactivateMutation.mutate(selected.map((p) => p.id)), danger: true }]
            : []),
        ]}
        showExport={false}
        emptyMessage="No programs found."
        renderExpanded={(p) => (
          <ProgramEditForm
            program={p}
            universities={universities}
            isSaving={updateMutation.isPending && updateMutation.variables?.id === p.id}
            onSave={(form) => updateMutation.mutate({ id: p.id, form })}
          />
        )}
      />
    </div>
  );
}
