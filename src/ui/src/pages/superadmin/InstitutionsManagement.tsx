import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { institutionsApi, universitiesApi } from '../../lib/api';
import { School, Plus, Upload, Power } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { ImageSourceField } from '../../components/shared/ImageSourceField';

interface Institution {
  id: number;
  universityId: number | null;
  universityCode: string | null;
  universityName: string | null;
  name: string;
  code: string | null;
  isActive: boolean;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
}

interface University {
  id: number;
  code: string;
  name: string;
}

type InstitutionForm = {
  universityId: string;
  name: string;
  code: string;
  logoUrl: string;
  heroImageUrl: string;
};

const emptyForm: InstitutionForm = { universityId: '', name: '', code: '', logoUrl: '', heroImageUrl: '' };

interface ImportResult {
  created: number;
  updated: number;
  errors?: unknown[];
}

function downloadBlob(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function InstitutionFields({
  form,
  onChange,
  universities,
}: {
  form: InstitutionForm;
  onChange: (next: InstitutionForm) => void;
  universities: University[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">University</label>
        <select
          value={form.universityId}
          onChange={(e) => onChange({ ...form, universityId: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">— Unmapped —</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.code})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="e.g. College of Arts & Sciences"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Code (optional)</label>
        <input
          value={form.code}
          onChange={(e) => onChange({ ...form, code: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <ImageSourceField
        label="Logo"
        value={form.logoUrl}
        onChange={(url) => onChange({ ...form, logoUrl: url })}
        entityType="institution_logo"
      />
      <ImageSourceField
        label="Hero image"
        value={form.heroImageUrl}
        onChange={(url) => onChange({ ...form, heroImageUrl: url })}
        entityType="institution_hero"
      />
    </div>
  );
}

function institutionToForm(institution: Institution): InstitutionForm {
  return {
    universityId: institution.universityId != null ? String(institution.universityId) : '',
    name: institution.name,
    code: institution.code ?? '',
    logoUrl: institution.logoUrl ?? '',
    heroImageUrl: institution.heroImageUrl ?? '',
  };
}

function InstitutionEditForm({
  institution,
  universities,
  onSave,
  isSaving,
}: {
  institution: Institution;
  universities: University[];
  onSave: (form: InstitutionForm) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<InstitutionForm>(() => institutionToForm(institution));

  return (
    <div className="p-5 bg-gray-50 border-t border-gray-200 max-w-md">
      <InstitutionFields form={form} onChange={setForm} universities={universities} />
      <div className="flex gap-3 mt-5">
        <button
          onClick={() => setForm(institutionToForm(institution))}
          className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 bg-white"
        >
          Reset
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={isSaving || !form.name}
          className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          {isSaving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">Click the row again to collapse.</p>
    </div>
  );
}

export default function InstitutionsManagement() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createForm, setCreateForm] = useState<InstitutionForm>(emptyForm);
  const [unmappedOnly, setUnmappedOnly] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['institutions', { unmapped: unmappedOnly }],
    queryFn: () => institutionsApi.list(unmappedOnly ? { unmapped: true } : undefined),
  });
  const institutions: Institution[] = (data?.data as Institution[]) ?? [];

  const { data: universitiesData } = useQuery({
    queryKey: ['universities'],
    queryFn: () => universitiesApi.list({ isActive: true }),
  });
  const universities: University[] = (universitiesData?.data as University[]) ?? [];

  const createMutation = useMutation({
    mutationFn: (form: InstitutionForm) =>
      institutionsApi.create({ ...form, universityId: form.universityId ? Number(form.universityId) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['institutions'] });
      setShowCreatePanel(false);
      setCreateForm(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: InstitutionForm }) =>
      institutionsApi.update(id, { ...form, universityId: form.universityId ? Number(form.universityId) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['institutions'] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => institutionsApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['institutions'] }),
  });

  const bulkActivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => institutionsApi.update(id, { isActive: true }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['institutions'] }),
  });

  const bulkDeactivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => institutionsApi.deactivate(id))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['institutions'] }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => institutionsApi.import(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['institutions'] }),
  });

  const handleExport = async () => {
    const res = await institutionsApi.export();
    downloadBlob(res.data, 'institutions.csv');
  };

  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = '';
  };

  const columns: DataTableColumn<Institution>[] = [
    {
      key: 'universityCode',
      header: 'University',
      render: (i) =>
        i.universityCode ? (
          <span>{i.universityCode}</span>
        ) : (
          <span className="text-gray-400 italic">— Unmapped —</span>
        ),
    },
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    {
      key: 'isActive',
      header: 'Status',
      render: (i) =>
        i.isActive ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">Inactive</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (i) => (
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Click row to edit</span>
          {i.isActive && (
            <button
              onClick={() => deactivateMutation.mutate(i.id)}
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
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <School className="text-brand-800" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Institutions</h1>
            <p className="text-sm text-gray-500">Schools &amp; colleges within each university</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 px-2">
            <input
              type="checkbox"
              checked={unmappedOnly}
              onChange={(e) => setUnmappedOnly(e.target.checked)}
            />
            Unmapped only
          </label>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Upload size={14} /> Import CSV
          </button>
          <button
            onClick={() => setShowCreatePanel((s) => !s)}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
          >
            <Plus size={16} /> Add Institution
          </button>
        </div>
      </div>

      {importMutation.data && (() => {
        const result = importMutation.data.data as ImportResult;
        return (
          <div className="mb-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
            Import complete — created {result.created}, updated{' '}
            {result.updated}
            {(result.errors?.length ?? 0) > 0 &&
              ` (${result.errors!.length} skipped)`}
          </div>
        );
      })()}

      {showCreatePanel && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 max-w-md">
          <h2 className="font-semibold text-gray-900 mb-4">Add Institution</h2>
          <InstitutionFields form={createForm} onChange={setCreateForm} universities={universities} />
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
              disabled={createMutation.isPending || !createForm.name}
              className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              {createMutation.isPending ? 'Saving…' : 'Create Institution'}
            </button>
          </div>
        </div>
      )}

      <DataTable<Institution>
        columns={columns}
        rows={institutions}
        isLoading={isLoading}
        searchPlaceholder="Search institutions…"
        searchKeys={['code', 'name', 'universityCode', 'universityName']}
        filters={[
          {
            key: 'universityCode',
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
          {
            label: 'Activate',
            onClick: (selected) => bulkActivateMutation.mutate(selected.map((i) => i.id)),
          },
          {
            label: 'Deactivate',
            onClick: (selected) => bulkDeactivateMutation.mutate(selected.map((i) => i.id)),
            danger: true,
          },
        ]}
        onExport={() => handleExport()}
        emptyMessage="No institutions found."
        renderExpanded={(i) => (
          <InstitutionEditForm
            institution={i}
            universities={universities}
            isSaving={updateMutation.isPending && updateMutation.variables?.id === i.id}
            onSave={(form) => updateMutation.mutate({ id: i.id, form })}
          />
        )}
      />
    </div>
  );
}
