import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api-client';
import { boardKeys } from './query-keys';

export const BOARD_ACCESS_REVOKED = 'BOARD_ACCESS_REVOKED';

/** Keep a denial tombstone so mounted observers cannot revive protected data. */
export function revokeBoardAccess(client: QueryClient, boardId: string) {
  const key = boardKeys.detail(boardId);
  void client.cancelQueries({ queryKey: key });
  client.removeQueries({
    queryKey: key,
    predicate: (query) => query.queryKey.length > key.length,
  });
  client
    .getQueryCache()
    .find({ queryKey: key, exact: true })
    ?.setState({
      data: undefined,
      status: 'error',
      error: new ApiError(404, BOARD_ACCESS_REVOKED, 'Board unavailable'),
    });
  client.removeQueries({ queryKey: boardKeys.lists() });
}
