import type { QueryClient } from '@tanstack/react-query';
import { workspaceKeys } from '../query-keys';

/** Membership hints invalidate identities as well as associations, across cached pages. */
export function refreshWorkspaceGuests(client: QueryClient): void {
  const guests = {
    queryKey: workspaceKeys.all,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[5] === 'guests',
  };
  void client.cancelQueries(guests);
  for (const query of client.getQueryCache().findAll(guests))
    query.setState({ data: undefined, error: null, status: 'pending' });
  void client.invalidateQueries(guests);
}
