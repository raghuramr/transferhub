import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { institutionsApi, universitiesApi } from '../../lib/api';
import { School, Plus, X, Upload, Power } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';

interface Institution {
  id: number;
  universityId: number;
  universityCode: string;
  universityName: string;
  name: string;
  code: string | null;
  isActive: boolean;
}

interface University {
  id: number;
  code: string;
  name: string;
}

const emptyForm = { universityId: '', name: '', code: '' };

function downloadBlob(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InstitutionsManagement() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Institution | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ['institutions'],
    queryFn: () => institutionsApi.list(),
  });
  const institutions: Institution[] = (data?.data as any) ?? [];

  const { data: universitiesData } = useQuery({
    queryKey: ['universities'],
    queryFn: () => universitiesApi.list({ isActive: true }),
  });
  const universities: University[] = (universitiesData?.data as any) ?? [];

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, universityId: Number(form.universityId) };
      return editing ? institutionsApi.update(editing.id, payload) : institutionsApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['institutions'] });
      closeModal();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => institutionsApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['institutions'] }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => institutionsApi.import(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['institutions'] }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (i: Institution) => {
    setEditing(i);
    setForm({ universityId: String(i.universityId), name: i.name, code: i.code ?? '' });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
  };

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
    { key: 'universityCode', header: 'University' },
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
          <button onClick={() => openEdit(i)} className="text-xs text-blue-600 hover:underline">
            Edit
          </button>
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
            <Plus size={16} /> Add Institution
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
              <h2 className="font-semibold text-gray-900">{editing ? 'Edit Institution' : 'Add Institution'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">University</label>
                <select
                  value={form.universityId}
                  onChange={(e) => setForm((f) => ({ ...f, universityId: e.target.value }))}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. College of Arts & Sciences"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code (optional)</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={closeModal} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !form.universityId || !form.name}
                className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
              >
                {saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Institution'}
              </button>
            </div>
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
        onExport={() => handleExport()}
        emptyMessage="No institutions found."
      />
    </div>
  );
}
