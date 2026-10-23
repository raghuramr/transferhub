import { useMemo, useState } from 'react';
import { Search, ArrowUp, ArrowDown, Download } from 'lucide-react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right';
}

export interface DataTableFilter {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface DataTableProps<T extends { id: string | number }> {
  columns: DataTableColumn<T>[];
  rows: T[];
  searchPlaceholder?: string;
  searchKeys?: (keyof T | string)[];
  filters?: DataTableFilter[];
  bulkActions?: { label: string; onClick: (selected: T[]) => void; danger?: boolean }[];
  onExport?: (rows: T[]) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}

function getFilterValue(row: any, key: string) {
  return row[key];
}

/**
 * Shared list-view kit: search + per-column sort + dropdown filters +
 * row-select bulk actions + CSV export. Used across Course Database,
 * Users, Universities, Institutions, Agencies, Custom Pages/Forms, Audit Log.
 */
export function DataTable<T extends { id: string | number }>({
  columns,
  rows,
  searchPlaceholder = 'Search…',
  searchKeys,
  filters = [],
  bulkActions = [],
  onExport,
  isLoading,
  emptyMessage = 'No records found.',
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string | number>>(new Set());

  const filtered = useMemo(() => {
    let result = rows;

    if (search.trim()) {
      const q = search.toLowerCase();
      const keys = searchKeys ?? columns.map((c) => c.key);
      result = result.filter((row: any) =>
        keys.some((k) => String(row[k as string] ?? '').toLowerCase().includes(q)),
      );
    }

    for (const [key, value] of Object.entries(activeFilters)) {
      if (!value) continue;
      result = result.filter((row: any) => String(getFilterValue(row, key) ?? '') === value);
    }

    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      result = [...result].sort((a, b) => {
        const av = col?.sortValue ? col.sortValue(a) : (a as any)[sortKey];
        const bv = col?.sortValue ? col.sortValue(b) : (b as any)[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return -1;
        if (bv == null) return 1;
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, search, searchKeys, activeFilters, sortKey, sortDir, columns]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleRow = (id: string | number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id))));
  };

  const selectedRows = filtered.filter((r) => selected.has(r.id));

  const exportCsv = () => {
    if (onExport) return onExport(filtered);
    const header = columns.map((c) => c.header).join(',');
    const lines = filtered.map((row: any) =>
      columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {filters.map((f) => (
          <select
            key={f.key}
            value={activeFilters[f.key] ?? ''}
            onChange={(e) => setActiveFilters((prev) => ({ ...prev, [f.key]: e.target.value }))}
            className="border border-gray-300 rounded-lg text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">{f.label}: All</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ))}
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <Download size={14} /> Export
        </button>
      </div>

      {selected.size > 0 && bulkActions.length > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 bg-brand-50 border border-brand-200 rounded-lg text-sm">
          <span className="font-medium text-brand-900">{selected.size} selected</span>
          {bulkActions.map((a) => (
            <button
              key={a.label}
              onClick={() => a.onClick(selectedRows)}
              className={`font-medium ${a.danger ? 'text-red-600 hover:text-red-700' : 'text-brand-700 hover:text-brand-900'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
            <tr>
              {bulkActions.length > 0 && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={`px-6 py-3 cursor-pointer select-none hover:text-gray-700 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {sortKey === c.key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50">
                {bulkActions.length > 0 && (
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={`px-6 py-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                    {c.render ? c.render(row) : String((row as any)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !isLoading && (
          <div className="text-center py-12 text-gray-400">{emptyMessage}</div>
        )}
        {isLoading && <div className="text-center text-gray-400 py-16">Loading…</div>}
      </div>
    </div>
  );
}
