import { useQuery } from '@tanstack/react-query';
import type { Page } from '../../lib/api-client';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import { listActivities } from './api';
import { activityKeys } from './query-keys';
import type { Activity } from './types';

export { activityKeys } from './query-keys';

/** Read-only history; only fetched while `enabled` (the dialog is open). */
export function useActivities(
  boardId: string,
  page: number,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { runAuthorized, user } = useAuth();
  const boardKey = activityKeys.board(boardId);
  return useQuery({
    queryKey: activityKeys.page(boardId, page),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listActivities(token, boardId, page, signal)),
    enabled: enabled && !!user,
    retry: retryUnlessClientError,
    // Keep the last page on screen while the next loads, but never show one
    // board's history under another.
    placeholderData: (previous: Page<Activity> | undefined, previousQuery) =>
      previousQuery &&
      boardKey.every((part, index) => previousQuery.queryKey[index] === part)
        ? previous
        : undefined,
  });
}
