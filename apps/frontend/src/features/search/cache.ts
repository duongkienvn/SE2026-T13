import type { QueryClient } from '@tanstack/react-query';

export const searchKey = ['search'] as const;

/** Hide protected snapshots immediately and cancel reads started before an ACL change. */
export function clearSearch(client: QueryClient) {
  void client.cancelQueries({ queryKey: searchKey });
  for (const query of client.getQueryCache().findAll({ queryKey: searchKey })) {
    query.setState({ data: undefined, status: 'pending', error: null });
  }
}

export function refreshSearch(client: QueryClient) {
  if (!client.getQueryCache().findAll({ queryKey: searchKey }).length) return;
  clearSearch(client);
  void client.invalidateQueries({ queryKey: searchKey });
}
