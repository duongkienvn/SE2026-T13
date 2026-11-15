import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueries,
} from '@tanstack/react-query';
import type { CardPreviewSummary } from '@kanban/shared';
import { useMemo } from 'react';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { SessionHttpClient } from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import {
  deduplicatePages,
  nextPage,
} from '../../infrastructure/query/pagination.ts';
import {
  createKanbanApi,
  normalizeKanbanFilters,
  type KanbanFilters,
} from './kanban-api.ts';
import {
  compareKanbanPosition,
  groupKanbanCards,
  kanbanCollection,
  previewBatches,
} from './kanban-model.ts';
import { createColumnApi } from '../columns/api.ts';

const pagination = {
  initialPageParam: 1,
  getNextPageParam: (page: { meta: Parameters<typeof nextPage>[0] } | null) =>
    page ? nextPage(page.meta) : undefined,
};

export function kanbanCardOptions(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
  filters: KanbanFilters,
) {
  const params = normalizeKanbanFilters(filters);
  const board = createKanbanApi(api, identity, boardId);
  return infiniteQueryOptions({
    ...pagination,
    staleTime: 0,
    queryKey: queryKeys.cards(identity, boardId, params),
    queryFn: ({ pageParam, signal }) => board.cards(params, pageParam, signal),
  });
}

export function useBoardKanban(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
  filters: KanbanFilters,
  enabled: boolean,
) {
  const board = createKanbanApi(api, identity, boardId);
  const columnQuery = useInfiniteQuery({
    ...pagination,
    staleTime: 0,
    queryKey: queryKeys.columns(identity, boardId),
    queryFn: ({ pageParam, signal }) =>
      createColumnApi(api, identity, boardId).list(pageParam, signal),
    enabled,
  });
  const cardQuery = useInfiniteQuery({
    ...kanbanCardOptions(api, identity, boardId, filters),
    enabled,
  });
  const columns = useMemo(() => {
    const collection = kanbanCollection(columnQuery.data?.pages ?? []);
    collection.items.sort(compareKanbanPosition);
    return {
      ...collection,
      orderedColumnIds: collection.items.map(({ id }) => id),
    };
  }, [columnQuery.data]);
  const cards = useMemo(() => {
    const pages = cardQuery.data?.pages ?? [];
    const collection = kanbanCollection(pages);
    return {
      ...collection,
      groups: groupKanbanCards(collection.items, !!filters.sortBy),
      batches: previewBatches(pages),
    };
  }, [cardQuery.data, filters.sortBy]);
  const previews = useQueries({
    queries: cards.batches.map((ids) => ({
      queryKey: queryKeys.previewBatch(identity, boardId, ids),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        board.previews(ids, signal),
      enabled,
    })),
    combine(results) {
      const byCard = new Map<string, CardPreviewSummary>();
      for (const result of results)
        for (const summary of (result.isError ? undefined : result.data) ?? [])
          byCard.set(summary.cardId, summary);
      return {
        byCard,
        loading: results.some((result) => result.isPending && !result.isError),
        failures: results.filter((result) => result.isError),
      };
    },
  });
  return { columns, columnQuery, cards, cardQuery, previews };
}

export function useKanbanCatalogs(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
  labelsEnabled: boolean,
  membersEnabled: boolean,
) {
  const board = createKanbanApi(api, identity, boardId);
  const labels = useInfiniteQuery({
    ...pagination,
    queryKey: queryKeys.labels(identity, boardId),
    queryFn: ({ pageParam, signal }) => board.labels(pageParam, signal),
    enabled: labelsEnabled,
  });
  const members = useInfiniteQuery({
    ...pagination,
    queryKey: queryKeys.members(identity, boardId),
    queryFn: ({ pageParam, signal }) => board.members(pageParam, signal),
    enabled: membersEnabled,
  });
  return {
    labels,
    members,
    labelItems: useMemo(
      () =>
        labels.data?.pages.some((page) => page === null)
          ? []
          : deduplicatePages(
              labels.data?.pages.map((page) => page?.data ?? []) ?? [],
            ),
      [labels.data],
    ),
    memberItems: useMemo(
      () =>
        members.data?.pages.some((page) => page === null)
          ? []
          : deduplicatePages(
              members.data?.pages.map((page) => page?.data ?? []) ?? [],
            ),
      [members.data],
    ),
  };
}
