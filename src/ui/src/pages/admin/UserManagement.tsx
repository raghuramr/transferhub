import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, api } from '../../lib/api';
import { Users, UserPlus, Lock, Unlock, MapPin, Upload, Download } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { UniversityInstitutionTree } from '../../components/ui/UniversityInstitutionTree';
import { usePermissions } from '../../hooks/usePermissions';

const roleColors: Record<string, string> = {
  student:     'bg-blue-100 text-blue-700',
  faculty:     'bg-purple-100 text-purple-700',
  admin:       'bg-amber-100 text-amber-700',
  agency:      'bg-teal-100 text-teal-700',
  super_admin: 'bg-red-100 text-red-700',
};

const roles = ['student', 'faculty', 'admin', 'agency', 'super_admin'];

interface UserScope {
  universityIds?: number[];
  academicUnitIds?: number[];
  agencyIds?: number[];
}

interface ImportResult {
  created: number;
  updated: number;
  errors?: unknown[];
}

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  isLocked?: boolean;
  status?: string;
  mobile?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  countryOfOrigin?: string;
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

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: number; name: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="border border-gray-300 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-50">
        {options.length === 0 && (
          <div className="px-3 py-2 text-xs text-gray-400">None available</div>
        )}
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={() => toggle(o.id)}
              className="rounded border-gray-300 text-brand-800 focus:ring-brand-500"
            />
            {o.name}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {selected.length === 0 ? 'Unrestricted (sees everything)' : `${selected.length} selected`}
      </p>
    </div>
  );
}

