import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { pagesApi } from '../../lib/api';
import { BlockRenderer } from '../../components/blocks/BlockRenderer';
import { Reveal } from '../../components/ui/PageTransition';
import type { CmsPage } from '../../types';
import { FileQuestion } from 'lucide-react';

export default function CmsPageView() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['pages', 'slug', slug],
    queryFn: () => pagesApi.bySlug(slug!),
  });

  const page = data?.data as CmsPage | undefined;

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading…</div>;

  if (error || !page) {
    return (
      <div className="p-12 text-center text-gray-400">
        <FileQuestion size={36} className="mx-auto mb-3 opacity-40" />
        This page isn't available.
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Reveal>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{page.title}</h1>
      </Reveal>
      <BlockRenderer blocks={page.blocks} />
    </div>
  );
}
