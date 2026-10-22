import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ScrollText, Search } from 'lucide-react';

export default function AuditLog() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', search, page],
    queryFn: () => api.get('/audit', { params: { search: search || undefined, page, pageSize: 25 } }),
  });

  const result = data?.data as any;
  const logs: any[] = result?.data ?? [];
  const total: number = result?.total ?? 0;
  const pages = Math.ceil(total / 25);

  const actionColor: Record<string, string> = {
    LOGIN:        'bg-blue-100 text-blue-700',
    LOGOUT:       'bg-gray-100 text-gray-600',
    CREATE:       'bg-green-100 text-green-700',
    UPDATE:       'bg-amber-100 text-amber-700',
    DELETE:       'bg-red-100 text-red-700',
    DECISION:     'bg-purple-100 text-purple-700',
    AI_MATCH:     'bg-indigo-100 text-indigo-700',
    UNLOCK:       'bg-teal-100 text-teal-700',
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ScrollText className="text-purple-600" size={24} />
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Immutable append-only record — {total.toLocaleString()} entries
      </p>

      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search user or action…"
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {['Timestamp', 'User', 'Action', 'Entity', 'IP Address'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 font-mono text-xs">
            {isLoading && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400 font-sans">Loading…</td></tr>
            )}
            {!isLoading && logs.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400 font-sans">No entries found.</td></tr>
            )}
            {logs.map((log: any) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-5 py-2 text-gray-500 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-5 py-2 text-gray-700">
                  {log.userEmail ?? log.userId ?? '—'}
                </td>
                <td className="px-5 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium font-sans ${actionColor[log.action] ?? 'bg-gray-100 text-gray-700'}`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-5 py-2 text-gray-600">
                  {log.entityType}{log.entityId ? `:${log.entityId}` : ''}
                </td>
                <td className="px-5 py-2 text-gray-400">{log.ipAddress ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">{total.toLocaleString()} total entries</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40">Previous</button>
            <span className="px-3 py-1.5 text-sm text-gray-600">Page {page} of {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
