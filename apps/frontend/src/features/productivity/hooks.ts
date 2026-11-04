import { useQuery } from '@tanstack/react-query';
import type { MyTasksFilters } from '@kanban/shared';
import { useAuthSession } from '../auth/auth-session-context';
import { useAuth } from '../auth/useAuth';
import { readMyTasks } from './api';

export function useMyTasks(
  filters: MyTasksFilters,
  timeZone: string,
  enabled = true,
) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const query = useQuery({
    queryKey: [
      'productivity',
      user?.id,
      scope.generation,
      'tasks',
      timeZone,
      filters,
    ],
    queryFn: ({ signal }) =>
      runAuthorized((token) => readMyTasks(token, filters, signal)),
    enabled: !!user && enabled,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  return {
    ...query,
    // Never render a stale snapshot while its authorization is being checked.
    tasks:
      scope.isCurrent() && query.isSuccess && !query.isFetching
        ? query.data
        : undefined,
  };
}
