import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IncompleteCalendarError,
  loadCalendarCards,
} from '../../src/features/calendar/queries.ts';
import { card } from '../workspaces/kanban-fixtures.ts';
import { page } from '../workspaces/fixtures.ts';

for (const total of [0, 1, 20, 21, 100, 101, 250, 351])
  test(`complete sequential Calendar pagination: ${total} Cards`, async () => {
    const rows = Array.from({ length: total }, (_, n) => card(n));
    const calls: number[] = [];
    const result = await loadCalendarCards(async (number) => {
      calls.push(number);
      return page(rows, number, 100);
    }, new AbortController().signal);
    assert.deepEqual(result, rows);
    const pages = Math.max(1, Math.ceil(total / 100));
    assert.deepEqual(calls, [
      ...Array.from({ length: pages }, (_, n) => n + 1),
      ...(pages > 1 ? [1] : []),
    ]);
  });

test('overlap/duplicate and changing total restart once; never publish incomplete counts', async () => {
  const rows = Array.from({ length: 101 }, (_, n) => card(n));
  const calls: number[] = [];
  await assert.rejects(
    loadCalendarCards(async (number) => {
      calls.push(number);
      const result = page(rows, number, 100);
      if (number === 2) result.data = [rows[0]!];
      return result;
    }, new AbortController().signal),
    IncompleteCalendarError,
  );
  assert.deepEqual(calls, [1, 2, 1, 2]);
  let attempt = 0;
  const recovered = await loadCalendarCards(async (number) => {
    if (number === 1) attempt++;
    return page(
      attempt === 1 && number === 2 ? rows.slice(0, 100) : rows,
      number,
      100,
    );
  }, new AbortController().signal);
  assert.equal(recovered.length, 101);
});

for (const failing of [1, 2, 3])
  test(`first/middle/last page ${failing} failure rejects whole dataset`, async () => {
    const rows = Array.from({ length: 250 }, (_, n) => card(n));
    const failure = new Error('unavailable');
    await assert.rejects(
      loadCalendarCards(async (number) => {
        if (number === failing) throw failure;
        return page(rows, number, 100);
      }, new AbortController().signal),
      (error) => error === failure,
    );
  });

test('missing final page, malformed metadata and cancellation cannot return partial Cards', async () => {
  const rows = Array.from({ length: 101 }, (_, n) => card(n));
  await assert.rejects(
    loadCalendarCards(
      async (n) => ({
        ...page(rows, n, 100),
        data: n === 2 ? [] : rows.slice(0, 100),
      }),
      new AbortController().signal,
    ),
    IncompleteCalendarError,
  );
  await assert.rejects(
    loadCalendarCards(
      async () => ({
        ...page(rows, 1, 100),
        meta: { page: 1, limit: 100, total: 101, totalPages: 1 },
      }),
      new AbortController().signal,
    ),
  );
  const abort = new AbortController();
  const calls: number[] = [];
  await assert.rejects(
    loadCalendarCards(async (n) => {
      calls.push(n);
      abort.abort();
      return page(rows, n, 100);
    }, abort.signal),
    { kind: 'aborted' },
  );
  assert.deepEqual(calls, [1]);
});

test('first-page boundary verification catches same-total reorder during walk', async () => {
  const rows = Array.from({ length: 101 }, (_, n) => card(n));
  let reads = 0;
  await assert.rejects(
    loadCalendarCards(async (n) => {
      reads++;
      const result = page(rows, n, 100);
      if (n === 1 && reads % 3 === 0) result.data.reverse();
      return result;
    }, new AbortController().signal),
    IncompleteCalendarError,
  );
  assert.equal(reads, 6);
});
