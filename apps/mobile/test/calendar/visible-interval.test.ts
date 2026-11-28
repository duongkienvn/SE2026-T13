import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  intersectDueRange,
  monthWindow,
  visibleDueInterval,
} from '../../src/features/calendar/interval.ts';
import { calendarCardOptions } from '../../src/features/calendar/queries.ts';
import { USER_A } from '../auth/support.ts';
import { boardId, cardDto } from '../workspaces/kanban-fixtures.ts';

type Card = Omit<ReturnType<typeof cardDto>, 'dueDate'> & {
  dueDate: string | null;
};
const identity = { userId: USER_A, generation: 1 };

/** Backend contract: dueFrom inclusive, dueTo exclusive, NULL never matches, OFFSET pages. */
function server(cards: Card[]) {
  const reads: Record<string, unknown>[] = [];
  const api = {
    async envelope(
      _path: string,
      decode: (value: unknown) => unknown,
      options: { query: Record<string, unknown> },
    ) {
      const query = options.query;
      reads.push(query);
      const from = query.dueFrom ? Date.parse(String(query.dueFrom)) : null;
      const to = query.dueTo ? Date.parse(String(query.dueTo)) : null;
      const matching = cards.filter(({ dueDate }) => {
        if (from === null && to === null) return true;
        if (dueDate === null) return false;
        const due = Date.parse(dueDate);
        return (from === null || due >= from) && (to === null || due < to);
      });
      const page = Number(query.page);
      const limit = Number(query.limit);
      return {
        success: true,
        statusCode: 200,
        message: 'OK',
        data: decode(matching.slice((page - 1) * limit, page * limit)),
        meta: {
          page,
          limit,
          total: matching.length,
          totalPages: Math.ceil(matching.length / limit),
        },
      };
    },
  };
  return { api: api as never, reads };
}

async function load(
  cards: Card[],
  interval?: ReturnType<typeof visibleDueInterval>,
  filters = {},
) {
  const { api, reads } = server(cards);
  const options = calendarCardOptions(
    api,
    identity,
    boardId,
    filters,
    interval,
  );
  const result = await (
    options.queryFn as (context: { signal: AbortSignal }) => Promise<Card[]>
  )({ signal: new AbortController().signal });
  return { ids: result.map(({ id }) => id), reads };
}

const undated = (count: number) =>
  Array.from({ length: count }, (_, index) => cardDto(index + 1));
const dated = (index: number, dueDate: string) => ({
  ...cardDto(index),
  dueDate,
});
const november = (zone: string) =>
  visibleDueInterval(monthWindow('2026-11'), zone);

test('P02 probe: 10,000 undated Cards took 101 reads to show nothing; the visible window takes 1', async () => {
  const cards = undated(10_000);
  const before = await load(cards);
  assert.equal(before.reads.length, 101); // 100 pages + page-1 drift check
  assert.equal(before.ids.length, 10_000); // all downloaded, all undated
  const after = await load(cards, november('Asia/Bangkok'));
  assert.equal(after.reads.length, 1);
  assert.deepEqual(after.ids, []);
});

