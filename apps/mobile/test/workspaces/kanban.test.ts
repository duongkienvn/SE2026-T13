import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InfiniteQueryObserver, partialMatchKey } from '@tanstack/react-query';
import {
  createKanbanApi,
  decodeKanbanBoard,
  decodeKanbanCard,
  decodeKanbanColumn,
  decodePreviewBatch,
  normalizeKanbanFilters,
} from '../../src/features/boards/kanban-api.ts';
import {
  compareKanbanPosition,
  groupKanbanCards,
  kanbanCollection,
  previewBatches,
} from '../../src/features/boards/kanban-model.ts';
import { kanbanCardOptions } from '../../src/features/boards/kanban-queries.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { hintTargets } from '../../src/infrastructure/realtime/reconciliation.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import {
  BOARD,
  integration,
  json,
  ok,
} from '../realtime/integration-support.ts';
import {
  boardDetail,
  boardId,
  card,
  column,
  preview,
} from './kanban-fixtures.ts';
import { page, uuid } from './fixtures.ts';

test('decoders reject malformed and cross-Board data and keep server capabilities', () => {
  assert.equal(
    decodeKanbanBoard(boardDetail, boardId)?.capabilities.canWriteBoard,
    false,
  );
  assert.equal(
    decodeKanbanBoard(
      {
        ...boardDetail,
        capabilities: { ...boardDetail.capabilities, canReadBoard: false },
      },
      boardId,
    ),
    null,
  );
  assert.throws(() => decodeKanbanBoard(boardDetail, uuid(99)));
  assert.throws(() =>
    decodeKanbanBoard({ ...boardDetail, capabilities: {} }, boardId),
  );
  assert.throws(() =>
    decodeKanbanColumn({ ...column(1), position: 1 }, boardId),
  );
  assert.throws(() =>
    decodeKanbanColumn({ ...column(1), boardId: uuid(99) }, boardId),
  );
  const filters = normalizeKanbanFilters({});
  assert.deepEqual(decodeKanbanCard(card(1), boardId, filters), card(1));
  assert.throws(() =>
    decodeKanbanCard({ ...card(1), dueDate: '2026-11-13' }, boardId, filters),
  );
  assert.throws(() =>
    decodeKanbanCard({ ...card(1), isArchived: true }, boardId, filters),
  );
  const summary = preview(card(1).id);
  assert.deepEqual(
    decodePreviewBatch({ summaries: [summary] }, [summary.cardId]),
    [summary],
  );
  assert.throws(() =>
    decodePreviewBatch({ summaries: [summary] }, [card(2).id]),
  );
  assert.throws(() =>
    decodePreviewBatch({ summaries: [summary, summary] }, [
      summary.cardId,
      card(2).id,
    ]),
  );
  assert.throws(() =>
    decodePreviewBatch({ summaries: [{ ...summary, attachmentCount: -1 }] }, [
      summary.cardId,
    ]),
  );
  assert.throws(() =>
    decodePreviewBatch(
      {
        summaries: [
          { ...summary, checklist: { checkedItems: 2, totalItems: 1 } },
        ],
      },
      [summary.cardId],
    ),
  );
});

test('filters normalize literal search, unordered CSV selections, instants and default order', () => {
  const ids = [uuid(10), uuid(1), uuid(10).toUpperCase()];
  const result = normalizeKanbanFilters({
    q: '  %_literal ',
    labelIds: ids,
    assigneeIds: ids,
    dueStatus: 'DUE_TODAY',
    dueFrom: '2026-11-13T07:00+07:00',
    dueTo: '2026-11-14T07:00+07:00',
  });
  assert.equal(result.q, '%_literal');
  assert.equal(result.labelIds, `${uuid(1)},${uuid(10)}`);
  assert.equal(result.assigneeIds, result.labelIds);
  assert.equal(result.dueFrom, '2026-11-13T00:00:00.000Z');
  assert.equal(result.dueTo, '2026-11-14T00:00:00.000Z');
  assert.equal(result.status, 'active');
  assert.equal(result.sortBy, undefined);
  assert.equal(
    normalizeKanbanFilters({ sortBy: 'dueDate' }).sortDirection,
    'asc',
  );
  assert.throws(() => normalizeKanbanFilters({ dueFrom: '2026-11-13T07:00' }));
  assert.throws(() =>
    normalizeKanbanFilters({ dueFrom: result.dueTo, dueTo: result.dueFrom }),
  );
  assert.throws(() => normalizeKanbanFilters({ assigneeIds: ['fake'] }));
  assert.throws(() =>
    normalizeKanbanFilters({
      labelIds: Array.from({ length: 51 }, (_, i) => uuid(i)),
    }),
  );
});

