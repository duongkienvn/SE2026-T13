import { useQuery } from '@tanstack/react-query';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import { listActivities } from './api';
import { activityKeys } from './query-keys';

export { activityKeys } from './query-keys';

/** Read-only history; only fetched while `enabled` (the dialog is open). */
export function useActivities(
  boardId: string,
  page: number,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { runAuthorized, user } = useAuth();
  return useQuery({
    queryKey: activityKeys.page(boardId, page),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listActivities(token, boardId, page, signal)),
    enabled: enabled && !!user,
    retry: retryUnlessClientError,
  });
}
