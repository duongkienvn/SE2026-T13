import { compareByPosition } from '../../lib/position';
import type { Column } from '../columns/types';
import type { Card } from './types';

/**
 * Columns in board order, each with its active cards in column order. Cards
 * whose column is not in the list (for example one deleted meanwhile) are
 * left out.
 */
export function groupCardsByColumn(
  columns: Column[],
  cards: Card[],
): { column: Column; cards: Card[] }[] {
  const byColumn = new Map<string, Card[]>(
    columns.map((column) => [column.id, []]),
  );
  for (const card of cards) {
    if (!card.isArchived) byColumn.get(card.columnId)?.push(card);
  }
  return [...columns].sort(compareByPosition).map((column) => ({
    column,
    cards: byColumn.get(column.id)!.sort(compareByPosition),
  }));
}
