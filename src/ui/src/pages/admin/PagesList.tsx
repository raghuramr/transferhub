import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { pagesApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Reveal } from '../../components/ui/PageTransition';
import { FileEdit, Plus, Eye, EyeOff, Navigation } from 'lucide-react';
import type { CmsPage } from '../../types';

export default function PagesList() {
  const { data, isLoading } = useQuery({
    queryKey: ['pages', 'all'],
    queryFn: () => pagesApi.list(),
  });

  const pages = (data?.data as CmsPage[]) ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Custom Pages</h1>
          <p className="text-gray-500 mt-1">
            Build and edit content blocks — changes go live the moment you save, no deploy needed.
          </p>
        </div>
        <Link to="/admin/pages/new">
          <Button icon={<Plus size={16} />}>New Page</Button>
        </Link>
      </div>

      {isLoading && <p className="text-gray-400 text-center py-12">Loading pages…</p>}

      <div className="space-y-3">
        {pages.map((page, i) => (
          <Reveal key={page.id} index={i}>
            <Link to={`/admin/pages/${page.id}`}>
              <Card className="p-5 flex items-center justify-between hover:border-brand-300 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-800 shrink-0">
                    <FileEdit size={18} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{page.title}</p>
                    <p className="text-xs text-gray-500 font-mono">/{page.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {page.showInNav && (
                    <Badge tone="blue" className="gap-1"><Navigation size={11} /> In nav</Badge>
                  )}
                  <Badge tone={page.published ? 'green' : 'gray'} className="gap-1">
                    {page.published ? <Eye size={11} /> : <EyeOff size={11} />}
                    {page.published ? 'Published' : 'Draft'}
                  </Badge>
                  <span className="text-xs text-gray-400">{page.blocks.length} blocks</span>
                </div>
              </Card>
            </Link>
          </Reveal>
        ))}

        {!isLoading && pages.length === 0 && (
          <Card className="p-12 text-center text-gray-400">
            No custom pages yet. Create one to get started.
          </Card>
        )}
      </div>
    </div>
  );
}