test('collections retain precision, stable tie-breaks, honest partial counts and drift detection', () => {
  const columns = [
    column(1, '9999999999.0000000002'),
    column(3, '9999999999.0000000001'),
    column(2, '9999999999.0000000001'),
  ];
  assert.deepEqual(
    columns.sort(compareKanbanPosition).map(({ name }) => name),
    ['Column 2', 'Column 3', 'Column 1'],
  );
  const cards = [card(2), card(1)];
  assert.deepEqual(groupKanbanCards(cards, false).get(column(1).id), [
    card(1),
    card(2),
  ]);
  assert.deepEqual(groupKanbanCards(cards, true).get(column(1).id), cards);
  const rows = Array.from({ length: 101 }, (_, i) => card(i + 1));
  const first = page(rows, 1, 100);
  const second = page(rows, 2, 100);
  assert.equal(kanbanCollection([first]).complete, false);
  assert.equal(kanbanCollection([first, second]).complete, true);
  const overlap = kanbanCollection([first, { ...second, data: [rows[99]!] }]);
  assert.equal(overlap.items.length, 100);
  assert.equal(overlap.drift, true);
  assert.equal(overlap.complete, false);
  assert.deepEqual(
    previewBatches([first, second]).map((batch) => batch.length),
    [100, 1],
  );
  assert.equal(kanbanCollection([page([], 1, 100)]).complete, true);
});

test('card-scoped hints match only summary batches holding that Card in the same Board and session', async () => {
  const c = await integration();
  try {
    const identity = c.identity;
    const hint = { boardId, cardId: card(1).id };
    const targets = hintTargets(identity, 'comment:created', hint);
    const match = (
      ids: string[],
      id = boardId,
      generation = identity.generation,
    ) =>
      targets.some((key) =>
        partialMatchKey(
          queryKeys.previewBatch({ ...identity, generation }, id, ids),
          key,
        ),
      );
    assert.equal(match([card(1).id, card(2).id]), true);
    assert.equal(match([card(2).id]), false);
    assert.equal(match([card(1).id], BOARD), false);
    assert.equal(match([card(1).id], boardId, identity.generation + 1), false);
  } finally {
    c.dispose();
  }
});

test('infinite REST reconciliation restarts at page one after a move and cancels stale in-flight pages on account change', async () => {
  const c = await integration();
  const firstColumn = column(1).id;
  const secondColumn = column(2).id;
  let rows = Array.from({ length: 251 }, (_, i) => ({
    ...card(i + 1),
    boardId: BOARD,
  }));
  const requests: number[] = [];
  const options = kanbanCardOptions(c.data.api, c.identity, BOARD, {
    q: ' Card ',
    dueStatus: 'UPCOMING',
  });
  let slow: ReturnType<typeof deferred<Response>> | undefined;
  c.respond((request) => {
    const url = new URL(request);
    if (url.pathname !== `/api/boards/${BOARD}/cards`) return null;
    assert.equal(url.searchParams.get('q'), 'Card');
    assert.equal(url.searchParams.get('dueStatus'), 'UPCOMING');
    assert.equal(url.searchParams.get('status'), 'active');
    assert.equal(url.searchParams.get('sortBy'), null);
    const number = Number(url.searchParams.get('page'));
    requests.push(number);
    return slow?.promise ?? Promise.resolve(json(page(rows, number, 100)));
  });
  let stop: (() => void) | undefined;
  try {
    await c.join();
    const observer = new InfiniteQueryObserver(c.data.queryClient, options);
    stop = observer.subscribe(() => {});
    await observer.refetch();
    await observer.fetchNextPage();
    assert.deepEqual(requests.slice(-2), [1, 2]);
    assert.equal(
      kanbanCollection(observer.getCurrentResult().data!.pages).items.length,
      200,
    );
    const moved = { ...rows[0]!, columnId: secondColumn };
    rows = [...rows.slice(1), moved];
    c.socket.server('card:moved', {
      boardId: BOARD,
      cardId: moved.id,
      columnId: secondColumn,
      fromColumnId: firstColumn,
      toColumnId: secondColumn,
    });
    c.time.advance(50);
    await flush();
    assert.deepEqual(requests.slice(-2), [1, 2]);
    await observer.fetchNextPage();
    const result = kanbanCollection(observer.getCurrentResult().data!.pages);
    assert.equal(result.items.length, 251);
    assert.equal(result.complete, true);
    assert.equal(result.items.at(-1)?.columnId, secondColumn);
    slow = deferred<Response>();
    const pending = observer.refetch();
    await flush();
    await c.manager.establishSession(loginResponse(USER_B));
    slow.resolve(json(page(rows, 1, 100)));
    await pending;
    assert.equal(c.data.queryClient.getQueryData(options.queryKey), undefined);
  } finally {
    slow?.resolve(json(page(rows, 1, 100)));
    stop?.();
    c.dispose();
  }
});

