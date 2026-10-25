/**
 * TanStack Query keys for board data. Everything lives under `['boards']` so
 * one invalidation can refresh lists, details and member lists together.
 */
export const boardKeys = {
  all: ['boards'] as const,
  lists: () => [...boardKeys.all, 'list'] as const,
  list: (status: 'active' | 'archived') =>
    [...boardKeys.lists(), status] as const,
  detail: (boardId: string) => [...boardKeys.all, 'detail', boardId] as const,
  members: (boardId: string) =>
    [...boardKeys.all, 'detail', boardId, 'members'] as const,
  columns: (boardId: string) =>
    [...boardKeys.all, 'detail', boardId, 'columns'] as const,
  /** Active cards of the board; also the prefix of every card detail key. */
  cards: (boardId: string) =>
    [...boardKeys.all, 'detail', boardId, 'cards'] as const,
  card: (boardId: string, cardId: string) =>
    [...boardKeys.all, 'detail', boardId, 'cards', cardId] as const,
};
