import type { SessionIdentity } from '../api/session-client.ts';
import { queryKeys, type PrivateQueryKey } from '../query/keys.ts';
import type { Hint, ServerEvent } from './contracts.ts';

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
