import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import type { BoardMember } from './api';
import { boardMembersOptions } from './queries';

/** Page-aware roster reads, bounded so a huge Board cannot fan out unbounded requests. */
export const ROSTER_PAGE_LIMIT = 100;
export const ROSTER_MAX_PAGES = 5;

/**
 * Read-only index of the authorized Board roster for comments, mentions and
 * presence. It only runs for an explicit OWNER/MEMBER (`explicit`); a
 * Workspace read-only viewer never requests the roster. Pages share the MOB-25
 * keys, so member hints, eviction and logout cover every consumer.
 */
export function useBoardRoster(
  identity: SessionIdentity,
  boardId: string,
  explicit: boolean,
) {
  const data = useMobileData();
  const first = useQuery({
    ...boardMembersOptions(data, identity, boardId, 1, ROSTER_PAGE_LIMIT),
    enabled: explicit,
  });
  const totalPages = first.data?.meta.totalPages ?? 1;
  const extra = Math.max(0, Math.min(totalPages, ROSTER_MAX_PAGES) - 1);
  const rest = useQueries({
    queries: Array.from({ length: extra }, (_, index) => ({
      ...boardMembersOptions(
        data,
        identity,
        boardId,
        index + 2,
        ROSTER_PAGE_LIMIT,
      ),
      enabled: explicit && first.isSuccess,
    })),
  });
  const pages = [first, ...rest];
  const loaded = pages.every((query) => query.isSuccess);
  const membersById = useMemo(() => {
    const map = new Map<string, BoardMember>();
    if (!explicit) return map;
    for (const query of pages)
      for (const member of query.data?.data ?? [])
        map.set(member.user.id, member);
    return map;
    // A fixed-size dependency: page count changes once the first page lands.
  }, [explicit, pages.map((query) => query.dataUpdatedAt).join()]);
  return {
    explicit,
    membersById,
    loading: explicit && pages.some((query) => query.isPending),
    error: explicit
      ? (pages.find((query) => query.isError)?.error ?? null)
      : null,
    incomplete: explicit && loaded && totalPages > ROSTER_MAX_PAGES,
    retry: () => {
      for (const query of pages) if (query.isError) void query.refetch();
    },
  };
}
