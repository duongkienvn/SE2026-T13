import type { SessionIdentity } from '../api/session-client.ts';
import {
  keyBelongsTo,
  queryKeys,
  type PrivateQueryKey,
} from '../query/keys.ts';
import type { Hint, ServerEvent } from './contracts.ts';
import type { BoardAccess } from './rooms.ts';
import type { HomeDashboard } from '@kanban/shared';
import type { InfiniteData } from '@tanstack/react-query';
import type {
  WorkspaceBoard,
  WorkspaceOverview,
} from '../../features/workspaces/decoder.ts';
import type { MobileDataLayer } from '../query/data-layer.ts';
import { isUuid } from '../auth/credential-record.ts';

/** Aggregate projections locate Boards to check. They never grant Board access. */
export function workspaceBoardCandidates(
  data: MobileDataLayer,
  identity: SessionIdentity,
  workspaceId: string,
  watchedIds: Iterable<string>,
) {
  const candidates = new Set([
    ...data.resources.trackedBoardIds(),
    ...watchedIds,
  ]);
  const affected = new Set<string>();
  const known = new Set<string>();
  function locate(id: string, parent: string) {
    known.add(id);
    if (parent === workspaceId) affected.add(id);
  }
  for (const { queryKey, state } of data.queryClient.getQueryCache().getAll()) {
    if (!keyBelongsTo(queryKey, identity)) continue;
    const id = data.resources.boardId(queryKey);
    if (id) {
      candidates.add(id);
      if (queryKey.length === 6) {
        const board = state.data as Partial<BoardAccess> | undefined;
        if (board?.id === id && isUuid(board.workspaceId))
          locate(id, board.workspaceId.toLowerCase());
      }
    }
    if (queryKey[4] === 'home') {
      const home = state.data as HomeDashboard | undefined;
      if (!home) continue;
      for (const board of [...home.starredBoards, ...home.recentBoards])
        locate(board.id, board.workspaceId);
      for (const task of home.upNext) locate(task.boardId, task.workspaceId);
    }
    if (queryKey[4] === 'board-lists' && typeof queryKey[5] === 'string') {
      const list = state.data as
        InfiniteData<{ data: WorkspaceBoard[] }> | undefined;
      for (const page of list?.pages ?? [])
        for (const board of page.data) locate(board.id, board.workspaceId);
    }
    if (queryKey[4] === 'workspaces' && queryKey[6] === 'overview') {
      const overview = state.data as WorkspaceOverview | undefined;
      for (const board of overview?.recentBoards ?? [])
        locate(board.id, board.workspaceId);
    }
  }
  return [...candidates].filter((id) => {
    const parent = data.resources.boardWorkspace(id);
    if (parent) locate(id, parent);
    return affected.has(id) || !known.has(id);
  });
}

/** Hints choose cache identities; REST supplies values and permissions. */
export function hintTargets(
  identity: SessionIdentity,
  event: ServerEvent,
  hint: Hint,
  workspaceId?: string,
): PrivateQueryKey[] {
  if (event === 'notifications:changed')
    return [queryKeys.notifications(identity)];
  const board = hint.boardId;
  if (!board) return [];
  const card = hint.cardId;
  if (event.startsWith('column:')) return [queryKeys.columns(identity, board)];
  if (event === 'labels:changed')
    return [
      queryKeys.labels(identity, board),
      queryKeys.cards(identity, board),
      [...queryKeys.board(identity, board), 'cards'],
      [...queryKeys.board(identity, board), 'previews'],
      queryKeys.tasks(identity),
      queryKeys.home(identity),
    ];
  if (event.startsWith('comment:'))
    return event === 'comment:updated'
      ? [queryKeys.comments(identity, board, card!)]
      : [
          queryKeys.comments(identity, board, card!),
          queryKeys.cardPreview(identity, board, card!),
        ];
  if (event === 'card:updated' && hint.changeScope === 'attachments')
    return [
      queryKeys.attachments(identity, board, card!),
      queryKeys.cardPreview(identity, board, card!),
    ];
  if (event === 'card:updated' && hint.changeScope === 'checklists')
    return [
      queryKeys.checklists(identity, board, card!),
      queryKeys.cardPreview(identity, board, card!),
    ];
  const result: PrivateQueryKey[] = [];
  if (event.startsWith('card:'))
    result.push(
      queryKeys.cards(identity, board),
      queryKeys.card(identity, board, card!),
      queryKeys.cardPreview(identity, board, card!),
      queryKeys.tasks(identity),
      queryKeys.home(identity),
      queryKeys.search(identity),
    );
  else
    result.push(
      queryKeys.board(identity, board),
      queryKeys.boardLists(identity),
      queryKeys.home(identity),
      queryKeys.tasks(identity),
      queryKeys.search(identity),
    );
  if (workspaceId && event.startsWith('member:'))
    result.push(queryKeys.workspace(identity, workspaceId));
  else if (workspaceId && event.startsWith('board:'))
    result.push([...queryKeys.workspace(identity, workspaceId), 'overview']);
  return result;
}
