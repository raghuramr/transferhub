import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { pagesApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { FileEdit, Plus, Eye, EyeOff, Navigation } from 'lucide-react';
import type { CmsPage } from '../../types';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';

export default function PagesList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['pages', 'all'],
    queryFn: () => pagesApi.list(),
  });

  const pages = (data?.data as CmsPage[]) ?? [];

  const columns: DataTableColumn<CmsPage>[] = [
    {
      key: 'title',
      header: 'Title / Slug',
      render: (page) => (
        <Link to={`/admin/pages/${page.id}`} className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-800 shrink-0">
            <FileEdit size={15} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 group-hover:text-brand-800">{page.title}</p>
            <p className="text-xs text-gray-500 font-mono">/{page.slug}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'published',
      header: 'Status',
      sortValue: (page) => (page.published ? 1 : 0),
      render: (page) => (
        <div className="flex items-center gap-2">
          <Badge tone={page.published ? 'green' : 'gray'} className="gap-1">
            {page.published ? <Eye size={11} /> : <EyeOff size={11} />}
            {page.published ? 'Published' : 'Draft'}
          </Badge>
          {page.showInNav && (
            <Badge tone="blue" className="gap-1"><Navigation size={11} /> In nav</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortValue: (page) => page.updatedAt,
      render: (page) => (
        <span className="text-gray-500">{new Date(page.updatedAt).toLocaleString()}</span>
      ),
    },
  ];

  const handleBulkDelete = async (selected: CmsPage[]) => {
    if (!selected.length) return;
    if (!confirm(`Delete ${selected.length} page(s)? This cannot be undone.`)) return;
    await Promise.all(selected.map((p) => pagesApi.remove(p.id)));
    queryClient.invalidateQueries({ queryKey: ['pages'] });
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Custom Pages</h1>
          <p className="text-gray-500 mt-1">
            Build and edit content blocks — changes go live the moment you save, no deploy needed.
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => navigate('/admin/pages/new')}>New Page</Button>
      </div>

      <DataTable
        columns={columns}
        rows={pages}
        searchPlaceholder="Search pages…"
        searchKeys={['title', 'slug']}
        bulkActions={[{ label: 'Delete', onClick: handleBulkDelete, danger: true }]}
        isLoading={isLoading}
        emptyMessage="No custom pages yet. Create one to get started."
      />
    </div>
  );
}
