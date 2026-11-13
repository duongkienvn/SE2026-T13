import { WorkspaceType, type ApiPaginatedResponse } from '@kanban/shared';
import type { Decoder } from '../../infrastructure/api/client.ts';
import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import type {
  SessionIdentity,
  SessionHttpClient,
} from '../../infrastructure/api/session-client.ts';
import {
  queryKeys,
  type PrivateQueryKey,
} from '../../infrastructure/query/keys.ts';
import {
  deduplicatePages,
  requirePage,
} from '../../infrastructure/query/pagination.ts';
import {
  decodeWorkspace,
  decodeWorkspaceBoard,
  decodeWorkspaceOverview,
  type WorkspaceSummary,
} from './decoder.ts';
import type { ResourceId } from '../../navigation/routes.ts';

export const workspacePageLimit = 20;
export const maxWorkspacePage = 1_000_000;
export const workspaceDirectoryFilters = { limit: workspacePageLimit } as const;

export interface WorkspaceBoardFilters {
  limit?: number;
  status?: 'active' | 'archived';
  search?: string;
  starred?: boolean;
  recent?: boolean;
  sort?: 'updatedAt' | 'createdAt' | 'name' | 'recent';
}

function validatePage(page: number, limit: number) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > maxWorkspacePage ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new ApiError('configuration');
}

export function createWorkspaceApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  const request = (signal: AbortSignal, resourceKey: PrivateQueryKey) =>
    ({
      identity,
      signal,
      resourceKey,
      expectedStatus: 200,
      retries: 0,
    }) as const;
  const directoryKey = queryKeys.workspaces(
    identity,
    workspaceDirectoryFilters,
  );

  async function readPage<T>(
    path: string,
    decode: Decoder<T>,
    page: number,
    limit: number,
    filters: Omit<WorkspaceBoardFilters, 'limit'>,
    signal: AbortSignal,
    resourceKey: PrivateQueryKey,
  ): Promise<ApiPaginatedResponse<T>> {
    validatePage(page, limit);
    const result = requirePage(
      await api.envelope<T[]>(
        path,
        (value) => {
          if (!Array.isArray(value) || value.length > limit)
            throw invalidResponse(200);
          return Array.from(value, decode);
        },
        {
          ...request(signal, resourceKey),
          query: { ...filters, page, limit },
        },
      ),
    );
    const { meta, data } = result;
    const expectedLength = Math.min(
      limit,
      Math.max(0, meta.total - (page - 1) * limit),
    );
    if (
      meta.page !== page ||
      meta.limit !== limit ||
      meta.totalPages !== Math.ceil(meta.total / limit) ||
      meta.totalPages > maxWorkspacePage ||
      data.length !== expectedLength
    )
      throw invalidResponse(200);
    return result;
  }

  function personal(
    signal: AbortSignal,
    key = queryKeys.workspaces(identity, { personal: true }),
  ) {
    return api.json(
      '/workspaces/personal',
      (value) => {
        const workspace = decodeWorkspace(value);
        if (workspace.type !== WorkspaceType.PERSONAL)
          throw invalidResponse(200);
        return workspace;
      },
      request(signal, key),
    );
  }

  return {
    personal,
    async directory(signal: AbortSignal) {
      const pages: WorkspaceSummary[][] = [];
      const first = await readPage(
        '/workspaces',
        decodeWorkspace,
        1,
        workspacePageLimit,
        {},
        signal,
        directoryKey,
      );
      pages.push(first.data);
      // Bound the walk by the first snapshot. If rows disappear while walking,
      // the later response can shorten it; arrivals are picked up on refresh.
      let end = first.meta.totalPages;
      for (let page = 2; page <= end; page++) {
        const result = await readPage(
          '/workspaces',
          decodeWorkspace,
          page,
          workspacePageLimit,
          {},
          signal,
          directoryKey,
        );
        pages.push(result.data);
        end = Math.min(end, result.meta.totalPages);
      }
      const result = deduplicatePages(pages);
      if (!result.length) result.push(await personal(signal, directoryKey));
      return result.sort(
        (a, b) =>
          Number(b.type === WorkspaceType.PERSONAL) -
          Number(a.type === WorkspaceType.PERSONAL),
      );
    },
    detail(id: ResourceId, signal: AbortSignal) {
      return api.json(
        `/workspaces/${id}`,
        (value) => {
          const workspace = decodeWorkspace(value);
          if (workspace.id !== id) throw invalidResponse(200);
          return workspace;
        },
        request(signal, queryKeys.workspace(identity, id)),
      );
    },
    overview(id: ResourceId, signal: AbortSignal) {
      return api.json(
        `/workspaces/${id}/overview`,
        (value) => decodeWorkspaceOverview(value, id),
        request(signal, [...queryKeys.workspace(identity, id), 'overview']),
      );
    },
    boards(
      id: ResourceId,
      page: number,
      filters: WorkspaceBoardFilters,
      signal: AbortSignal,
    ) {
      const { limit = workspacePageLimit, ...rest } = filters;
      return readPage(
        `/workspaces/${id}/boards`,
        (value) => {
          const board = decodeWorkspaceBoard(value, id);
          if (board.isArchived !== (rest.status === 'archived'))
            throw invalidResponse(200);
          return board;
        },
        page,
        limit,
        rest,
        signal,
        queryKeys.boards(identity, id, { ...rest, limit }),
      );
    },
  };
}
