import type { MoveCardRequest } from '../cards/types';
import type { MoveColumnRequest } from '../columns/types';

/**
 * The order of columns and of the cards in each column, by id. Drag and drop
 * edits a copy of it; comparing it with the server's order gives the move to
 * send. Nothing here computes `position` values: the backend does that.
 */
export interface KanbanLayout {
  columns: string[];
  cards: Record<string, string[]>;
}

/* dnd-kit ids must be unique across columns and cards. */
const COLUMN = 'column:';
const CARD = 'card:';
export const columnDragId = (id: string) => `${COLUMN}${id}`;
export const cardDragId = (id: string) => `${CARD}${id}`;

export function parseDragId(
  dragId: string | number,
): { type: 'column' | 'card'; id: string } | null {
  const value = String(dragId);
  if (value.startsWith(COLUMN))
    return { type: 'column', id: value.slice(COLUMN.length) };
  if (value.startsWith(CARD))
    return { type: 'card', id: value.slice(CARD.length) };
  return null;
}

export function findCardColumn(
  layout: KanbanLayout,
  cardId: string,
): string | undefined {
  return layout.columns.find((columnId) =>
    layout.cards[columnId]?.includes(cardId),
  );
}

/** Moves an item of `list` from one index to another (a copy). */
export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/**
 * Puts `cardId` into `toColumnId` at `index` (clamped), taking it out of
 * wherever it was first.
 */
export function placeCard(
  layout: KanbanLayout,
  cardId: string,
  toColumnId: string,
  index: number,
): KanbanLayout {
  const cards: Record<string, string[]> = {};
  for (const columnId of layout.columns) {
    cards[columnId] = (layout.cards[columnId] ?? []).filter(
      (id) => id !== cardId,
    );
  }
  const target = cards[toColumnId] ?? [];
  const at = Math.max(0, Math.min(index, target.length));
  cards[toColumnId] = [...target.slice(0, at), cardId, ...target.slice(at)];
  return { columns: layout.columns, cards };
}

/**
 * The request that turns `before` into `after` for one card, or `null` when
 * the card ended up where it started (nothing to send). The anchor is the
 * card that follows it in its new column — never the card itself.
 */
export function cardMoveRequest(
  before: KanbanLayout,
  after: KanbanLayout,
  cardId: string,
): MoveCardRequest | null {
  const toColumnId = findCardColumn(after, cardId);
  const fromColumnId = findCardColumn(before, cardId);
  if (!toColumnId || !fromColumnId) return null;
  const list = after.cards[toColumnId];
  const index = list.indexOf(cardId);
  if (
    toColumnId === fromColumnId &&
    before.cards[fromColumnId].indexOf(cardId) === index
  ) {
    return null;
  }
  return { toColumnId, beforeCardId: list[index + 1] ?? null };
}

/** Like `cardMoveRequest`, for reordering columns. */
export function columnMoveRequest(
  before: string[],
  after: string[],
  columnId: string,
): MoveColumnRequest | null {
  const index = after.indexOf(columnId);
  if (index === -1 || before.indexOf(columnId) === index) return null;
  return { beforeColumnId: after[index + 1] ?? null };
}
