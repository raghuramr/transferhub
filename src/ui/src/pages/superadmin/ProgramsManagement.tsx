import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { coursesApi, universitiesApi } from '../../lib/api';
import { GraduationCap, Plus, Power, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../store/auth';
import { PermanentDeleteDialog } from '../../components/shared/PermanentDeleteDialog';
import {
  ProgramFields,
  ProgramEditForm,
  emptyForm,
  type Program,
  type University,
  type ProgramForm,
} from '../../components/programs/ProgramEditor';

export default function ProgramsManagement() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const isSuperAdmin = useAuthStore((s) => s.user?.role) === 'super_admin';
  const [purgeQueue, setPurgeQueue] = useState<Program[]>([]);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createForm, setCreateForm] = useState<ProgramForm>(emptyForm);
  const [justCreatedId, setJustCreatedId] = useState<number | null>(null);

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
        isActive: form.isActive,
      }),
    onSuccess: (res) => {
      invalidateAll();
      // Open the new row so courses/universities can be attached straight away.
      setJustCreatedId((res.data as { id: number }).id);
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
        isActive: form.isActive,
      }),
    onSuccess: invalidateAll,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => coursesApi.deactivateProgram(id),
    onSuccess: invalidateAll,
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => coursesApi.updateProgram(id, { isActive: true }),
    onSuccess: invalidateAll,
  });

  const bulkActivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => coursesApi.updateProgram(id, { isActive: true }))),
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
          {!p.isActive && can('programs', 'edit') && (
            <button
              onClick={() => activateMutation.mutate(p.id)}
              className="flex items-center gap-1 text-xs text-green-600 hover:underline"
            >
              <Power size={12} /> Activate
            </button>
          )}
          {isSuperAdmin && (
            <button
              onClick={() => setPurgeQueue([p])}
              className="flex items-center gap-1 text-xs text-red-700 hover:underline"
            >
              <Trash2 size={12} /> Delete permanently
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
          <h2 className="font-semibold text-gray-900 mb-1">Add Program</h2>
          <p className="text-xs text-gray-500 mb-4">After you create it, the program opens so you can attach courses and extra universities.</p>
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

      {isSuperAdmin && purgeQueue.length > 0 && (
        <PermanentDeleteDialog
          key={purgeQueue[0].id}
          entity="programs"
          id={purgeQueue[0].id}
          fallbackLabel={`${purgeQueue[0].name}${purgeQueue.length > 1 ? ` (1 of ${purgeQueue.length})` : ''}`}
          onClose={() => setPurgeQueue([])}
          onDeleted={() => {
            setPurgeQueue((q) => q.slice(1));
            qc.invalidateQueries({ queryKey: ['programs'] });
            qc.invalidateQueries({ queryKey: ['courses'] });
          }}
        />
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
          ...(can('programs', 'edit')
            ? [{ label: 'Activate', onClick: (selected: Program[]) => bulkActivateMutation.mutate(selected.map((p) => p.id)) }]
            : []),
          ...(can('programs', 'delete')
            ? [{ label: 'Deactivate', onClick: (selected: Program[]) => bulkDeactivateMutation.mutate(selected.map((p) => p.id)), danger: true }]
            : []),
          ...(isSuperAdmin
            ? [{ label: 'Delete permanently', onClick: (selected: Program[]) => setPurgeQueue(selected), danger: true }]
            : []),
        ]}
        showExport={false}
        autoExpandId={justCreatedId}
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
