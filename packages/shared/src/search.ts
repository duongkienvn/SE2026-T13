import type { ApiSuccessResponse } from './api-response.js';

export const GlobalSearchType = {
  ALL: 'all',
  WORKSPACES: 'workspaces',
  BOARDS: 'boards',
  CARDS: 'cards',
} as const;
export type GlobalSearchType =
  (typeof GlobalSearchType)[keyof typeof GlobalSearchType];

export interface GlobalSearchQuery {
  q?: string;
  type?: GlobalSearchType;
  /** Only allowed for a specific type; default 1. */
  page?: number;
  /** all: default 5, max 10 per group; specific type: default 20, max 50. */
  limit?: number;
}

interface SearchItem {
  id: string;
  title: string;
  subtitle: string | null;
  path: string;
}
export interface WorkspaceSearchResult extends SearchItem {
  type: 'workspace';
  subtitle: null;
}
export interface BoardSearchResult extends SearchItem {
  type: 'board';
  workspaceId: string;
  workspaceName: string | null;
}
export interface CardSearchResult extends SearchItem {
  type: 'card';
  boardId: string;
  boardName: string;
  workspaceId: string;
  workspaceName: string | null;
}
export type GlobalSearchItem =
  WorkspaceSearchResult | BoardSearchResult | CardSearchResult;
export interface SearchGroup<T extends GlobalSearchItem> {
  items: T[];
  total: number;
  hasMore: boolean;
}
export interface GlobalSearchResults {
  query: string;
  type: GlobalSearchType;
  groups: {
    workspaces: SearchGroup<WorkspaceSearchResult>;
    boards: SearchGroup<BoardSearchResult>;
    cards: SearchGroup<CardSearchResult>;
  };
}
export type GlobalSearchResponse = ApiSuccessResponse<GlobalSearchResults>;
