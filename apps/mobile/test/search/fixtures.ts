import type { GlobalSearchResults, GlobalSearchType } from '@kanban/shared';
import { BOARD, CARD, WORKSPACE } from '../realtime/integration-support.ts';

export const workspaceHit = {
  id: WORKSPACE,
  title: 'Design team',
  subtitle: null,
  type: 'workspace' as const,
  path: `/workspaces/${WORKSPACE}`,
};
export const boardHit = {
  id: BOARD,
  title: 'Design board',
  subtitle: null,
  type: 'board' as const,
  path: `/boards/${BOARD}`,
  workspaceId: WORKSPACE,
  workspaceName: null,
};
export const cardHit = {
  id: CARD,
  title: 'Design card',
  subtitle: 'A plain snippet',
  type: 'card' as const,
  path: `/boards/${BOARD}/cards/${CARD}`,
  boardId: BOARD,
  boardName: 'Design board',
  workspaceId: WORKSPACE,
  workspaceName: null,
};
export function results(
  type: GlobalSearchType = 'all',
  query = 'design',
): GlobalSearchResults {
  return {
    query,
    type,
    groups: {
      workspaces: {
        items: type === 'all' || type === 'workspaces' ? [workspaceHit] : [],
        total: type === 'all' || type === 'workspaces' ? 1 : 0,
        hasMore: false,
      },
      boards: {
        items: type === 'all' || type === 'boards' ? [boardHit] : [],
        total: type === 'all' || type === 'boards' ? 1 : 0,
        hasMore: false,
      },
      cards: {
        items: type === 'all' || type === 'cards' ? [cardHit] : [],
        total: type === 'all' || type === 'cards' ? 1 : 0,
        hasMore: false,
      },
    },
  };
}
