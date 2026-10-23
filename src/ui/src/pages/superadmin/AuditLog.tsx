import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ScrollText } from 'lucide-react';
import { DataTable, type DataTableColumn, type DataTableFilter } from '../../components/ui/DataTable';

interface AuditRow {
  id: string | number;
  createdAt: string;
  userEmail?: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string | number;
  ipAddress?: string;
}

export default function AuditLog() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page],
    queryFn: () => api.get('/audit', { params: { page, pageSize: 25 } }),
  });

  const result = data?.data as any;
  const logs: AuditRow[] = result?.data ?? [];
  const total: number = result?.total ?? 0;
  const pages = Math.ceil(total / 25);

  const actionColor: Record<string, string> = {
    LOGIN:        'bg-blue-100 text-blue-700',
    LOGOUT:       'bg-gray-100 text-gray-600',
    CREATE:       'bg-green-100 text-green-700',
    UPDATE:       'bg-amber-100 text-amber-700',
    DELETE:       'bg-red-100 text-red-700',
    DECISION:     'bg-purple-100 text-purple-700',
    AI_MATCH:     'bg-brand-100 text-brand-900',
    UNLOCK:       'bg-teal-100 text-teal-700',
  };

  const actionOptions = useMemo(() => {
    const values = Array.from(new Set(logs.map((l) => l.action).filter(Boolean)));
    return values.sort().map((v) => ({ value: v, label: v }));
  }, [logs]);

  const entityTypeOptions = useMemo(() => {
    const values = Array.from(new Set(logs.map((l) => l.entityType).filter(Boolean))) as string[];
    return values.sort().map((v) => ({ value: v, label: v }));
  }, [logs]);

  const columns: DataTableColumn<AuditRow>[] = [
    {
      key: 'createdAt',
      header: 'Timestamp',
      sortValue: (row) => row.createdAt,
      render: (row) => <span className="text-gray-500 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</span>,
    },
    {
      key: 'userEmail',
      header: 'User',
      render: (row) => <span className="text-gray-700">{row.userEmail ?? row.userId ?? '—'}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium font-sans ${actionColor[row.action] ?? 'bg-gray-100 text-gray-700'}`}>
          {row.action}
        </span>
      ),
    },
    {
      key: 'entityType',
      header: 'Entity Type',
      render: (row) => <span className="text-gray-600">{row.entityType ?? '—'}</span>,
    },
    {
      key: 'entityId',
      header: 'Entity Id',
      render: (row) => <span className="text-gray-600">{row.entityId ?? '—'}</span>,
    },
  ];

  const filters: DataTableFilter[] = [
    { key: 'action', label: 'Action', options: actionOptions },
    { key: 'entityType', label: 'Entity Type', options: entityTypeOptions },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ScrollText className="text-purple-600" size={24} />
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Immutable append-only record — {total.toLocaleString()} entries
      </p>

      <DataTable
        columns={columns}
        rows={logs}
        searchPlaceholder="Search user or action…"
        searchKeys={['userEmail', 'userId', 'action', 'entityType']}
        filters={filters}
        isLoading={isLoading}
        emptyMessage="No entries found."
      />

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
