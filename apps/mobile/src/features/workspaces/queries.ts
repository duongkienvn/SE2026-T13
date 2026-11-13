import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { nextPage } from '../../infrastructure/query/pagination.ts';
import type { ResourceId } from '../../navigation/routes.ts';
import type { WorkspaceSummary } from './decoder.ts';
import {
  createWorkspaceApi,
  workspaceDirectoryFilters,
  workspacePageLimit,
  type WorkspaceBoardFilters,
} from './api.ts';

export function isWorkspaceDenied(error: unknown) {
  return error instanceof ApiError && [403, 404].includes(error.status);
}

export function workspaceDirectoryOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  const key = queryKeys.workspaces(identity, workspaceDirectoryFilters);
  const api = createWorkspaceApi(data.api, identity);
  return queryOptions({
    queryKey: key,
    async queryFn({ signal }) {
      const current = data.resources.capture(key, false);
      let rows;
      try {
        rows = await api.directory(signal);
      } catch (error) {
        if (!signal.aborted && isWorkspaceDenied(error)) {
          data.assertCurrent(identity);
          data.evict(identity, [
            key,
            queryKeys.boardLists(identity),
            [...queryKeys.scope(identity), 'workspaces'],
          ]);
        }
        throw error;
      }
      data.assertCurrent(identity);
      current();
      if (signal.aborted) throw new ApiError('aborted');
      const visible = new Set(rows.map((workspace) => workspace.id));
      const previous = data.queryClient.getQueryData<WorkspaceSummary[]>(key);
      for (const workspace of previous ?? []) {
        if (!visible.has(workspace.id))
          evictWorkspaceResources(data, identity, workspace.id);
      }
      for (const workspace of rows)
        data.resources.confirmWorkspace(workspace.id);
      return rows;
    },
  });
}

function evictWorkspaceResources(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
) {
  data.assertCurrent(identity);
  data.resources.fenceWorkspace(id, true);
  data.evict(identity, [
    queryKeys.workspace(identity, id),
    queryKeys.workspaceBoards(identity, id),
  ]);
}

function evictWorkspace(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
) {
  evictWorkspaceResources(data, identity, id);
  const directory = queryKeys.workspaces(identity);
  // The denial identifies one Workspace. Drop its row synchronously so an
  // already verified Personal/Team fallback stays usable during reconciliation.
  const key = queryKeys.workspaces(identity, workspaceDirectoryFilters);
  const previous = data.queryClient.getQueryData<WorkspaceSummary[]>(key);
  data.cancelResourceRequests(directory);
  void data.queryClient.cancelQueries({ queryKey: directory });
  data.resources.bumpKey(directory);
  if (previous) {
    const remaining = previous.filter((row) => row.id !== id);
    if (remaining.length) data.queryClient.setQueryData(key, remaining);
    else data.evict(identity, [key]);
  }
  void data.invalidateHints(identity, [directory]).catch(() => undefined);
}

async function membershipRead<T>(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  signal: AbortSignal,
  read: () => Promise<T>,
) {
  try {
    return await read();
  } catch (error) {
    if (!signal.aborted && isWorkspaceDenied(error))
      evictWorkspace(data, identity, id);
    throw error;
  }
}

export function workspaceDetailOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
) {
  const api = createWorkspaceApi(data.api, identity);
  return queryOptions({
    queryKey: queryKeys.workspace(identity, id),
    queryFn: ({ signal }) =>
      membershipRead(data, identity, id, signal, () => api.detail(id, signal)),
  });
}

export function workspaceOverviewOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
) {
  const api = createWorkspaceApi(data.api, identity);
  return queryOptions({
    queryKey: [...queryKeys.workspace(identity, id), 'overview'] as const,
    queryFn: ({ signal }) =>
      membershipRead(data, identity, id, signal, () =>
        api.overview(id, signal),
      ),
  });
}

export function workspaceBoardOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  filters: WorkspaceBoardFilters = {},
) {
  const api = createWorkspaceApi(data.api, identity);
  const normalized = {
    ...filters,
    limit: filters.limit ?? workspacePageLimit,
    status: filters.status ?? 'active',
    sort: filters.sort ?? 'updatedAt',
  } as const;
  return infiniteQueryOptions({
    queryKey: queryKeys.boards(identity, id, normalized),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      membershipRead(data, identity, id, signal, () =>
        api.boards(id, pageParam, normalized, signal),
      ),
    getNextPageParam: ({ meta }) => nextPage(meta),
  });
}
