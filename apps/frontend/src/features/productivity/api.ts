import type { MyTasksFilters, MyTasksResponse } from '@kanban/shared';
import {
  ApiError,
  ClientErrorCode,
  requestEnvelope,
} from '../../lib/api-client';

/** Preserve the pagination metadata and group counts alongside the task rows. */
export async function readMyTasks(
  accessToken: string,
  filters: MyTasksFilters,
  signal: AbortSignal,
): Promise<MyTasksResponse> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const response = await requestEnvelope(`/users/me/tasks?${search}`, {
    accessToken,
    signal,
  });
  const result = response as MyTasksResponse | undefined;
  const meta = result?.meta;
  const counts = result?.groupCounts;
  if (
    !result ||
    !Array.isArray(result.data) ||
    !meta ||
    !['page', 'limit', 'total', 'totalPages'].every(
      (key) => typeof meta[key as keyof typeof meta] === 'number',
    ) ||
    !counts ||
    !['OVERDUE', 'NEXT_7_DAYS', 'LATER', 'NO_DUE_DATE'].every(
      (key) => typeof counts[key as keyof typeof counts] === 'number',
    )
  ) {
    throw new ApiError(
      200,
      ClientErrorCode.INVALID_RESPONSE,
      'The server returned an unexpected response.',
    );
  }
  return result;
}
