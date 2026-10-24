import { boardKeys } from '../boards/query-keys';

/** Under the board detail prefix, so a realtime resync also refreshes them. */
export const activityKeys = {
  board: (boardId: string) =>
    [...boardKeys.detail(boardId), 'activities'] as const,
  page: (boardId: string, page: number) =>
    [...activityKeys.board(boardId), page] as const,
};
