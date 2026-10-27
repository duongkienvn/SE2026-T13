import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api-client';
import { boardKeys } from './query-keys';
import { avatarKeys } from '../auth/avatar-query-keys';

export const BOARD_ACCESS_REVOKED = 'BOARD_ACCESS_REVOKED';

/** Keep a denial tombstone so mounted observers cannot revive protected data. */
export function revokeBoardAccess(client: QueryClient, boardId: string) {
  // A shared Board may have been the only permission to read another avatar.
  void client.resetQueries({ queryKey: avatarKeys.all });
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
