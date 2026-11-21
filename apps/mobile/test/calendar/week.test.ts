import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  shiftSelectedWeek,
  weekCaption,
  weekDays,
} from '../../src/features/calendar/week.ts';
import { civilDate } from '../../src/features/calendar/month-grid.ts';

test('seven consecutive civil dates contain selection for Monday/Sunday, leap and year edges', () => {
  for (const selected of [
    '2026-12-30',
    '2027-01-01',
    '2024-02-29',
    '2026-02-28',
    '2026-03-08',
    '2026-11-01',
  ]) {
    for (const start of ['monday', 'sunday'] as const) {
      const days = weekDays(selected, start);
      assert.equal(days.length, 7);
      assert.equal(new Set(days).size, 7);
      assert.ok(days.includes(selected));
      assert.equal(civilDate(days[0]!).getUTCDay(), start === 'monday' ? 1 : 0);
      for (let index = 1; index < 7; index++)
        assert.equal(
          civilDate(days[index]!).getTime() -
            civilDate(days[index - 1]!).getTime(),
          86_400_000,
        );
    }
  }
  assert.deepEqual(weekDays('2026-12-30'), [
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ]);
  assert.ok(weekDays('2024-03-01').includes('2024-02-29'));
  assert.ok(!weekDays('2026-03-01').includes('2026-02-29'));
});

test('Wednesday +/-7 preserves weekday over year, leap, DST gap/fold without mutating instants', () => {
  for (const selected of [
    '2026-12-30',
    '2024-02-28',
    '2026-03-04',
    '2026-03-11',
    '2026-10-28',
    '2026-11-04',
  ]) {
    for (const delta of [-1, 1] as const) {
      const next = shiftSelectedWeek(selected, delta);
      assert.equal(civilDate(next).getUTCDay(), 3);
      assert.equal(shiftSelectedWeek(next, delta === 1 ? -1 : 1), selected);
    }
  }
  assert.equal(shiftSelectedWeek('2024-02-28', 1), '2024-03-06');
  assert.equal(shiftSelectedWeek('2026-12-30', 1), '2027-01-06');
  assert.throws(() => weekDays('2026-02-29'));
});

test('range caption makes cross-month and cross-year boundaries unambiguous', () => {
  assert.equal(weekCaption(weekDays('2026-11-17')), '16 Nov – 22 Nov 2026');
  assert.equal(weekCaption(weekDays('2026-11-30')), '30 Nov – 6 Dec 2026');
  assert.equal(weekCaption(weekDays('2026-12-30')), '28 Dec 2026 – 3 Jan 2027');
});
