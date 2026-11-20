import { queryOptions, useQuery } from '@tanstack/react-query';
import { BoardRole } from '@kanban/shared';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { decodeBoard } from '../api.ts';
import { isAccessDenied } from '../kanban-api.ts';
import {
  createBoardLifecycleApi,
  type BoardPolicy,
  type LifecycleBoard,
} from '../lifecycle-api.ts';
import {
  boardMembersKey,
  boardMembersPageSize,
  createBoardMembersApi,
} from './api.ts';

export const boardMembershipAccessKey = (
  identity: SessionIdentity,
  boardId: string,
) => [...queryKeys.board(identity, boardId), 'membership-access'] as const;
// Reuse MOB-14's policy key, decoder and endpoint for all Board membership consumers.
export const boardPolicyKey = (identity: SessionIdentity, boardId: string) =>
  [...queryKeys.board(identity, boardId), 'settings', 'policy'] as const;

export function hasExplicitBoardMembership(
  board: Pick<LifecycleBoard, 'capabilities' | 'currentUserRole'> | undefined,
) {
  return (
    board?.capabilities.canReadBoard === true &&
    (board.currentUserRole === BoardRole.OWNER ||
      board.currentUserRole === BoardRole.MEMBER)
  );
}
export function boardMembershipPermissions(
  board: LifecycleBoard | undefined,
  policy: BoardPolicy | undefined,
) {
  const owner =
    board?.currentUserRole === BoardRole.OWNER &&
    !board.isArchived &&
    board.capabilities.canWriteBoard;
  return {
    canReadMembers: hasExplicitBoardMembership(board),
    canAdd: !!owner && policy?.canInviteMembers === true,
    canChange: !!owner && policy?.canChangeMembership === true,
  };
}

export function clearBoardRoster(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
) {
  data.assertCurrent(identity);
  const key = queryKeys.members(identity, boardId);
  data.cancelResourceRequests(key);
  data.evict(identity, [key]);
}

/** Untagged REST probe establishes access; a cached Workspace role never does. */
export function boardMembershipAccessOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
) {
  return queryOptions({
    queryKey: boardMembershipAccessKey(identity, boardId),
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    async queryFn({ signal }) {
      const current = data.resources.captureBoardProbe(boardId);
      try {
        const board = await data.api.json(
          `/boards/${encodeURIComponent(boardId)}`,
          decodeBoard,
          { identity, signal, expectedStatus: 200, retries: 0 },
        );
        data.assertCurrent(identity);
        if (signal.aborted) throw new ApiError('aborted');
        current();
        if (board.id !== boardId || !board.capabilities.canReadBoard)
          throw new ApiError('http', { status: 404 });
        data.resources.confirmBoard(
          boardId,
          !board.isArchived && board.capabilities.canWriteBoard,
          board.workspaceId,
        );
        if (!hasExplicitBoardMembership(board))
          clearBoardRoster(data, identity, boardId);
        return board;
      } catch (error) {
        if (!signal.aborted && isAccessDenied(error)) {
          data.assertCurrent(identity);
          current();
          clearBoardRoster(data, identity, boardId);
          data.resources.denied(queryKeys.board(identity, boardId));
        }
        throw error;
      }
    },
  });
}

export function boardPolicyOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
) {
  return queryOptions({
    queryKey: boardPolicyKey(identity, boardId),
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      createBoardLifecycleApi(data.api, identity).policy(boardId, signal),
  });
}

/** MOB-26: enable only after a fresh explicit Board grant; page data is never a global search. */
export function boardMembersOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  page: number,
  limit = boardMembersPageSize,
) {
  return queryOptions({
    queryKey: boardMembersKey(identity, boardId, page, limit),
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    async queryFn({ signal }) {
      try {
        return await createBoardMembersApi(data.api, identity, boardId).list(
          page,
          signal,
          limit,
        );
      } catch (error) {
        if (!signal.aborted && isAccessDenied(error))
          clearBoardRoster(data, identity, boardId);
        throw error;
      }
    },
  });
}
export function useBoardMembers(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  page: number,
  explicitGrant: boolean,
) {
  return useQuery({
    ...boardMembersOptions(data, identity, boardId, page),
    enabled: explicitGrant,
  });
}

/** No optimistic membership/assignment edits. Committed REST writes remain successful if refresh fails. */
export function refreshBoardMembership(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  workspaceId: string,
) {
  data.assertCurrent(identity);
  const keys = [
    queryKeys.members(identity, boardId),
    boardMembershipAccessKey(identity, boardId),
    boardPolicyKey(identity, boardId),
    [...queryKeys.board(identity, boardId), 'settings'] as const,
    queryKeys.boardLists(identity),
    queryKeys.home(identity),
    queryKeys.tasks(identity),
    queryKeys.search(identity),
    queryKeys.workspace(identity, workspaceId),
    queryKeys.notifications(identity),
    queryKeys.cards(identity, boardId),
    [...queryKeys.board(identity, boardId), 'cards'] as const,
    [...queryKeys.board(identity, boardId), 'previews'] as const,
  ];
  // Drop assignment/roster snapshots now: a failed refresh must not keep a removed assignee.
  const protectedKeys = [
    queryKeys.members(identity, boardId),
    queryKeys.cards(identity, boardId),
    [...queryKeys.board(identity, boardId), 'cards'] as const,
    [...queryKeys.board(identity, boardId), 'previews'] as const,
    [...queryKeys.workspace(identity, workspaceId), 'guests'] as const,
  ];
  for (const key of keys) data.cancelResourceRequests(key);
  data.evict(identity, protectedKeys);
  // Exact detail invalidation avoids invalidating every Board child (comments/attachments).
  void data.queryClient.invalidateQueries({
    queryKey: queryKeys.board(identity, boardId),
    exact: true,
  });
  return data.invalidate(identity, keys);
}
