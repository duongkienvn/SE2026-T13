import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  monthDays,
  shiftSelectedMonth,
} from '../../src/features/calendar/month-grid.ts';
import {
  calendarToday,
  cardsByDueDay,
} from '../../src/features/calendar/due-groups.ts';
import { card } from '../workspaces/kanban-fixtures.ts';

test('28/29/30/31-day months contain each day, 35/42 cells, Mon/Sun and year edges', () => {
  for (const [month, days] of [
    ['2026-02', 28],
    ['2024-02', 29],
    ['2026-04', 30],
    ['2026-08', 31],
    ['2026-12', 31],
    ['2027-01', 31],
  ] as const) {
    for (const start of ['monday', 'sunday'] as const) {
      const grid = monthDays(month, start);
      assert.ok([35, 42].includes(grid.length));
      assert.equal(new Set(grid).size, grid.length);
      assert.equal(
        new Date(`${grid[0]}T12:00Z`).getUTCDay(),
        start === 'monday' ? 1 : 0,
      );
      assert.equal(grid.filter((day) => day.startsWith(month)).length, days);
      assert.ok(grid.includes(`${month}-01`));
      assert.ok(grid.includes(`${month}-${days}`));
    }
  }
  assert.equal(monthDays('2026-08').length, 42);
  assert.equal(monthDays('2026-02').length, 35);
  assert.equal(shiftSelectedMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftSelectedMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftSelectedMonth('2026-12-31', 1), '2027-01-31');
  assert.equal(shiftSelectedMonth('2027-01-31', -1), '2026-12-31');
  assert.throws(() => monthDays('2026-13'));
});

test('saved-zone Today uses explicit clock, UTC boundaries, DST gap/fold, never device zone', () => {
  const now = Date.parse('2026-01-01T00:30:00Z');
  assert.equal(calendarToday('America/Los_Angeles', now), '2025-12-31');
  assert.equal(calendarToday('Pacific/Kiritimati', now), '2026-01-01');
  for (const instant of ['2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z'])
    assert.equal(
      calendarToday('America/New_York', Date.parse(instant)),
      '2026-03-08',
    );
  for (const instant of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'])
    assert.equal(
      calendarToday('America/New_York', Date.parse(instant)),
      '2026-11-01',
    );
});

test('only active due Cards, absolute-instant order, UUID tie-break and latest-ID dedupe', () => {
  const due = (n: number, date: string) => ({ ...card(n), dueDate: date });
  const a = due(1, '2026-11-01T01:30:00-04:00');
  const b = due(2, '2026-11-01T01:30:00-04:00');
  const c = due(3, '2026-11-01T01:15:00-05:00');
  const rows = [
    c,
    b,
    a,
    { ...card(4), startDate: a.dueDate },
    { ...due(5, a.dueDate), isArchived: true },
    { ...a, dueDate: '2026-11-02T00:30:00Z' },
  ];
  const groups = cardsByDueDay(rows, 'America/New_York');
  assert.deepEqual(
    groups.get('2026-11-01')?.map(({ id }) => id),
    [b.id, c.id, a.id],
  );
  assert.equal([...groups.values()].flat().length, 3);
  assert.deepEqual(
    cardsByDueDay([b, a], 'UTC')
      .get('2026-11-01')
      ?.map(({ id }) => id),
    [a.id, b.id],
  );
  assert.equal(cardsByDueDay([rows.at(-1)!], 'UTC').has('2026-11-02'), true);
  assert.equal(a.dueDate, '2026-11-01T01:30:00-04:00');
});