function EditAndScopePanel({ user }: { user: UserRow }) {
  const qc = useQueryClient();
  const [editForm, setEditForm] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    password: '',
    mobile: user.mobile ?? '',
    addressLine1: user.addressLine1 ?? '',
    addressLine2: user.addressLine2 ?? '',
    city: user.city ?? '',
    state: user.state ?? '',
    postalCode: user.postalCode ?? '',
    country: user.country ?? '',
    countryOfOrigin: user.countryOfOrigin ?? '',
  });
  const [scopeDraft, setScopeDraft] = useState<{ universityIds: number[]; academicUnitIds: number[]; agencyIds: number[] }>({
    universityIds: [],
    academicUnitIds: [],
    agencyIds: [],
  });
  const [scopeLoaded, setScopeLoaded] = useState(false);

  // Scope data. Endpoints below (/universities, /institutions, /agencies)
  // are owned by another in-flight change — called directly by URL here
  // rather than via lib/api.ts exports so this file doesn't need to coordinate
  // with that work. They may 404 until that lands; the lists just render empty.
  const universitiesQuery = useQuery({
    queryKey: ['scope-universities'],
    queryFn: () => api.get('/universities').catch(() => ({ data: [] })),
  });
  const institutionsQuery = useQuery({
    queryKey: ['scope-institutions'],
    queryFn: () => api.get('/institutions').catch(() => ({ data: [] })),
  });
  const agenciesQuery = useQuery({
    queryKey: ['scope-agencies'],
    queryFn: () => api.get('/agencies').catch(() => ({ data: [] })),
  });

  useQuery({
    queryKey: ['scope', user.id],
    queryFn: async () => {
      const { data: scopeData } = await usersApi.getScope(user.id);
      const scope = scopeData as UserScope | undefined;
      setScopeDraft({
        universityIds: scope?.universityIds ?? [],
        academicUnitIds: scope?.academicUnitIds ?? [],
        agencyIds: scope?.agencyIds ?? [],
      });
      setScopeLoaded(true);
      return scopeData;
    },
    enabled: !scopeLoaded,
  });

  const universities: { id: number; name: string }[] = (universitiesQuery.data?.data as { id: number; name: string }[]) ?? [];
  const institutions: { id: number; name: string; universityId: number }[] =
    (institutionsQuery.data?.data as { id: number; name: string; universityId: number }[]) ?? [];
  const agencies: { id: number; name: string }[] = (agenciesQuery.data?.data as { id: number; name: string }[]) ?? [];

  const saveEditMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        email: editForm.email,
        role: editForm.role,
        isActive: editForm.isActive,
        mobile: editForm.mobile,
        addressLine1: editForm.addressLine1,
        addressLine2: editForm.addressLine2,
        city: editForm.city,
        state: editForm.state,
        postalCode: editForm.postalCode,
        country: editForm.country,
        countryOfOrigin: editForm.countryOfOrigin,
      };
      if (editForm.password) payload.password = editForm.password;
      return usersApi.update(user.id, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditForm((f) => ({ ...f, password: '' }));
    },
  });

  const saveScopeMutation = useMutation({
    mutationFn: () => usersApi.setScope(user.id, scopeDraft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scope', user.id] }),
  });

  const unlockMutation = useMutation({
    mutationFn: () => usersApi.unlock(user.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Edit section */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3 text-sm">Edit User</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First Name</label>
              <input
                value={editForm.firstName}
                onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Name</label>
              <input
                value={editForm.lastName}
                onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>{r.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reset Password</label>
              <input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Leave blank to keep"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2">Contact & Address</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Mobile</label>
                <input
                  value={editForm.mobile}
                  onChange={(e) => setEditForm((f) => ({ ...f, mobile: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Country of Origin</label>
                <input
                  value={editForm.countryOfOrigin}
                  onChange={(e) => setEditForm((f) => ({ ...f, countryOfOrigin: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Address Line 1</label>
              <input
                value={editForm.addressLine1}
                onChange={(e) => setEditForm((f) => ({ ...f, addressLine1: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Address Line 2</label>
              <input
                value={editForm.addressLine2}
                onChange={(e) => setEditForm((f) => ({ ...f, addressLine2: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">City</label>
                <input
                  value={editForm.city}
                  onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">State/Province</label>
                <input
                  value={editForm.state}
                  onChange={(e) => setEditForm((f) => ({ ...f, state: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Postal Code</label>
                <input
                  value={editForm.postalCode}
                  onChange={(e) => setEditForm((f) => ({ ...f, postalCode: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Country</label>
                <input
                  value={editForm.country}
                  onChange={(e) => setEditForm((f) => ({ ...f, country: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={editForm.isActive}
              onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Active
          </label>
          {user.isLocked && (
            <button
              onClick={() => unlockMutation.mutate()}
              disabled={unlockMutation.isPending}
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              <Unlock size={12} /> {unlockMutation.isPending ? 'Unlocking…' : 'Unlock Account'}
            </button>
          )}
        </div>
        <button
          onClick={() => saveEditMutation.mutate()}
          disabled={saveEditMutation.isPending}
          className="mt-4 w-full py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          {saveEditMutation.isPending ? 'Saving…' : 'Save User'}
        </button>
        {saveEditMutation.isSuccess && (
          <p className="mt-2 text-xs text-green-600">Saved.</p>
        )}
      </div>

      {/* Scope section */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-1 text-sm flex items-center gap-2">
          <MapPin size={14} className="text-brand-800" /> Visibility Scope
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Restrict what this user can see. Leave a list empty for unrestricted access
          (the default — sees everything).
        </p>
        <div className="space-y-3">
          <UniversityInstitutionTree
            universities={universities}
            institutions={institutions}
            universityIds={scopeDraft.universityIds}
            academicUnitIds={scopeDraft.academicUnitIds}
            onChange={({ universityIds, academicUnitIds }) =>
              setScopeDraft((s) => ({ ...s, universityIds, academicUnitIds }))
            }
          />
          <MultiSelect
            label="Agencies"
            options={agencies}
            selected={scopeDraft.agencyIds}
            onChange={(ids) => setScopeDraft((s) => ({ ...s, agencyIds: ids }))}
          />
        </div>
        <button
          onClick={() => saveScopeMutation.mutate()}
          disabled={saveScopeMutation.isPending}
          className="mt-4 w-full py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          {saveScopeMutation.isPending ? 'Saving…' : 'Save Scope'}
        </button>
        {saveScopeMutation.isSuccess && (
          <p className="mt-2 text-xs text-green-600">Saved.</p>
        )}
      </div>
    </div>
  );
}

export default function UserManagement() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', role: 'student', password: '' });
  const [bulkRole, setBulkRole] = useState<string | null>(null);
  const [bulkRoleValue, setBulkRoleValue] = useState('student');

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  });
  const users: UserRow[] = ((data?.data as UserRow[]) ?? []).map((u) => ({
    ...u,
    status: u.isLocked ? 'locked' : u.isActive ? 'active' : 'inactive',
  }));

  const createMutation = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setForm({ email: '', firstName: '', lastName: '', role: 'student', password: '' });
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => usersApi.import(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const handleExport = async () => {
    const res = await usersApi.export();
    downloadBlob(res.data, 'users.csv');
  };

  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = '';
  };

  const bulkActivate = async (rows: UserRow[]) => {
    await Promise.all(rows.map((u) => usersApi.update(u.id, { isActive: true })));
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  const bulkDeactivate = async (rows: UserRow[]) => {
    await Promise.all(rows.map((u) => usersApi.update(u.id, { isActive: false })));
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  const bulkAssignRole = (rows: UserRow[]) => {
    setBulkRole(rows.map((r) => r.id).join(','));
  };

  const confirmBulkRole = async () => {
    if (!bulkRole) return;
    const ids = bulkRole.split(',').filter(Boolean);
    await Promise.all(ids.map((id) => usersApi.update(id, { role: bulkRoleValue })));
    qc.invalidateQueries({ queryKey: ['users'] });
    setBulkRole(null);
  };

  const columns: DataTableColumn<UserRow>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (u) => `${u.firstName} ${u.lastName}`,
      render: (u) => (
        <span className="font-medium text-gray-900">
          {u.firstName} {u.lastName}
        </span>
      ),
    },
    { key: 'email', header: 'Email' },
    {
      key: 'role',
      header: 'Role',
      render: (u) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[u.role] ?? ''}`}>
          {u.role.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (u) => (u.isLocked ? 'locked' : u.isActive ? 'active' : 'inactive'),
      render: (u) =>
        u.isLocked ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">Locked</span>
        ) : u.isActive ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">Inactive</span>
        ),
    },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="text-brand-800" size={24} />
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        </div>
        <div className="flex items-center gap-2">
          {can('users', 'import') && (
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
          {can('users', 'export') && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Download size={14} /> Export CSV
            </button>
          )}
          {can('users', 'create') && (
            <button
              onClick={() => setShowCreate((s) => !s)}
              className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
            >
              <UserPlus size={16} />
              Add User
            </button>
          )}
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

      {bulkRole !== null && (
        <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-brand-50 border border-brand-200 rounded-lg text-sm">
          <span className="font-medium text-brand-900">Assign role to selected users:</span>
          <select
            value={bulkRoleValue}
            onChange={(e) => setBulkRoleValue(e.target.value)}
            className="border border-gray-300 rounded-lg text-sm px-3 py-1.5"
          >
            {roles.map((r) => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>
          <button
            onClick={confirmBulkRole}
            className="px-3 py-1.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
          >
            Confirm
          </button>
          <button
            onClick={() => setBulkRole(null)}
            className="text-sm text-gray-500 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}

      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <h2 className="font-semibold text-gray-900 mb-4 text-sm">Add User</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First Name</label>
              <input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Name</label>
              <input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>{r.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !form.email || !form.firstName || !form.lastName}
              className="px-4 py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              {createMutation.isPending ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </div>
      )}

      <DataTable<UserRow>
        columns={columns}
        rows={users}
        isLoading={isLoading}
        searchPlaceholder="Search users…"
        searchKeys={['email', 'firstName', 'lastName']}
        filters={[
          {
            key: 'role',
            label: 'Role',
            options: roles.map((r) => ({ value: r, label: r.replace('_', ' ') })),
          },
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'locked', label: 'Locked' },
            ],
          },
        ]}
        bulkActions={[
          ...(can('users', 'edit')
            ? [
                { label: 'Activate', onClick: bulkActivate },
                { label: 'Assign Role…', onClick: bulkAssignRole },
              ]
            : []),
          ...(can('users', 'delete') ? [{ label: 'Deactivate', onClick: bulkDeactivate, danger: true }] : []),
        ]}
        onExport={() => handleExport()}
        showExport={can('users', 'export')}
        emptyMessage="No users found."
        renderExpanded={(u) => <EditAndScopePanel user={u} />}
      />
    </div>
  );
}
