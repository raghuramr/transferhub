import { useQuery } from '@tanstack/react-query';
import { pagesApi } from '../../lib/api';
import { BlockRenderer } from './BlockRenderer';
import type { CmsPage } from '../../types';

/**
 * Pulls the "dashboard-announcements" CMS page and renders its blocks at the
 * top of a dashboard. An admin editing that page in Admin -> Pages changes
 * what every signed-in user sees here within one refetch — no deploy.
 */
export function AnnouncementsBanner() {
  const { data } = useQuery({
    queryKey: ['pages', 'dashboard-announcements'],
    queryFn: () => pagesApi.bySlug('dashboard-announcements'),
    retry: false,
    staleTime: 60_000,
  });

  const page = data?.data as CmsPage | undefined;
  if (!page || page.blocks.every((b) => !b.visible)) return null;

  return (
    <div className="mb-6">
      <BlockRenderer blocks={page.blocks} />
    </div>
  );
}
