import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { coursesApi, universitiesApi } from '../../lib/api';
import { GraduationCap, Plus, Power } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { usePermissions } from '../../hooks/usePermissions';

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
    <div className="p-5 bg-gray-50 border-t border-gray-200 max-w-xl">
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
      <p className="mt-2 text-xs text-gray-400">Click the row again to collapse.</p>
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
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
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
