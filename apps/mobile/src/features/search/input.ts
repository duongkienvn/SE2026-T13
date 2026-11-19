import type { GlobalSearchType } from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';

export const searchTypes = ['all', 'workspaces', 'boards', 'cards'] as const;
export const searchGroups = ['workspaces', 'boards', 'cards'] as const;
export type SearchGroupName = (typeof searchGroups)[number];
export interface SearchRequest {
  q: string;
  type: GlobalSearchType;
  limit: number;
  page?: number;
}
export function searchInput(input: string) {
  const query = input.trim();
  return {
    query,
    error:
      query.includes('\0') || /[\uD800-\uDFFF]/u.test(query)
        ? 'Enter valid Unicode text without null characters.'
        : [...query].length > 120
          ? 'Search is limited to 120 characters.'
          : '',
  };
}
export function searchRequest(
  input: string,
  type: GlobalSearchType,
  page?: number,
  limit = type === 'all' ? 5 : 20,
): SearchRequest {
  const { query, error } = searchInput(input);
  if (
    error ||
    !searchTypes.includes(type) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > (type === 'all' ? 10 : 50) ||
    (type === 'all'
      ? page !== undefined
      : !Number.isSafeInteger(page ?? 1) ||
        (page ?? 1) < 1 ||
        !Number.isSafeInteger(((page ?? 1) - 1) * limit))
  )
    throw new ApiError('configuration');
  return type === 'all'
    ? { q: query, type, limit }
    : { q: query, type, limit, page: page ?? 1 };
}
