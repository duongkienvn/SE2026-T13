import { describe, expect, it } from 'vitest';
import type { Card } from '../cards/types';
import { calendarDays, cardsByDueDay } from './calendar';

describe('month calendar', () => {
  it('starts on Sunday and includes leap days and adjacent dates', () => {
    const days = calendarDays(2024, 1);
    expect(days[0]).toBe('2024-01-28');
    expect(days).toContain('2024-02-29');
    expect(days.at(-1)).toBe('2024-03-02');
    expect(calendarDays(2026, 7)).toHaveLength(42);
  });

  it('groups due instants in the selected zone, including DST and month boundaries', () => {
    const card = (id: string, dueDate: string | null, isArchived = false) =>
      ({ id, dueDate, isArchived }) as Card;
    const cards = [
      card('a', '2024-03-10T06:30:00Z'),
      card('b', '2024-03-10T07:30:00Z'),
      card('c', '2024-03-01T00:30:00Z'),
      card('none', null),
      card('archived', '2024-03-10T07:30:00Z', true),
    ];
    const eastern = cardsByDueDay([...cards, cards[0]], 'America/New_York');
    expect(eastern.get('2024-03-10')?.map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
    expect(eastern.get('2024-02-29')?.[0].id).toBe('c');
    expect(
      cardsByDueDay(cards, 'Asia/Ho_Chi_Minh').get('2024-03-01')?.[0].id,
    ).toBe('c');
    expect([...eastern.values()].flat()).toHaveLength(3);
  });

  it('keeps both repeated fall-back instants on the same local day', () => {
    const cards = [
      { id: 'before', dueDate: '2024-11-03T05:30:00Z', isArchived: false },
      { id: 'after', dueDate: '2024-11-03T06:30:00Z', isArchived: false },
    ] as Card[];
    expect(
      cardsByDueDay(cards, 'America/New_York')
        .get('2024-11-03')
        ?.map((card) => card.id),
    ).toEqual(['before', 'after']);
  });
});
