import { RealtimeServerEvent, type RealtimeServerEvents } from '@kanban/shared';
import type { InvalidateQueryFilters } from '@tanstack/react-query';
import { boardKeys } from '../boards/query-keys';
import { commentKeys } from '../comments/query-keys';

export type BoardEventName = keyof RealtimeServerEvents;
export type BoardEventPayload<E extends BoardEventName> = Parameters<
  RealtimeServerEvents[E]
>[0];

/** Every server → client board event the frontend listens to. */
export const BOARD_EVENTS = Object.values(
  RealtimeServerEvent,
) as BoardEventName[];

export type InvalidationTarget = Pick<
  InvalidateQueryFilters,
  'queryKey' | 'exact'
>;

/*
 * `boardKeys.detail(id)` is also the prefix of the board's members, columns
 * and cards, so the board itself is always invalidated with `exact`.
 */
const boardDetail = (boardId: string): InvalidationTarget => ({
  queryKey: boardKeys.detail(boardId),
  exact: true,
});
const columns = (boardId: string): InvalidationTarget => ({
  queryKey: boardKeys.columns(boardId),
});
const cardList = (boardId: string): InvalidationTarget => ({
  queryKey: boardKeys.cards(boardId),
  exact: true,
});
const card = (boardId: string, cardId: string): InvalidationTarget => ({
  queryKey: boardKeys.card(boardId, cardId),
});
/** The card list plus every cached card detail of the board. */
const allCards = (boardId: string): InvalidationTarget => ({
  queryKey: boardKeys.cards(boardId),
});
const members = (boardId: string): InvalidationTarget => ({
  queryKey: boardKeys.members(boardId),
});
const boardList = (): InvalidationTarget => ({ queryKey: boardKeys.lists() });

/**
 * Queries to refetch after a board event. Events are hints only: the payload
 * picks what to refresh and REST answers what changed. Column card counts
 * come from the card list, which is the whole board, so a move from one
 * column to another refreshes both.
 */
export function invalidationTargets<E extends BoardEventName>(
  event: E,
  payload: BoardEventPayload<E>,
): InvalidationTarget[] {
  const { boardId } = payload;
  switch (event) {
    case 'board:archived':
    case 'board:restored':
      return [boardDetail(boardId), boardList()];
    case 'column:created':
    case 'column:updated':
    case 'column:moved':
    case 'column:deleted':
      // Only empty columns can be deleted, so no card changes with them.
      return [columns(boardId)];
    case 'card:created':
    case 'card:updated':
    case 'card:moved':
    case 'card:assignees-changed': {
      const { cardId } = payload as BoardEventPayload<'card:updated'>;
      return [cardList(boardId), card(boardId, cardId)];
    }
    case 'card:archived':
    case 'card:restored': {
      const { cardId } = payload as BoardEventPayload<'card:archived'>;
      return [
        cardList(boardId),
        card(boardId, cardId),
        { queryKey: boardKeys.archivedCards(boardId) },
      ];
    }
    case 'member:added':
      return [members(boardId)];
    case 'member:role-changed':
      // The signed-in user's own role lives on the board and the board list.
      return [members(boardId), boardDetail(boardId), boardList()];
    case 'member:removed':
      // Removing a member also drops them from every card they were assigned.
      return [
        { queryKey: ['avatar'] },
        members(boardId),
        boardDetail(boardId),
        boardList(),
        allCards(boardId),
        { queryKey: boardKeys.archivedCards(boardId) },
      ];
    case 'comment:created':
    case 'comment:updated':
    case 'comment:deleted': {
      const { cardId } = payload as BoardEventPayload<'comment:created'>;
      return [{ queryKey: commentKeys.card(boardId, cardId) }];
    }
    default:
      return [];
  }
}

/**
 * Everything a board page shows. Events are not replayed, so a (re)joined
 * board refetches all of it to catch up on what was missed.
 */
export function boardResyncTargets(boardId: string): InvalidationTarget[] {
  return [{ queryKey: boardKeys.detail(boardId) }, boardList()];
}
