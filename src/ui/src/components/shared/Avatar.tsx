import { useQuery } from '@tanstack/react-query';
import { accountApi } from '../../lib/api';
import { cn } from '../../lib/cn';

const SIZES = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-lg', xl: 'h-28 w-28 text-3xl' } as const;

/**
 * A user's profile photo (kept in blob storage, fetched with the user's session),
 * falling back to their initials. Pass hasPhoto={false} to skip the request for
 * users known to have no photo.
 */
export function Avatar({
  userId,
  firstName,
  lastName,
  size = 'sm',
  hasPhoto,
  className,
}: {
  userId?: string;
  firstName?: string;
  lastName?: string;
  size?: keyof typeof SIZES;
  hasPhoto?: boolean;
  className?: string;
}) {
  const { data: url } = useQuery({
    queryKey: ['avatar', userId],
    enabled: !!userId && hasPhoto !== false,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        const res = await accountApi.photo(userId!);
        return URL.createObjectURL(res.data);
      } catch {
        return null;
      }
    },
  });
  const initials = `${firstName?.[0] ?? '?'}${lastName?.[0] ?? ''}`.toUpperCase();
  return url ? (
    <img src={url} alt="" className={cn('shrink-0 rounded-full object-cover', SIZES[size], className)} />
  ) : (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-brand-800 font-bold text-white', SIZES[size], className)}>
      {initials}
    </span>
  );
}