test('preview HTTP adapter sends one bounded request and rejects oversized IDs and malformed page meta', async () => {
  const c = await integration();
  try {
    const api = createKanbanApi(c.data.api, c.identity, boardId);
    const ids = Array.from({ length: 100 }, (_, i) => card(i).id);
    c.respond((request) => {
      const url = new URL(request);
      if (url.pathname.endsWith('/card-preview-summaries')) {
        assert.deepEqual(url.searchParams.get('cardIds')?.split(','), ids);
        return Promise.resolve(ok({ summaries: ids.map(preview) }));
      }
      return Promise.resolve(
        json({
          ...page([column(1)], 1, 100),
          meta: { page: 2, limit: 100, total: 1, totalPages: 1 },
        }),
      );
    });
    const signal = new AbortController().signal;
    assert.equal((await api.previews(ids, signal)).length, 100);
    assert.equal(c.requests.length, 1);
    assert.throws(() => api.previews([...ids, card(101).id], signal));
    await assert.rejects(api.columns(1, signal), { kind: 'invalid-response' });
  } finally {
    c.dispose();
  }
});

for (const sortBy of ['title', 'dueDate'] as const) {
  for (const sortDirection of ['asc', 'desc'] as const) {
    test(`Table forwards every supported predicate with ${sortBy}/${sortDirection} on all server pages`, async () => {
      const c = await integration();
      try {
        const filters = {
          q: ' literal_% ',
          columnId: column(1).id.toUpperCase(),
          labelIds: [uuid(11).toUpperCase(), uuid(10), uuid(11)],
          assigneeIds: [uuid(20)],
          dueStatus: 'UPCOMING' as const,
          dueFrom: '2026-11-16T07:00:00+07:00',
          dueTo: '2026-11-30T07:00:00+07:00',
          status: 'active' as const,
          sortBy,
          sortDirection,
        };
        // Deliberately non-position order: Table must keep the server's sequence,
        // including null deadlines at the end in either direction.
        const rows = Array.from({ length: 251 }, (_, index) => ({
          ...card(251 - index),
          dueDate: index > 240 ? null : '2026-11-20T00:00:00.000Z',
        }));
        const requests: Record<string, string>[] = [];
        c.respond((request) => {
          const url = new URL(request);
          requests.push(Object.fromEntries(url.searchParams));
          return Promise.resolve(
            json(page(rows, Number(url.searchParams.get('page')), 100)),
          );
        });
        const options = kanbanCardOptions(
          c.data.api,
          c.identity,
          boardId,
          filters,
        );
        const observer = new InfiniteQueryObserver(c.data.queryClient, {
          ...options,
          enabled: false,
        });
        await observer.refetch();
        await observer.fetchNextPage();
        await observer.fetchNextPage();
        const result = kanbanCollection(
          observer.getCurrentResult().data!.pages,
        );
        assert.equal(result.total, 251);
        assert.equal(result.complete, true);
        assert.deepEqual(result.items, rows);
        for (const [index, query] of requests.entries())
          assert.deepEqual(query, {
            status: 'active',
            q: 'literal_%',
            columnId: column(1).id,
            labelIds: `${uuid(10)},${uuid(11)}`,
            assigneeIds: uuid(20),
            dueStatus: 'UPCOMING',
            dueFrom: '2026-11-16T00:00:00.000Z',
            dueTo: '2026-11-30T00:00:00.000Z',
            sortBy,
            sortDirection,
            page: String(index + 1),
            limit: '100',
          });
        assert.equal(requests.length, 3);
        observer.destroy();
      } finally {
        c.dispose();
      }
    });
  }
}
