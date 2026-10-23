import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { formsApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ClipboardList, Plus } from 'lucide-react';
import type { FormDef } from '../../types';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';

const statusTone: Record<string, 'green' | 'amber' | 'gray'> = {
  open: 'green',
  draft: 'amber',
  closed: 'gray',
};

export default function FormsList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['forms', 'all'],
    queryFn: () => formsApi.list(),
  });

  const forms = (data?.data as FormDef[]) ?? [];

  const columns: DataTableColumn<FormDef>[] = [
    {
      key: 'title',
      header: 'Title / Slug',
      render: (form) => (
        <Link to={`/admin/forms/${form.id}`} className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-800 shrink-0">
            <ClipboardList size={15} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 group-hover:text-brand-800 truncate">{form.title}</p>
            <p className="text-xs text-gray-500 font-mono">/{form.slug}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (form) => (
        <div className="flex items-center gap-2">
          <Badge tone={statusTone[form.status] ?? 'gray'}>{form.status}</Badge>
          <Link to={`/admin/forms/${form.id}/submissions`}>
            <Button variant="outline" size="sm">Submissions</Button>
          </Link>
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortValue: (form) => form.updatedAt,
      render: (form) => (
        <span className="text-gray-500">{new Date(form.updatedAt).toLocaleString()}</span>
      ),
    },
  ];

  const handleBulkDelete = async (selected: FormDef[]) => {
    if (!selected.length) return;
    if (!confirm(`Delete ${selected.length} form(s)? This cannot be undone.`)) return;
    await Promise.all(selected.map((f) => formsApi.remove(f.id)));
    queryClient.invalidateQueries({ queryKey: ['forms'] });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Custom Forms</h1>
          <p className="text-gray-500 mt-1">
            Build JSON-schema forms for intake, referrals, and feedback — no code required.
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => navigate('/admin/forms/new')}>New Form</Button>
      </div>

      <DataTable
        columns={columns}
        rows={forms}
        searchPlaceholder="Search forms…"
        searchKeys={['title', 'slug']}
        bulkActions={[{ label: 'Delete', onClick: handleBulkDelete, danger: true }]}
        isLoading={isLoading}
        emptyMessage="No forms yet. Create one to get started."
      />
    </div>
  );
}
