import type {
  ApiPaginatedResponse,
  CursorPaginationMeta,
  PaginationMeta,
} from '@kanban/shared';
import type { Envelope } from '../api/client.ts';
import { invalidResponse } from '../api/errors.ts';

/** Fetch only the next requested page; never eagerly walk a large Board. */
export function nextPage(meta: PaginationMeta): number | undefined {
  return meta.page < meta.totalPages ? meta.page + 1 : undefined;
}
export function nextCursor(meta: CursorPaginationMeta): string | undefined {
  return meta.nextCursor ?? undefined;
}
export function requirePage<T>(
  envelope: Envelope<T[]>,
): ApiPaginatedResponse<T> {
  if (
    !Array.isArray(envelope.data) ||
    !envelope.meta ||
    !('page' in envelope.meta)
  )
    throw invalidResponse(envelope.statusCode);
  return { ...envelope, meta: envelope.meta };
}

/** Keep server order; overlapping later pages refresh values at the same position. */
export function deduplicatePages<T extends { readonly id: string }>(
  pages: readonly (readonly T[])[],
): T[] {
  const items = new Map<string, T>();
  for (const page of pages) for (const item of page) items.set(item.id, item);
  return [...items.values()];
}
