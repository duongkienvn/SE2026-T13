import type { ApiPaginatedResponse } from '@kanban/shared';
import {
  deduplicatePages,
  nextPage,
} from '../../infrastructure/query/pagination.ts';
import type { KanbanCard, KanbanColumn } from './kanban-api.ts';

function scaled(position: string) {
  const [whole, fraction = ''] = position.replace(/^-/, '').split('.');
  return BigInt(
    `${position.startsWith('-') ? '-' : ''}${whole}${fraction.padEnd(10, '0')}`,
  );
}

export function compareKanbanPosition(
  a: KanbanColumn | KanbanCard,
  b: KanbanColumn | KanbanCard,
) {
  const left = scaled(a.position);
  const right = scaled(b.position);
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

type CollectionPage<T> = Pick<ApiPaginatedResponse<T>, 'data' | 'meta'>;

export function kanbanCollection<T extends { id: string }>(
  pages: readonly CollectionPage<T>[],
) {
  const items = deduplicatePages(pages.map((page) => page.data));
  const last = pages.at(-1);
  const total = last?.meta.total;
  const hasMore = !!last && nextPage(last.meta) !== undefined;
  // OFFSET pages can overlap or contract between requests. Never promote a
  // nonmatching collection to an exact count or an empty state.
  const drift =
    total !== undefined &&
    (pages.some((page) => page.meta.total !== total) ||
      pages.reduce((size, page) => size + page.data.length, 0) !==
        items.length ||
      (!hasMore && items.length !== total));
  return {
    items,
    total,
    hasMore,
    complete: total !== undefined && !hasMore && !drift,
    drift,
  };
}

export function groupKanbanCards(
  cards: readonly KanbanCard[],
  preserveServerSort: boolean,
) {
  const columns = new Map<string, KanbanCard[]>();
  for (const card of cards) {
    const group = columns.get(card.columnId);
    if (group) group.push(card);
    else columns.set(card.columnId, [card]);
  }
  if (!preserveServerSort)
    for (const group of columns.values()) group.sort(compareKanbanPosition);
  return columns;
}

/** Page-local membership keeps earlier batches stable as more pages load. */
export function previewBatches(pages: readonly CollectionPage<KanbanCard>[]) {
  const seen = new Set<string>();
  return pages.flatMap((page) => {
    const batch: string[] = [];
    for (const card of page.data) {
      if (card.isArchived || seen.has(card.id)) continue;
      seen.add(card.id);
      batch.push(card.id);
    }
    return batch.length ? [batch.sort()] : [];
  });
}
