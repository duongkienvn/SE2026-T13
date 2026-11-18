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
import { activityKeys } from '../../features/activity/keys.ts';

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
function resourceHintTargets(
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
  const previews = card
    ? [
        queryKeys.cardPreview(identity, board, card),
        queryKeys.previewBatch(identity, board, [card]),
      ]
    : [];
  if (event.startsWith('column:')) return [queryKeys.columns(identity, board)];
  if (event === 'labels:changed')
    return [
      queryKeys.labels(identity, board),
      queryKeys.cards(identity, board),
      [...queryKeys.board(identity, board), 'cards'],
      [...queryKeys.board(identity, board), 'previews'],
      queryKeys.tasks(identity),
      queryKeys.home(identity),
      queryKeys.search(identity),
    ];
  if (event.startsWith('comment:'))
    return event === 'comment:updated'
      ? [queryKeys.comments(identity, board, card!)]
      : [queryKeys.comments(identity, board, card!), ...previews];
  if (event === 'card:updated' && hint.changeScope === 'attachments')
    return [queryKeys.attachments(identity, board, card!), ...previews];
  if (event === 'card:updated' && hint.changeScope === 'checklists')
    return [queryKeys.checklists(identity, board, card!), ...previews];
  const result: PrivateQueryKey[] = [];
  if (event.startsWith('member:')) {
    const root = queryKeys.board(identity, board);
    return [
      queryKeys.members(identity, board),
      [...root, 'membership-access'],
      [...root, 'settings'],
      queryKeys.boardLists(identity),
      queryKeys.home(identity),
      queryKeys.tasks(identity),
      queryKeys.search(identity),
      queryKeys.notifications(identity),
      ...(workspaceId ? [queryKeys.workspace(identity, workspaceId)] : []),
      ...(event === 'member:removed'
        ? [
            queryKeys.cards(identity, board),
            [...root, 'cards'] as PrivateQueryKey,
            [...root, 'previews'] as PrivateQueryKey,
          ]
        : []),
    ];
  }
  if (event.startsWith('card:'))
    result.push(
      queryKeys.cards(identity, board),
      queryKeys.card(identity, board, card!),
      ...previews,
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
  if (event === 'member:removed')
    result.push(queryKeys.cards(identity, board), [
      ...queryKeys.board(identity, board),
      'cards',
    ]);
  return result;
}

/** Audit streams use the existing coalesced invalidation queue, never socket payload rows. */
export function hintTargets(
  identity: SessionIdentity,
  event: ServerEvent,
  hint: Hint,
  workspaceId?: string,
): PrivateQueryKey[] {
  const targets = resourceHintTargets(identity, event, hint, workspaceId);
  if (hint.boardId && /^(board|column|card|comment|member):/.test(event))
    targets.push(activityKeys.board(identity, hint.boardId));
  return targets;
}

/** Board privacy/name/move changes can invalidate an already loaded Workspace row. */
export function workspaceActivityTargets(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  workspaceId?: string,
): PrivateQueryKey[] {
  const targets = new Map<string, PrivateQueryKey>();
  for (const { queryKey, state } of data.queryClient.getQueryCache().getAll()) {
    if (
      !keyBelongsTo(queryKey, identity) ||
      queryKey[4] !== 'workspaces' ||
      typeof queryKey[5] !== 'string' ||
      queryKey[6] !== 'activity'
    )
      continue;
    const page = state.data as
      { data?: { board?: { id: string } | null }[] } | undefined;
    if (
      queryKey[5] === workspaceId ||
      page?.data?.some((row) => row.board?.id === boardId)
    )
      targets.set(queryKey[5], activityKeys.workspace(identity, queryKey[5]));
  }
  return [...targets.values()];
}
