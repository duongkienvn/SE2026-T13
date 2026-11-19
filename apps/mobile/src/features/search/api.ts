import type { GlobalSearchResults } from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { decodeSearch } from './decoder.ts';
import { searchRequest, type SearchRequest } from './input.ts';

export function createSearchApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  return {
    async list(
      input: SearchRequest,
      signal: AbortSignal,
    ): Promise<GlobalSearchResults> {
      const request = searchRequest(
        input.q,
        input.type,
        input.page,
        input.limit,
      );
      if (!request.q)
        return {
          query: '',
          type: request.type,
          groups: {
            workspaces: { items: [], total: 0, hasMore: false },
            boards: { items: [], total: 0, hasMore: false },
            cards: { items: [], total: 0, hasMore: false },
          },
        };
      return api.json('/search', (value) => decodeSearch(value, request), {
        identity,
        resourceKey: queryKeys.search(identity),
        signal,
        query: { ...request },
        expectedStatus: 200,
        retries: 0,
      });
    },
  };
}
