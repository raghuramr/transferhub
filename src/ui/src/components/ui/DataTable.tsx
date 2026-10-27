import { Fragment, useEffect, useMemo, useState } from 'react';
import { Search, ArrowUp, ArrowDown, Download, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

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
  /** Hide the Export button entirely (e.g. the caller's role lacks the 'export' permission). Default true. */
  showExport?: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
  /**
   * Renders inline, directly under a row, when that row is expanded via the
   * chevron toggle — used in place of popup/modal edit forms (e.g. an
   * edit form, a topics editor). When provided, a chevron column is added
   * and clicking a row (or its chevron) toggles that row's expansion.
   */
  renderExpanded?: (row: T) => React.ReactNode;
  /** Expand a specific row by id as soon as the table renders it (e.g. right after creating it). */
  autoExpandId?: string | number | null;
  /** Turns on pagination with this many rows per page (the viewer can change it). Off by default. */
  pageSize?: number;
}

const PAGE_SIZES = [10, 25, 50, 100];

function getFilterValue<T>(row: T, key: string) {
  return (row as Record<string, unknown>)[key];
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
  showExport = true,
  isLoading,
  emptyMessage = 'No records found.',
  renderExpanded,
  autoExpandId,
  pageSize,
}: DataTableProps<T>) {
  const [perPage, setPerPage] = useState(pageSize ?? 0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [expanded, setExpanded] = useState<Set<string | number>>(
    () => new Set(autoExpandId != null ? [autoExpandId] : []),
  );

  const toggleExpanded = (id: string | number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (autoExpandId != null) setExpanded((prev) => new Set(prev).add(autoExpandId));
  }, [autoExpandId]);

  const filtered = useMemo(() => {
    let result = rows;

    if (search.trim()) {
      const q = search.toLowerCase();
      const keys = searchKeys ?? columns.map((c) => c.key);
      result = result.filter((row) =>
        keys.some((k) => String((row as Record<string, unknown>)[k as string] ?? '').toLowerCase().includes(q)),
      );
    }

    for (const [key, value] of Object.entries(activeFilters)) {
      if (!value) continue;
      result = result.filter((row) => String(getFilterValue(row, key) ?? '') === value);
    }

    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      result = [...result].sort((a, b) => {
        const av = col?.sortValue ? col.sortValue(a) : (a as Record<string, unknown>)[sortKey];
        const bv = col?.sortValue ? col.sortValue(b) : (b as Record<string, unknown>)[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return -1;
        if (bv == null) return 1;
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, search, searchKeys, activeFilters, sortKey, sortDir, columns]);

  // Back to page 1 whenever the visible set changes (search, filters, sort, data).
  useEffect(() => setPage(1), [search, activeFilters, sortKey, sortDir, rows.length]);
  const pageCount = perPage ? Math.max(1, Math.ceil(filtered.length / perPage)) : 1;
  const current = Math.min(page, pageCount);
  const visible = perPage ? filtered.slice((current - 1) * perPage, current * perPage) : filtered;

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Drop selections for rows that no longer exist (e.g. after a delete) so the bulk bar does not linger.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

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
    const lines = filtered.map((row) =>
      columns.map((c) => `"${String((row as Record<string, unknown>)[c.key] ?? '').replace(/"/g, '""')}"`).join(','),
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
        {showExport && (
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Download size={14} /> Export
          </button>
        )}
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

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Phones: one card per row (first column is the title) instead of a sideways-scrolling table. */}
        <ul className="md:hidden divide-y divide-gray-100">
          {visible.map((row) => {
            const [first, ...rest] = columns;
            return (
              <li key={row.id} className="p-4">
                <div
                  className={`flex items-start gap-3 ${renderExpanded ? 'cursor-pointer' : ''}`}
                  onClick={renderExpanded ? () => toggleExpanded(row.id) : undefined}
                >
                  {bulkActions.length > 0 && (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(row.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRow(row.id)}
                    />
                  )}
                  <div className="min-w-0 flex-1 font-medium text-gray-900 break-words">
                    {first.render ? first.render(row) : String((row as Record<string, unknown>)[first.key] ?? '—')}
                  </div>
                  {renderExpanded && (
                    <span className="mt-0.5 text-gray-400">
                      {expanded.has(row.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-y-1.5 text-sm">
                  {rest.map((c) => (
                    <div key={c.key} className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-xs uppercase text-gray-400">{c.header}</dt>
                      <dd className="min-w-0 break-words text-right text-gray-700">
                        {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                      </dd>
                    </div>
                  ))}
                </dl>
                {renderExpanded && expanded.has(row.id) && (
                  <div className="mt-3 border-t border-gray-100 pt-3">{renderExpanded(row)}</div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
            <tr>
              {renderExpanded && <th className="px-2 py-3 w-8" />}
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
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className={`hover:bg-gray-50 ${renderExpanded ? 'cursor-pointer' : ''}`}
                  onClick={renderExpanded ? () => toggleExpanded(row.id) : undefined}
                >
                  {renderExpanded && (
                    <td className="px-2 py-3 text-gray-400">
                      {expanded.has(row.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                  )}
                  {bulkActions.length > 0 && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={`px-6 py-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
                {renderExpanded && expanded.has(row.id) && (
                  <tr className="bg-gray-50/70">
                    <td colSpan={columns.length + (bulkActions.length > 0 ? 1 : 0) + 1} className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
        {filtered.length === 0 && !isLoading && (
          <div className="text-center py-12 text-gray-400">{emptyMessage}</div>
        )}
        {isLoading && <div className="text-center text-gray-400 py-16">Loading…</div>}
      </div>
      {perPage > 0 && filtered.length > 0 && (
        <Pager
          page={current}
          pageCount={pageCount}
          perPage={perPage}
          total={filtered.length}
          onPage={setPage}
          onPerPage={(n) => { setPerPage(n); setPage(1); }}
        />
      )}
    </div>
  );
}

function Pager({ page, pageCount, perPage, total, onPage, onPerPage }: {
  page: number; pageCount: number; perPage: number; total: number;
  onPage: (p: number) => void; onPerPage: (n: number) => void;
}) {
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  // First, last, and a window around the current page; gaps shown as an ellipsis.
  const pages: (number | '…')[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  const btn = 'min-w-8 rounded-md px-2 py-1 text-sm disabled:opacity-40';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
      <div className="flex items-center gap-2">
        <span>Showing {from}–{to} of {total}</span>
        <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={`${btn} hover:bg-gray-100`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        {pages.map((p, i) => p === '…'
          ? <span key={`gap-${i}`} className="px-1 text-gray-400">…</span>
          : (
            <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}
              className={`${btn} ${p === page ? 'bg-brand-800 font-medium text-white' : 'hover:bg-gray-100'}`}>
              {p}
            </button>
          ))}
        <button type="button" className={`${btn} hover:bg-gray-100`} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
