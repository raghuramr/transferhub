import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { universitiesApi, institutionsApi, coursesApi } from '../../lib/api';
import { Building2, Plus, Upload, Power, Globe2, School, GraduationCap } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { ImageSourceField } from '../../components/shared/ImageSourceField';
import { usePermissions } from '../../hooks/usePermissions';

interface University {
  id: number;
  code: string;
  name: string;
  calendar: string;
  type: string;
  isBU: boolean;
  isActive: boolean;
  source: string | null;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
}

type UniversityForm = {
  code: string;
  name: string;
  calendar: string;
  type: string;
  isBU: boolean;
  source: string;
  logoUrl: string;
  heroImageUrl: string;
};

const emptyForm: UniversityForm = {
  code: '', name: '', calendar: 'semester', type: 'university', isBU: false, source: '',
  logoUrl: '', heroImageUrl: '',
};

function downloadBlob(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function UniversityFields({
  form,
  onChange,
}: {
  form: UniversityForm;
  onChange: (next: UniversityForm) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
        <input
          value={form.code}
          onChange={(e) => onChange({ ...form, code: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="e.g. BU"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="e.g. Boston University"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Calendar</label>
          <select
            value={form.calendar}
            onChange={(e) => onChange({ ...form, calendar: e.target.value })}
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
            onChange={(e) => onChange({ ...form, type: e.target.value })}
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
          onChange={(e) => onChange({ ...form, source: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="https://…"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form.isBU}
          onChange={(e) => onChange({ ...form, isBU: e.target.checked })}
        />
        This is the receiving institution (BU)
      </label>
      <ImageSourceField
        label="Logo"
        value={form.logoUrl}
        onChange={(url) => onChange({ ...form, logoUrl: url })}
        entityType="university_logo"
      />
      <ImageSourceField
        label="Hero image"
        value={form.heroImageUrl}
        onChange={(url) => onChange({ ...form, heroImageUrl: url })}
        entityType="university_hero"
      />
    </div>
  );
}

function universityToForm(university: University): UniversityForm {
  return {
    code: university.code,
    name: university.name,
    calendar: university.calendar,
    type: university.type,
    isBU: university.isBU,
    source: university.source ?? '',
    logoUrl: university.logoUrl ?? '',
    heroImageUrl: university.heroImageUrl ?? '',
  };
}

interface Institution {
  id: number;
  name: string;
  code: string | null;
  isActive: boolean;
}

/**
 * Nested "Institutions" (AcademicUnits) list shown inside a University's
 * expanded row, so the Universities > Institutions hierarchy is visible
 * in one place instead of requiring a trip to the separate Institutions
 * screen. See CLAUDE.md naming note: UI "Institutions" == AcademicUnits.
 */
function UniversityInstitutionsList({ universityId }: { universityId: number }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [assignId, setAssignId] = useState('');

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['institutions', { universityId }] });
    qc.invalidateQueries({ queryKey: ['institutions', { unmapped: true }] });
    qc.invalidateQueries({ queryKey: ['institutions'] });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['institutions', { universityId }],
    queryFn: () => institutionsApi.list({ universityId }),
  });
  const institutions: Institution[] = (data?.data as any) ?? [];

  // Existing institutions with no university yet, so an admin can assign
  // one here instead of only ever creating brand-new ones.
  const { data: unmappedData } = useQuery({
    queryKey: ['institutions', { unmapped: true }],
    queryFn: () => institutionsApi.list({ unmapped: true }),
  });
  const unmapped: Institution[] = (unmappedData?.data as any) ?? [];

  const addMutation = useMutation({
    mutationFn: (name: string) => institutionsApi.create({ universityId, name }),
    onSuccess: () => {
      setNewName('');
      invalidateAll();
    },
  });

  const assignMutation = useMutation({
    mutationFn: (id: number) => institutionsApi.update(id, { universityId }),
    onSuccess: () => {
      setAssignId('');
      invalidateAll();
    },
  });

  return (
    <div className="pl-4 border-l-2 border-brand-200">
      <div className="flex items-center gap-1.5 mb-2">
        <School size={14} className="text-brand-700" />
        <h3 className="text-sm font-semibold text-gray-700">Institutions</h3>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : institutions.length === 0 ? (
        <p className="text-xs text-gray-400 mb-2">No institutions under this university yet.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {institutions.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between text-sm bg-white border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <span className="text-gray-800">
                {i.name}
                {i.code && <span className="text-gray-400"> ({i.code})</span>}
              </span>
              {i.isActive ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700">Active</span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700">Inactive</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {unmapped.length > 0 && (
        <div className="flex gap-2 mb-2">
          <select
            value={assignId}
            onChange={(e) => setAssignId(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Assign an existing unmapped institution…</option>
            {unmapped.map((i) => (
              <option key={i.id} value={i.id}>{i.name}{i.code ? ` (${i.code})` : ''}</option>
            ))}
          </select>
          <button
            onClick={() => assignId && assignMutation.mutate(Number(assignId))}
            disabled={assignMutation.isPending || !assignId}
            className="px-3 py-1.5 border border-brand-300 text-brand-800 rounded-lg text-xs font-medium hover:bg-brand-50 disabled:opacity-50"
          >
            {assignMutation.isPending ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New institution name…"
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={() => newName.trim() && addMutation.mutate(newName.trim())}
          disabled={addMutation.isPending || !newName.trim()}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand-800 text-white rounded-lg text-xs font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          <Plus size={12} /> Add Institution
        </button>
      </div>
      {(addMutation.isError || assignMutation.isError) && (
        <p className="mt-1 text-xs text-red-600">Could not save. Please try again.</p>
      )}
    </div>
  );
}

interface Program {
  id: number;
  institutionId: number;
  area: string | null;
  name: string;
  degree: string | null;
  isActive: boolean;
}

/**
 * Programs belong directly to a University (SQL `Institutions` table) --
 * unlike Institutions (AcademicUnits), Programs have no "unmapped" state,
 * so this is a simpler create-only list (no assign-existing flow).
 */
function UniversityProgramsList({ universityId }: { universityId: number }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newArea, setNewArea] = useState('');

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['programs', { universityId }] });

  const { data, isLoading } = useQuery({
    queryKey: ['programs', { universityId }],
    queryFn: () => coursesApi.programs(universityId),
  });
  const programs: Program[] = (data?.data as Program[]) ?? [];

  const addMutation = useMutation({
    mutationFn: () =>
      coursesApi.createProgram({ institutionId: universityId, name: newName.trim(), area: newArea.trim() || undefined }),
    onSuccess: () => {
      setNewName('');
      setNewArea('');
      invalidateAll();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => coursesApi.deactivateProgram(id),
    onSuccess: invalidateAll,
  });

  return (
    <div className="pl-4 border-l-2 border-brand-200">
      <div className="flex items-center gap-1.5 mb-2">
        <GraduationCap size={14} className="text-brand-700" />
        <h3 className="text-sm font-semibold text-gray-700">Programs</h3>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : programs.length === 0 ? (
        <p className="text-xs text-gray-400 mb-2">No programs under this university yet.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {programs.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between text-sm bg-white border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <span className="text-gray-800">
                {p.name}
                {p.area && <span className="text-gray-400"> ({p.area})</span>}
                {p.degree && <span className="text-gray-400"> — {p.degree}</span>}
              </span>
              <button
                onClick={() => deactivateMutation.mutate(p.id)}
                disabled={deactivateMutation.isPending}
                title="Deactivate program"
                className="text-gray-400 hover:text-red-600 disabled:opacity-50"
              >
                <Power size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New program name…"
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <input
          value={newArea}
          onChange={(e) => setNewArea(e.target.value)}
          placeholder="Area (optional)"
          className="w-32 px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={() => newName.trim() && addMutation.mutate()}
          disabled={addMutation.isPending || !newName.trim()}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand-800 text-white rounded-lg text-xs font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          <Plus size={12} /> Add Program
        </button>
      </div>
      {(addMutation.isError || deactivateMutation.isError) && (
        <p className="mt-1 text-xs text-red-600">Could not save. Please try again.</p>
      )}
    </div>
  );
}

function UniversityEditForm({
  university,
  onSave,
  isSaving,
}: {
  university: University;
  onSave: (form: UniversityForm) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<UniversityForm>(() => universityToForm(university));

  const generatePageMutation = useMutation({
    mutationFn: () => universitiesApi.generatePage(university.id),
  });

  return (
    <div className="p-5 bg-gray-50 border-t border-gray-200">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <UniversityFields form={form} onChange={setForm} />
          <div className="flex gap-3 mt-5">
            <button
              onClick={() => setForm(universityToForm(university))}
              className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 bg-white"
            >
              Reset
            </button>
            <button
              onClick={() => onSave(form)}
              disabled={isSaving || !form.code || !form.name}
              className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              {isSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={() => generatePageMutation.mutate()}
              disabled={generatePageMutation.isPending}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 border border-brand-300 text-brand-800 rounded-lg hover:bg-brand-50 disabled:opacity-50"
            >
              <Globe2 size={14} />
              {generatePageMutation.isPending ? 'Generating…' : 'Generate Public Page'}
            </button>
            {generatePageMutation.data && (
              <p className="mt-2 text-xs text-gray-600">
                Page ready at slug{' '}
                <code className="bg-gray-100 px-1 py-0.5 rounded">
                  {(generatePageMutation.data.data as any).slug}
                </code>
                .
              </p>
            )}
            {generatePageMutation.isError && (
              <p className="mt-2 text-xs text-red-600">Could not generate the page. Please try again.</p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <UniversityInstitutionsList universityId={university.id} />
          <UniversityProgramsList universityId={university.id} />
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-400">Click the row again to collapse.</p>
    </div>
  );
}

export default function UniversitiesManagement() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createForm, setCreateForm] = useState<UniversityForm>(emptyForm);
  const [justCreatedId, setJustCreatedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['universities'],
    queryFn: () => universitiesApi.list(),
  });
  const universities: University[] = (data?.data as any) ?? [];

  const createMutation = useMutation({
    mutationFn: (form: UniversityForm) => universitiesApi.create(form),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['universities'] });
      setShowCreatePanel(false);
      setCreateForm(emptyForm);
      // Auto-expand the new row so "Generate Public Page" (which needs an
      // id that doesn't exist until after creation) is immediately one
      // click away, instead of making the admin hunt for the new row.
      setJustCreatedId((res.data as any).id);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: UniversityForm }) => universitiesApi.update(id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['universities'] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => universitiesApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['universities'] }),
  });

  const bulkActivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => universitiesApi.update(id, { isActive: true }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['universities'] }),
  });

  const bulkDeactivateMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => universitiesApi.deactivate(id))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['universities'] }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => universitiesApi.import(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['universities'] }),
  });

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
          <span className="text-xs text-gray-400">Click row to edit</span>
          {u.isActive && can('universities', 'delete') && (
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
          {can('universities', 'import') && (
            <>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
              <button
                onClick={handleImportClick}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <Upload size={14} /> Import CSV
              </button>
            </>
          )}
          {can('universities', 'create') && (
            <button
              onClick={() => setShowCreatePanel((s) => !s)}
              className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
            >
              <Plus size={16} /> Add University
            </button>
          )}
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

      {showCreatePanel && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 max-w-md">
          <h2 className="font-semibold text-gray-900 mb-1">Add University</h2>
          <p className="text-xs text-gray-400 mb-4">
            Generating a public "topics offered" page happens right after creating — the row expands
            automatically with that option once saved.
          </p>
          <UniversityFields form={createForm} onChange={setCreateForm} />
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
              disabled={createMutation.isPending || !createForm.code || !createForm.name}
              className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              {createMutation.isPending ? 'Saving…' : 'Create University'}
            </button>
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
        bulkActions={[
          ...(can('universities', 'edit')
            ? [{ label: 'Activate', onClick: (selected: University[]) => bulkActivateMutation.mutate(selected.map((u) => u.id)) }]
            : []),
          ...(can('universities', 'delete')
            ? [{ label: 'Deactivate', onClick: (selected: University[]) => bulkDeactivateMutation.mutate(selected.map((u) => u.id)), danger: true }]
            : []),
        ]}
        onExport={() => handleExport()}
        showExport={can('universities', 'export')}
        emptyMessage="No universities found."
        autoExpandId={justCreatedId}
        renderExpanded={(u) => (
          <UniversityEditForm
            university={u}
            isSaving={updateMutation.isPending && updateMutation.variables?.id === u.id}
            onSave={(form) => updateMutation.mutate({ id: u.id, form })}
          />
        )}
      />
    </div>
  );
}
