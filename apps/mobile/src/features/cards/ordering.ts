import { ApiError } from '../../infrastructure/api/errors.ts';
import {
  compareKanbanPosition,
  kanbanCollection,
} from '../boards/kanban-model.ts';
import type { createCardApi } from './api.ts';

export type CardPlacement = 'top' | 'up' | 'down' | 'bottom';

export function moveAnchor(
  ids: readonly string[],
  cardId: string,
  placement: CardPlacement,
) {
  const from = ids.indexOf(cardId);
  const remaining = ids.filter((id) => id !== cardId);
  const to =
    placement === 'top'
      ? 0
      : placement === 'bottom'
        ? remaining.length
        : from < 0
          ? -1
          : from + (placement === 'up' ? -1 : 1);
  if (to < 0 || to > remaining.length || to === from) return undefined;
  return remaining[to] ?? null;
}

export function cardOrderChanged() {
  return new ApiError('http', {
    status: 409,
    code: 'CARD_ORDER_CHANGED',
    message: 'Card order changed. Check the latest positions before moving.',
  });
}

export async function readCardOrder(
  api: ReturnType<typeof createCardApi>,
  columnId: string,
  signal: AbortSignal,
) {
  const load = (page: number) =>
    api.listCards({ columnId, status: 'active' }, page, signal);
  const first = await load(1);
  const pages = [first];
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    const next = await load(page);
    if (next.meta.total !== first.meta.total) throw cardOrderChanged();
    pages.push(next);
  }
  const order = kanbanCollection(pages);
  if (
    !order.complete ||
    order.items.some(
      (card, index) =>
        index > 0 && compareKanbanPosition(order.items[index - 1]!, card) >= 0,
    )
  )
    throw cardOrderChanged();
  return {
    ids: order.items.map(({ id }) => id),
    revision: JSON.stringify(
      order.items.map(({ id, position }) => [id, position]),
    ),
  };
}
