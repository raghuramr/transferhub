import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agenciesApi } from '../../lib/api';
import { Handshake, Plus, Upload, Power } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';

interface Agency {
  id: number;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  country: string | null;
  isActive: boolean;
}

type AgencyForm = {
  name: string;
  contactEmail: string;
  contactPhone: string;
  country: string;
};

const emptyForm: AgencyForm = { name: '', contactEmail: '', contactPhone: '', country: '' };

const FIELDS: { name: keyof AgencyForm; label: string; type: string }[] = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'contactEmail', label: 'Contact Email', type: 'email' },
  { name: 'contactPhone', label: 'Contact Phone', type: 'text' },
  { name: 'country', label: 'Country', type: 'text' },
];

function downloadBlob(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AgencyEditForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: AgencyForm;
  onSave: (form: AgencyForm) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<AgencyForm>(initial);

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELDS.map(({ name, label, type }) => (
          <div key={name}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input
              type={type}
              value={form[name]}
              onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-4">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name}
          className="px-4 py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function AgenciesManagement() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addForm, setAddForm] = useState<AgencyForm>(emptyForm);
  const [autoExpandId, setAutoExpandId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agencies'],
    queryFn: () => agenciesApi.list(),
  });
  const agencies: Agency[] = (data?.data as any) ?? [];

  const saveMutation = useMutation({
    mutationFn: ({ id, form }: { id: number | null; form: AgencyForm }) =>
      id ? agenciesApi.update(id, form) : agenciesApi.create(form),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['agencies'] });
      const createdId = res?.data?.id;
      if (createdId != null) setAutoExpandId(createdId);
      setShowAddPanel(false);
      setAddForm(emptyForm);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => agenciesApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agencies'] }),
  });

  const bulkActivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => agenciesApi.update(id, { isActive: true }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agencies'] }),
  });

  const bulkDeactivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => agenciesApi.deactivate(id))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agencies'] }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => agenciesApi.import(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agencies'] }),
  });

  const handleExport = async () => {
    const res = await agenciesApi.export();
    downloadBlob(res.data, 'agencies.csv');
  };

  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = '';
  };

  const columns: DataTableColumn<Agency>[] = [
    { key: 'name', header: 'Name' },
    { key: 'contactEmail', header: 'Contact Email' },
    { key: 'contactPhone', header: 'Phone' },
    { key: 'country', header: 'Country' },
    {
      key: 'isActive',
      header: 'Status',
      render: (a) =>
        a.isActive ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">Inactive</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (a) => (
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          {a.isActive && (
            <button
              onClick={() => deactivateMutation.mutate(a.id)}
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
          <Handshake className="text-brand-800" size={24} />
          <h1 className="text-2xl font-bold text-gray-900">Agencies</h1>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Upload size={14} /> Import CSV
          </button>
          <button
            onClick={() => {
              setAddForm(emptyForm);
              setShowAddPanel((v) => !v);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
          >
            <Plus size={16} /> Add Agency
          </button>
        </div>
      </div>

      {importMutation.data && (
        <div className="mb-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
          Import complete — created {(importMutation.data.data as any).created}, updated{' '}
          {(importMutation.data.data as any).updated}
          {(importMutation.data.data as any).errors?.length > 0 &&
            ` (${(importMutation.data.data as any).errors.length} skipped)`}
        </div>
      )}

      {showAddPanel && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Add Agency</h2>
          <AgencyEditForm
            initial={addForm}
            saving={saveMutation.isPending}
            onSave={(form) => saveMutation.mutate({ id: null, form })}
            onCancel={() => setShowAddPanel(false)}
          />
        </div>
      )}

      <DataTable<Agency>
        columns={columns}
        rows={agencies}
        isLoading={isLoading}
        searchPlaceholder="Search agencies…"
        searchKeys={['name', 'contactEmail', 'country']}
        filters={[
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
            onClick: (selected) => bulkActivateMutation.mutate(selected.map((a) => a.id)),
          },
          {
            label: 'Deactivate',
            onClick: (selected) => bulkDeactivateMutation.mutate(selected.map((a) => a.id)),
            danger: true,
          },
        ]}
        onExport={() => handleExport()}
        emptyMessage="No agencies found."
        renderExpanded={(a) => (
          <AgencyEditForm
            initial={{
              name: a.name,
              contactEmail: a.contactEmail ?? '',
              contactPhone: a.contactPhone ?? '',
              country: a.country ?? '',
            }}
            saving={saveMutation.isPending}
            onSave={(form) => saveMutation.mutate({ id: a.id, form })}
            onCancel={() => {}}
          />
        )}
        autoExpandId={autoExpandId}
      />
    </div>
  );
}
