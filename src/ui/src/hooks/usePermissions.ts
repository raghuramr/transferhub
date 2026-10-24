import { useQuery } from '@tanstack/react-query';
import { permissionsApi } from '../lib/api';
import { useAuthStore } from '../store/auth';

/**
 * Fetches the logged-in user's effective Roles & Permissions grants
 * (`GET /permissions/my`) and exposes a `can(moduleKey, operationKey)`
 * check so pages can show/hide import/export/bulk-action controls per the
 * live matrix — mirroring what RolesGuard's @Permission() checks enforce
 * server-side, instead of a hardcoded role check that the matrix can't
 * actually override. See CLAUDE.md "Roles & Permissions" for the design.
 */
export function usePermissions() {
  const { user } = useAuthStore();
  const { data, isLoading } = useQuery({
    queryKey: ['my-permissions', user?.id],
    queryFn: () => permissionsApi.my(),
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const grants = data?.data ?? {};

  const can = (moduleKey: string, operationKey: string): boolean => !!grants[moduleKey]?.[operationKey];

  return { can, isLoading };
}
