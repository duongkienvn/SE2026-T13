import {
  STARTER_COLUMNS,
  STARTER_LABELS,
} from '../../src/api/boards/starter-board-template';

describe('Starter Board template', () => {
  it('provides the approved editable inventory and valid relative date ranges', () => {
    expect(STARTER_COLUMNS.map((column) => column.cards.length)).toEqual([
      3, 3, 2, 2,
    ]);
    const cards = STARTER_COLUMNS.flatMap((column) => column.cards);
    expect(new Set(cards.map((card) => card.title)).size).toBe(10);
    for (const card of cards) {
      expect(card.description.length).toBeGreaterThan(150);
      expect(card.checklist.items.length).toBeGreaterThanOrEqual(3);
      expect(card.checklist.items.length).toBeLessThanOrEqual(5);
      expect(card.checklist.checked).toBeLessThanOrEqual(
        card.checklist.items.length,
      );
      for (const name of card.labels)
        expect(STARTER_LABELS[name]).toMatch(/^#[0-9A-F]{6}$/);
      if (card.startDay !== undefined && card.dueDay !== undefined)
        expect(card.startDay).toBeLessThanOrEqual(card.dueDay);
    }
  });
});
