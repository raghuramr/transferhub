import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formsApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Reveal } from '../../components/ui/PageTransition';
import { ClipboardList, Plus } from 'lucide-react';
import type { FormDef } from '../../types';

const statusTone: Record<string, 'green' | 'amber' | 'gray'> = {
  open: 'green',
  draft: 'amber',
  closed: 'gray',
};

export default function FormsList() {
  const { data, isLoading } = useQuery({
    queryKey: ['forms', 'all'],
    queryFn: () => formsApi.list(),
  });

  const forms = (data?.data as FormDef[]) ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Custom Forms</h1>
          <p className="text-gray-500 mt-1">
            Build JSON-schema forms for intake, referrals, and feedback — no code required.
          </p>
        </div>
        <Link to="/admin/forms/new">
          <Button icon={<Plus size={16} />}>New Form</Button>
        </Link>
      </div>

      {isLoading && <p className="text-gray-400 text-center py-12">Loading forms…</p>}

      <div className="space-y-3">
        {forms.map((form, i) => (
          <Reveal key={form.id} index={i}>
            <Card className="p-5 flex items-center justify-between hover:border-brand-300 transition-colors">
              <Link to={`/admin/forms/${form.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-800 shrink-0">
                  <ClipboardList size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{form.title}</p>
                  <p className="text-xs text-gray-500 font-mono">/{form.slug}</p>
                </div>
              </Link>
              <div className="flex items-center gap-2 shrink-0">
                <Badge tone={statusTone[form.status] ?? 'gray'}>{form.status}</Badge>
                <span className="text-xs text-gray-400">{form.schema.fields.length} questions</span>
                <Link to={`/admin/forms/${form.id}/submissions`}>
                  <Button variant="outline" size="sm">Submissions</Button>
                </Link>
              </div>
            </Card>
          </Reveal>
        ))}

        {!isLoading && forms.length === 0 && (
          <Card className="p-12 text-center text-gray-400">No forms yet. Create one to get started.</Card>
        )}
      </div>
    </div>
  );
}
