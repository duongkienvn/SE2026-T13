import { boardKeys } from '../boards/query-keys';

export const commentKeys = {
  card: (boardId: string, cardId: string) =>
    [...boardKeys.card(boardId, cardId), 'comments'] as const,
  page: (boardId: string, cardId: string, page: number) =>
    [...commentKeys.card(boardId, cardId), page] as const,
};
