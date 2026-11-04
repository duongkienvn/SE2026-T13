import type { QueryClient } from '@tanstack/react-query';

export const productivityKey = ['productivity'] as const;

/** Discard snapshots before a fresh authorization check after access changes. */
export function clearProductivity(client: QueryClient) {
  void client.cancelQueries({ queryKey: productivityKey });
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: productivityKey })) {
    query.setState({ data: undefined, status: 'pending', error: null });
  }
}

export function refreshProductivity(client: QueryClient) {
  if (!client.getQueryCache().find({ queryKey: productivityKey })) return;
  clearProductivity(client);
  void client.invalidateQueries({ queryKey: productivityKey });
}
