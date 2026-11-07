import type { InvalidateQueryFilters, QueryKey } from '@tanstack/react-query';
import { boardKeys } from '../boards/query-keys';

/** Malformed or older keys retain the broad, correctness-safe fallback. */
export function previewSummaryContains(
  queryKey: QueryKey,
  cardIds: ReadonlySet<string>,
): boolean {
  const ids = queryKey[7];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
    return true;
  return ids.some((id: string) => cardIds.has(id.toLowerCase()));
}

export function previewSummaryFilters(
  boardId: string,
  cardId: string,
): InvalidateQueryFilters {
  const ids = new Set([cardId.toLowerCase()]);
  return {
    queryKey: [...boardKeys.cards(boardId), 'preview-summaries'],
    predicate: (query) => previewSummaryContains(query.queryKey, ids),
  };
}
