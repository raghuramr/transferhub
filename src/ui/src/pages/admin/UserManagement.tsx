import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../lib/api';
import { Users, UserPlus, Lock, Unlock, X } from 'lucide-react';

const roleColors: Record<string, string> = {
  student:     'bg-blue-100 text-blue-700',
  faculty:     'bg-purple-100 text-purple-700',
  admin:       'bg-amber-100 text-amber-700',
  agency:      'bg-teal-100 text-teal-700',
  super_admin: 'bg-red-100 text-red-700',
};

export default function UserManagement() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', role: 'student', password: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  });
  const users: any[] = (data?.data as any) ?? [];

  const createMutation = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setForm({ email: '', firstName: '', lastName: '', role: 'student', password: '' });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) => usersApi.unlock(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="text-brand-800" size={24} />
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900"
        >
          <UserPlus size={16} />
          Add User
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">Create User</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              {[
                { name: 'firstName', label: 'First Name', type: 'text' },
                { name: 'lastName', label: 'Last Name', type: 'text' },
                { name: 'email', label: 'Email', type: 'email' },
                { name: 'password', label: 'Temporary Password', type: 'password' },
              ].map(({ name, label, type }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type}
                    value={(form as any)[name]}
                    onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {['student', 'faculty', 'admin', 'agency', 'super_admin'].map((r) => (
                    <option key={r} value={r}>{r.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
              >
                {createMutation.isPending ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {['Name', 'Email', 'Role', 'Status', 'Actions'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {users.map((u: any) => (
              <tr key={u.id} className={`hover:bg-gray-50 ${!u.isActive ? 'opacity-50' : ''}`}>
                <td className="px-5 py-3 font-medium text-gray-900">
                  {u.firstName} {u.lastName}
                </td>
                <td className="px-5 py-3 text-gray-600">{u.email}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[u.role] ?? ''}`}>
                    {u.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {u.isLocked ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">Locked</span>
                  ) : u.isActive ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">Inactive</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    {u.isLocked && (
                      <button
                        onClick={() => unlockMutation.mutate(u.id)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        <Unlock size={12} /> Unlock
                      </button>
                    )}
                    {u.isActive && (
                      <button
                        onClick={() => deactivateMutation.mutate(u.id)}
                        className="flex items-center gap-1 text-xs text-red-500 hover:underline"
                      >
                        <Lock size={12} /> Deactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
