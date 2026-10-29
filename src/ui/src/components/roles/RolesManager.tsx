import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Users } from 'lucide-react';
import { getErrorMessage, permissionsApi, type ManagedRole } from '../../lib/api';

const BASES = [
  { value: 'faculty', label: 'Faculty / reviewer', hint: 'Sees the review queue and faculty screens.' },
  { value: 'admin', label: 'Administrator', hint: 'Sees the staff and admin screens.' },
  { value: 'agency', label: 'Agency', hint: 'Submits requests on behalf of students.' },
  { value: 'student', label: 'Student', hint: 'Sees the student screens.' },
];

/** Create, rename and delete roles. A new role starts with a copy of its base role's grants; adjust them in the matrix below. */
export function RolesManager() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['managed-roles'], queryFn: async () => (await permissionsApi.roles()).data });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', displayName: '', description: '', baseRole: 'faculty' });
  const [err, setErr] = useState('');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['managed-roles'] }); void qc.invalidateQueries({ queryKey: ['permissions-matrix'] }); void qc.invalidateQueries({ queryKey: ['assignable-roles'] }); };

  const create = useMutation({
    mutationFn: () => permissionsApi.createRole({ name: form.name.trim(), displayName: form.displayName.trim(), description: form.description.trim() || undefined, baseRole: form.baseRole }),
    onSuccess: () => { setOpen(false); setForm({ name: '', displayName: '', description: '', baseRole: 'faculty' }); setErr(''); refresh(); },
    onError: (e) => setErr(getErrorMessage(e, 'Could not create the role.')),
  });
  const toggle = useMutation({ mutationFn: (r: ManagedRole) => permissionsApi.updateRole(r.id, { isActive: !r.isActive }), onSuccess: refresh, onError: (e) => setErr(getErrorMessage(e, 'Could not update the role.')) });
  const del = useMutation({ mutationFn: (id: number) => permissionsApi.deleteRole(id), onSuccess: refresh, onError: (e) => setErr(getErrorMessage(e, 'Could not delete the role.')) });

  const list = roles.data ?? [];
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">Roles</h2>
          <p className="text-xs text-gray-500">Create your own roles (for example Registrar or Finance Officer), then give them access in the matrix below. Assign a role to a person under Users.</p>
        </div>
        <button type="button" onClick={() => { setOpen((v) => !v); setErr(''); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-900"><Plus size={15} /> New role</button>
      </div>

      {open && (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Name shown in the app</label>
            <input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value, name: f.name || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) }))} placeholder="Registrar" className={input} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Key (lower case, no spaces)</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) }))} placeholder="registrar" className={input} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Works like</label>
            <select value={form.baseRole} onChange={(e) => setForm((f) => ({ ...f, baseRole: e.target.value }))} className={input}>
              {BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400">{BASES.find((b) => b.value === form.baseRole)?.hint} The role starts with that role&apos;s permissions.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Description (optional)</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={input} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button type="button" disabled={create.isPending || form.name.length < 2 || form.displayName.trim().length < 2} onClick={() => create.mutate()} className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-300">{create.isPending ? 'Creating…' : 'Create role'}</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-white">Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

      <ul className="divide-y divide-gray-100">
        {list.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className={`font-medium ${r.isActive ? 'text-gray-900' : 'text-gray-400'}`}>{r.displayName}</span>
              <span className="ml-2 font-mono text-xs text-gray-400">{r.name}</span>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${r.isSystem ? 'bg-gray-100 text-gray-600' : 'bg-brand-50 text-brand-800'}`}>{r.isSystem ? 'Built-in' : `Custom · works like ${r.baseRole}`}</span>
              {!r.isActive && <span className="ml-2 text-xs text-gray-400">inactive</span>}
              {r.description && <span className="block text-xs text-gray-500">{r.description}</span>}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500"><Users size={13} /> {r.users}</span>
            {!r.isSystem && (
              <span className="flex items-center gap-3 text-xs">
                <button type="button" onClick={() => toggle.mutate(r)} className="font-medium text-brand-800 hover:underline">{r.isActive ? 'Deactivate' : 'Activate'}</button>
                <button type="button" onClick={() => window.confirm(`Delete the role "${r.displayName}"? Its permissions are removed.`) && del.mutate(r.id)} className="inline-flex items-center gap-1 text-red-600 hover:underline"><Trash2 size={12} /> Delete</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
