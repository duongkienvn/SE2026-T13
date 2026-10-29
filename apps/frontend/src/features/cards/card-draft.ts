import type { QueryClient } from '@tanstack/react-query';

export interface CardDraft {
  readonly saved: {
    readonly title: string;
    readonly description: string | null;
    readonly dueDate: string | null;
  };
  readonly title: string;
  readonly description: string;
  readonly dueDay: string;
}

export const cardDraftKey = (boardId: string, cardId: string) =>
  ['card-draft', boardId.toLowerCase(), cardId.toLowerCase()] as const;

export function clearBoardDrafts(client: QueryClient, boardId: string): void {
  client.removeQueries({ queryKey: ['card-draft', boardId.toLowerCase()] });
}
