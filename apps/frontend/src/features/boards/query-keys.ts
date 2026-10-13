/**
 * TanStack Query keys for board data. Everything lives under `['boards']` so
 * one invalidation can refresh lists, details and member lists together.
 */
export const boardKeys = {
  all: ['boards'] as const,
  lists: () => [...boardKeys.all, 'list'] as const,
  detail: (boardId: string) => [...boardKeys.all, 'detail', boardId] as const,
  members: (boardId: string) =>
    [...boardKeys.all, 'detail', boardId, 'members'] as const,
};
