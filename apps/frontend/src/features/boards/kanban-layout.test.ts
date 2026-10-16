import { describe, expect, it } from 'vitest';
import {
  arrayMove,
  cardDragId,
  cardMoveRequest,
  columnDragId,
  columnMoveRequest,
  parseDragId,
  placeCard,
  type KanbanLayout,
} from './kanban-layout';

const layout: KanbanLayout = {
  columns: ['A', 'B', 'C'],
  cards: { A: ['a1', 'a2', 'a3'], B: ['b1'], C: [] },
};

describe('drag ids', () => {
  it('keeps column and card ids apart', () => {
    expect(parseDragId(columnDragId('x'))).toEqual({ type: 'column', id: 'x' });
    expect(parseDragId(cardDragId('x'))).toEqual({ type: 'card', id: 'x' });
    expect(parseDragId('x')).toBeNull();
  });
});

describe('cardMoveRequest', () => {
  const move = (cardId: string, to: string, index: number) =>
    cardMoveRequest(layout, placeCard(layout, cardId, to, index), cardId);

  it('sends nothing when the card lands where it started', () => {
    expect(move('a2', 'A', 1)).toBeNull();
  });

  it('reorders within a column using the next card as anchor', () => {
    expect(move('a3', 'A', 0)).toEqual({ toColumnId: 'A', beforeCardId: 'a1' });
    expect(move('a1', 'A', 1)).toEqual({ toColumnId: 'A', beforeCardId: 'a3' });
  });

  it('moves to the end of a column with a null anchor', () => {
    expect(move('a1', 'A', 2)).toEqual({ toColumnId: 'A', beforeCardId: null });
    expect(move('a1', 'B', 5)).toEqual({ toColumnId: 'B', beforeCardId: null });
  });

  it('moves into the middle or top of another column', () => {
    expect(move('a2', 'B', 0)).toEqual({ toColumnId: 'B', beforeCardId: 'b1' });
  });

  it('moves into an empty column', () => {
    expect(move('b1', 'C', 0)).toEqual({ toColumnId: 'C', beforeCardId: null });
  });

  it('never uses the dragged card as its own anchor', () => {
    for (const to of layout.columns) {
      for (let index = 0; index <= 3; index += 1) {
        const request = move('a2', to, index);
        expect(request?.beforeCardId).not.toBe('a2');
      }
    }
  });
});

describe('placeCard', () => {
  it('removes the card from its old column and clamps the index', () => {
    expect(placeCard(layout, 'a1', 'C', 99).cards).toEqual({
      A: ['a2', 'a3'],
      B: ['b1'],
      C: ['a1'],
    });
    expect(layout.cards.A).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('columnMoveRequest', () => {
  const move = (from: number, to: number) =>
    columnMoveRequest(
      layout.columns,
      arrayMove(layout.columns, from, to),
      layout.columns[from],
    );

  it('sends nothing for a drop in place', () => {
    expect(move(1, 1)).toBeNull();
  });

  it('anchors on the next column, or null for the end', () => {
    expect(move(2, 0)).toEqual({ beforeColumnId: 'A' });
    expect(move(0, 1)).toEqual({ beforeColumnId: 'C' });
    expect(move(0, 2)).toEqual({ beforeColumnId: null });
  });
});
