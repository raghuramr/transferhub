import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pagesApi, getErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { BlockEditor } from '../../components/blocks/BlockEditor';
import { BlockRenderer } from '../../components/blocks/BlockRenderer';
import { Save, ArrowLeft, Trash2, Eye } from 'lucide-react';
import type { Block, CmsPage } from '../../types';

const inputCls =
  'w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

export default function PageEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [published, setPublished] = useState(false);
  const [showInNav, setShowInNav] = useState(false);
  const [navLabel, setNavLabel] = useState('');
  const [navOrder, setNavOrder] = useState(0);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showPreview, setShowPreview] = useState(true);
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['pages', id],
    queryFn: () => pagesApi.get(Number(id)),
    enabled: !isNew,
  });

  useEffect(() => {
    const page = data?.data as CmsPage | undefined;
    if (page) {
      setSlug(page.slug);
      setTitle(page.title);
      setPublished(page.published);
      setShowInNav(page.showInNav);
      setNavLabel(page.navLabel ?? '');
      setNavOrder(page.navOrder);
      setBlocks(page.blocks);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { slug, title, blocks, published, showInNav, navLabel: navLabel || undefined, navOrder };
      return isNew ? pagesApi.create(payload) : pagesApi.update(Number(id), payload);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['pages'] });
      const saved = res.data as CmsPage;
      if (isNew) navigate(`/admin/pages/${saved.id}`, { replace: true });
    },
    onError: (err: unknown) => setError(getErrorMessage(err, 'Save failed')),
  });

  const deleteMutation = useMutation({
    mutationFn: () => pagesApi.remove(Number(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages'] });
      navigate('/admin/pages');
    },
  });

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <button
          onClick={() => navigate('/admin/pages')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft size={16} /> Back to Pages
        </button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<Eye size={14} />} onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Hide preview' : 'Show preview'}
          </Button>
          {!isNew && (
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => deleteMutation.mutate()}>
              Delete
            </Button>
          )}
          <Button size="sm" icon={<Save size={14} />} onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 mb-5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <div className={`grid gap-6 ${showPreview ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 max-w-3xl mx-auto'}`}>
        {/* Editor column */}
        <div className="space-y-6">
          <Card className="p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
                <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Slug</label>
                <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-page-slug" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
                Published
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={showInNav} onChange={(e) => setShowInNav(e.target.checked)} />
                Show in sidebar nav
              </label>
              {showInNav && (
                <>
                  <input
                    className={`${inputCls} w-40`}
                    value={navLabel}
                    onChange={(e) => setNavLabel(e.target.value)}
                    placeholder="Nav label"
                  />
                  <input
                    type="number"
                    className={`${inputCls} w-20`}
                    value={navOrder}
                    onChange={(e) => setNavOrder(parseInt(e.target.value) || 0)}
                    placeholder="Order"
                  />
                </>
              )}
            </div>
          </Card>

          <BlockEditor blocks={blocks} onChange={setBlocks} />
        </div>

        {/* Live preview column */}
        {showPreview && (
          <div className="lg:sticky lg:top-6 self-start">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Live preview</p>
            <Card className="p-6 bg-gray-50/50">
              {blocks.length > 0 ? (
                <BlockRenderer blocks={blocks} />
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">Add a block to see a preview</p>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
