import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { universitiesApi } from '../../lib/api';
import { Building2, Plus, X, Upload, Power } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';

interface University {
  id: number;
  code: string;
  name: string;
  calendar: string;
  type: string;
  isBU: boolean;
  isActive: boolean;
  source: string | null;
}

const emptyForm = { code: '', name: '', calendar: 'semester', type: 'university', isBU: false, source: '' };

function downloadBlob(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function UniversitiesManagement() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<University | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ['universities'],
    queryFn: () => universitiesApi.list(),
  });
  const universities: University[] = (data?.data as any) ?? [];

  const saveMutation = useMutation({
    mutationFn: () =>
      editing ? universitiesApi.update(editing.id, form) : universitiesApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['universities'] });
      closeModal();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => universitiesApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['universities'] }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => universitiesApi.import(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['universities'] }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (u: University) => {
    setEditing(u);
    setForm({ code: u.code, name: u.name, calendar: u.calendar, type: u.type, isBU: u.isBU, source: u.source ?? '' });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleExport = async () => {
    const res = await universitiesApi.export();
    downloadBlob(res.data, 'universities.csv');
  };

  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = '';
  };

  const columns: DataTableColumn<University>[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    { key: 'calendar', header: 'Calendar' },
    { key: 'type', header: 'Type' },
    {
      key: 'isBU',
      header: 'BU?',
      render: (u) => (u.isBU ? <span className="text-brand-700 font-medium">Yes</span> : '—'),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (u) =>
        u.isActive ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">Inactive</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (u) => (
        <div className="flex items-center gap-3">
          <button onClick={() => openEdit(u)} className="text-xs text-blue-600 hover:underline">
            Edit
          </button>
          {u.isActive && (
            <button
              onClick={() => deactivateMutation.mutate(u.id)}
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
          <Building2 className="text-brand-800" size={24} />
          <h1 className="text-2xl font-bold text-gray-900">Universities</h1>
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
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
          >
            <Plus size={16} /> Add University
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

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">{editing ? 'Edit University' : 'Add University'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. BU"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. Boston University"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Calendar</label>
                  <select
                    value={form.calendar}
                    onChange={(e) => setForm((f) => ({ ...f, calendar: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="semester">Semester</option>
                    <option value="quarter">Quarter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="university">University</option>
                    <option value="community_college">Community College</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catalog Source URL</label>
                <input
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="https://…"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.isBU}
                  onChange={(e) => setForm((f) => ({ ...f, isBU: e.target.checked }))}
                />
                This is the receiving institution (BU)
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={closeModal} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !form.code || !form.name}
                className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
              >
                {saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create University'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DataTable<University>
        columns={columns}
        rows={universities}
        isLoading={isLoading}
        searchPlaceholder="Search universities…"
        searchKeys={['code', 'name']}
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
        onExport={() => handleExport()}
        emptyMessage="No universities found."
      />
    </div>
  );
}
