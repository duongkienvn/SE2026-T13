import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { workspaceKeys } from './query-keys';
import type { WorkspaceSummary } from './types';

/** Cancel sibling reads even if their transport ignores AbortSignal. */
export async function denyWorkspaceQueries(
  client: QueryClient,
  queryKey: QueryKey,
  error: unknown,
  sourceKey?: QueryKey,
) {
  const cancellation = client.cancelQueries({
    queryKey,
    // Only a query rejecting itself is exempt. A mutation has no source query.
    predicate: (query) =>
      !sourceKey ||
      JSON.stringify(query.queryKey) !== JSON.stringify(sourceKey),
  });
  for (const query of client.getQueryCache().findAll({ queryKey })) {
    query.setState({ data: null, error: error as Error, status: 'error' });
  }
  await cancellation;
}

/** Denied Workspace reads clear every page/filter, including the shared header. */
export async function revokeWorkspaceAccess(
  client: QueryClient,
  userId: string,
  generation: number,
  workspaceId: string,
  error: unknown,
  sourceKey?: QueryKey,
) {
  const queryKey = workspaceKeys.resource(userId, generation, workspaceId);
  const resources = denyWorkspaceQueries(client, queryKey, error, sourceKey);
  const listKey = workspaceKeys.list(userId, generation);
  const directory = client.cancelQueries({ queryKey: listKey });
  client.setQueryData<WorkspaceSummary[]>(listKey, (items) =>
    items?.filter((item) => item.id !== workspaceId),
  );
  await Promise.all([resources, directory]);
}
