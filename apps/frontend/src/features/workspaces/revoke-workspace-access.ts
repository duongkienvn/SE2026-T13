import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { workspaceKeys } from './query-keys';
import type { WorkspaceSummary } from './types';

/** Denied Workspace reads clear every page/filter, including the shared header. */
export async function revokeWorkspaceAccess(
  client: QueryClient,
  userId: string,
  generation: number,
  workspaceId: string,
  error: unknown,
  sourceKey: QueryKey,
) {
  const queryKey = workspaceKeys.resource(userId, generation, workspaceId);
  await client.cancelQueries({
    queryKey,
    predicate: (query) =>
      JSON.stringify(query.queryKey) !== JSON.stringify(sourceKey),
  });
  for (const query of client.getQueryCache().findAll({ queryKey })) {
    query.setState({ data: null, error: error as Error, status: 'error' });
  }
  const listKey = workspaceKeys.list(userId, generation);
  await client.cancelQueries({ queryKey: listKey });
  client.setQueryData<WorkspaceSummary[]>(listKey, (items) =>
    items?.filter((item) => item.id !== workspaceId),
  );
}
