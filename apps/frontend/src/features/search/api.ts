import type { GlobalSearchResults, GlobalSearchType } from '@kanban/shared';
import { apiRequest } from '../../lib/api-client';

export type SearchView = Exclude<GlobalSearchType, 'all'>;
export type SearchRequest =
  { q: string; type: 'all' } | { q: string; type: SearchView; page: number };

/** Grouped searches cannot carry a page; the server pages each group separately. */
export function globalSearch(
  accessToken: string,
  input: SearchRequest,
  signal: AbortSignal,
): Promise<GlobalSearchResults> {
  const params = new URLSearchParams({
    q: input.q,
    type: input.type,
    limit: input.type === 'all' ? '5' : '20',
  });
  if (input.type !== 'all') params.set('page', String(input.page));
  return apiRequest<GlobalSearchResults>(`/search?${params}`, {
    accessToken,
    signal,
  });
}
