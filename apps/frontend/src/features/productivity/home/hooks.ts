import { useQuery } from '@tanstack/react-query';
import { useAuthSession } from '../../auth/auth-session-context';
import { useAuth } from '../../auth/useAuth';
import { productivityKey } from '../cache';
import { readHomeDashboard } from './api';

/**
 * Lives under the shared productivity key, so Board/Workspace revocation,
 * realtime connection loss and access refreshes already clear and refetch it.
 */
export function homeKey(userId: string | undefined, generation: number) {
  return [...productivityKey, 'home', userId, generation] as const;
}

export function useHomeDashboard(timeZone: string | undefined) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const query = useQuery({
    // The server groups due dates in the saved time zone; a change refetches.
    queryKey: [...homeKey(user?.id, scope.generation), timeZone],
    queryFn: ({ signal }) =>
      runAuthorized((token) => readHomeDashboard(token, signal)),
    enabled: !!user && !!timeZone,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  return {
    ...query,
    // A snapshot from another account or session generation is never shown.
    home: scope.isCurrent() && query.isSuccess ? query.data : undefined,
  };
}
