import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi } from '../../lib/api';
import { ShieldCheck, Save, Check } from 'lucide-react';

interface Role {
  id: number;
  name: string;
  displayName: string;
}
interface Module {
  id: number;
  key: string;
  label: string;
  sortOrder: number;
}
interface Operation {
  id: number;
  key: string;
  label: string;
  sortOrder: number;
}
interface MatrixEntry {
  roleId: number;
  moduleId: number;
  operationId: number;
  isAllowed: boolean;
}
interface MatrixResponse {
  roles: Role[];
  modules: Module[];
  operations: Operation[];
  entries: MatrixEntry[];
}

function cellKey(roleId: number, moduleId: number, operationId: number) {
  return `${roleId}:${moduleId}:${operationId}`;
}

export default function RolesPermissions() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['permissions-matrix'],
    queryFn: () => permissionsApi.getMatrix(),
  });

  const matrix: MatrixResponse | undefined = data?.data as MatrixResponse | undefined;
  const [activeModuleId, setActiveModuleId] = useState<number | null>(null);
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!matrix) return;
    const map: Record<string, boolean> = {};
    for (const e of matrix.entries) {
      map[cellKey(e.roleId, e.moduleId, e.operationId)] = e.isAllowed;
    }
    setAllowed(map);
    setDirty(false);
    if (activeModuleId === null && matrix.modules.length > 0) {
      setActiveModuleId(matrix.modules[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix]);

  const saveMutation = useMutation({
    mutationFn: (entries: MatrixEntry[]) => permissionsApi.saveMatrix(entries),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['permissions-matrix'] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading || !matrix) {
    return (
      <div className="p-4 sm:p-8 max-w-6xl mx-auto">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  const { roles, modules, operations } = matrix;
  const activeModule = modules.find((m) => m.id === activeModuleId) ?? modules[0];

  const toggle = (roleId: number, moduleId: number, operationId: number) => {
    const key = cellKey(roleId, moduleId, operationId);
    setAllowed((prev) => ({ ...prev, [key]: !prev[key] }));
    setDirty(true);
  };

  const handleSave = () => {
    const entries: MatrixEntry[] = [];
    for (const role of roles) {
      for (const mod of modules) {
        for (const op of operations) {
          entries.push({
            roleId: role.id,
            moduleId: mod.id,
            operationId: op.id,
            isAllowed: !!allowed[cellKey(role.id, mod.id, op.id)],
          });
        }
      }
    }
    saveMutation.mutate(entries);
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-brand-800" size={24} />
          <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <Check size={14} /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-300"
          >
            <Save size={16} />
            {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
      <p className="text-gray-500 mb-6">
        Choose which Role may perform which Operation on each Module. This is master-data
        configuration — it is not yet wired into live access checks (see project notes).
      </p>

      <div className="flex gap-6">
        <div className="w-56 shrink-0 bg-white rounded-xl border border-gray-200 p-2">
          {modules.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveModuleId(m.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${
                activeModule?.id === m.id
                  ? 'bg-brand-800 text-white font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex-1 bg-white rounded-xl border border-gray-200 p-6 overflow-x-auto">
          <h2 className="font-semibold text-gray-900 mb-4">{activeModule?.label}</h2>
          {activeModule && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 font-medium text-gray-500">Role</th>
                  {operations.map((op) => (
                    <th key={op.id} className="text-center py-2 px-3 font-medium text-gray-500">
                      {op.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-gray-900">{role.displayName}</td>
                    {operations.map((op) => {
                      const key = cellKey(role.id, activeModule.id, op.id);
                      const checked = !!allowed[key];
                      return (
                        <td key={op.id} className="text-center py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(role.id, activeModule.id, op.id)}
                            className="h-4 w-4 rounded border-gray-300 text-brand-800 focus:ring-brand-500"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