test('mixed dated/undated and out-of-window Cards: complete in-window results, adjacent grid days included', async () => {
  const [first, last] = monthWindow('2026-11');
  // Nov 2026 starts on a Sunday: Monday grids start Oct 26; Sunday grids end Dec 5.
  assert.deepEqual([first, last], ['2026-10-26', '2026-12-06']);
  // Dec 2026 starts on a Tuesday: the Sunday grid starts first, the Monday grid ends last.
  assert.deepEqual(monthWindow('2026-12'), ['2026-11-29', '2027-01-03']);
  const inside = Array.from({ length: 150 }, (_, index) =>
    dated(
      20_000 + index,
      `2026-11-${String((index % 28) + 1).padStart(2, '0')}T05:00:00.000Z`,
    ),
  );
  const adjacent = [
    dated(30_001, '2026-10-25T17:00:00.000Z'), // 00:00 Oct 26 Bangkok (first grid day)
    dated(30_002, '2026-12-06T16:59:59.000Z'), // 23:59:59 Dec 6 Bangkok (last grid day)
  ];
  const outside = [
    dated(30_003, '2026-10-25T16:59:59.000Z'),
    dated(30_004, '2026-12-06T17:00:00.000Z'),
    dated(30_005, '2027-01-15T00:00:00.000Z'),
  ];
  const cards = [...undated(10_000), ...inside, ...adjacent, ...outside];
  const result = await load(cards, november('Asia/Bangkok'));
  const expected = [...inside, ...adjacent].map(({ id }) => id).sort();
  assert.deepEqual([...result.ids].sort(), expected);
  assert.equal(new Set(result.ids).size, result.ids.length);
  assert.equal(result.reads.length, 3); // 2 pages + drift check
  assert.deepEqual(result.reads[0]!.dueFrom, '2026-10-25T17:00:00.000Z');
  assert.deepEqual(result.reads[0]!.dueTo, '2026-12-06T17:00:00.000Z');
});

test('DST: New York November window spans the 25-hour day exactly', () => {
  const window = november('America/New_York');
  assert.deepEqual(window, {
    dueFrom: '2026-10-26T04:00:00.000Z', // midnight EDT
    dueTo: '2026-12-07T05:00:00.000Z', // midnight EST
  });
  // Spring forward: a zone whose midnight is skipped starts at the first real instant.
  const santiago = visibleDueInterval(
    ['2026-09-06', '2026-09-06'],
    'America/Santiago',
  );
  assert.equal(santiago.dueFrom, '2026-09-06T04:00:00.000Z');
  assert.equal(santiago.dueTo, '2026-09-07T03:00:00.000Z');
});

test('user due filters intersect the visible window; no overlap needs no request', async () => {
  const window = november('UTC');
  assert.deepEqual(
    intersectDueRange({ dueFrom: '2026-11-10T00:00:00.000Z' }, window),
    { dueFrom: '2026-11-10T00:00:00.000Z', dueTo: window.dueTo },
  );
  assert.deepEqual(
    intersectDueRange({ dueTo: '2027-01-01T00:00:00.000Z' }, window),
    { dueFrom: window.dueFrom, dueTo: window.dueTo },
  );
  assert.equal(
    intersectDueRange({ dueFrom: '2027-02-01T00:00:00.000Z' }, window),
    null,
  );
  const cards = [dated(1, '2026-11-12T00:00:00.000Z')];
  const empty = await load(cards, window, {
    dueFrom: '2027-02-01T00:00:00.000Z',
  });
  assert.equal(empty.reads.length, 0);
  assert.deepEqual(empty.ids, []);
  const narrowed = await load(cards, window, {
    dueFrom: '2026-11-12T00:00:00.000Z',
    dueTo: '2026-11-13T00:00:00.000Z',
  });
  assert.deepEqual(narrowed.ids, [cards[0]!.id]);
  assert.equal(narrowed.reads[0]!.dueFrom, '2026-11-12T00:00:00.000Z');
});

test('query identity includes the effective window and normalized filters', () => {
  const api = server([]).api;
  const key = (
    interval?: ReturnType<typeof visibleDueInterval>,
    filters = {},
  ) =>
    JSON.stringify(
      calendarCardOptions(api, identity, boardId, filters, interval).queryKey,
    );
  assert.notEqual(key(november('UTC')), key(november('Asia/Bangkok')));
  assert.notEqual(
    key(november('UTC')),
    key(visibleDueInterval(monthWindow('2026-12'), 'UTC')),
  );
  assert.equal(
    key(november('UTC'), { q: ' x ' }),
    key(november('UTC'), { q: 'x' }),
  );
  assert.notEqual(key(november('UTC')), key(undefined));
});
