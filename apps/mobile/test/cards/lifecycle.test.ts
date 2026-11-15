import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryObserver } from '@tanstack/react-query';
import { cardTitle, createCardApi } from '../../src/features/cards/api.ts';
import { runCardMutation } from '../../src/features/cards/mutations.ts';
import {
  moveAnchor,
  readCardOrder,
} from '../../src/features/cards/ordering.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { BOARD, integration, json } from '../realtime/integration-support.ts';
import { page, uuid } from '../workspaces/fixtures.ts';
import {
  boardDetail,
  cardDto as card,
  column,
  timestamp,
} from '../workspaces/kanban-fixtures.ts';

const signal = new AbortController().signal;
const row = (index: number, columnId = column(1).id) => ({
  ...card(index, columnId),
  boardId: BOARD,
});
const success = (data: unknown, status = 200) =>
  json({ success: true, statusCode: status, message: 'OK', data }, status);
const failure = (status: number, code: string) =>
  json(
    {
      success: false,
      statusCode: status,
      message: 'Card error',
      code,
      details: [],
    },
    status,
  );
const writable = {
  ...boardDetail,
  id: BOARD,
  capabilities: { ...boardDetail.capabilities, canWriteBoard: true },
};

test('Card adapter enforces method, status, response relationships, allowed fields, nullable dates and anchors', async () => {
  const env = await integration();
  const first = row(1);
  const archived = { ...first, isArchived: true, archivedAt: timestamp };
  const copy = { ...row(2, column(2).id), title: first.title };
  const moved = {
    ...first,
    columnId: column(2).id,
    position: '9000000000.0000000001',
  };
  const path = `/api/boards/${BOARD}/cards`;
  const api = createCardApi(env.data.api, env.identity, BOARD);
  const steps = [
    ['GET', '', undefined, json(page([first], 1, 100))],
    ['GET', '', undefined, json(page([archived], 1, 100))],
    ['GET', `/${first.id}`, undefined, success(archived)],
    [
      'POST',
      '',
      { columnId: first.columnId, title: 'Ready', description: null },
      success(first, 201),
    ],
    [
      'PATCH',
      `/${first.id}`,
      { title: 'Changed', dueDate: null },
      success(first),
    ],
    [
      'PATCH',
      `/${first.id}/move`,
      { toColumnId: moved.columnId, beforeCardId: null },
      success(moved),
    ],
    [
      'POST',
      `/${first.id}/duplicate`,
      {},
      success({ ...copy, columnId: first.columnId }, 201),
    ],
    [
      'POST',
      `/${first.id}/duplicate`,
      { columnId: copy.columnId },
      success(copy, 201),
    ],
    ['POST', `/${first.id}/archive`, undefined, success(archived)],
    ['POST', `/${first.id}/restore`, undefined, success(first)],
  ] as const;
  let calls = 0;
  env.respond((url, init) => {
    const request = new URL(url);
    const [method, suffix, body, result] = steps[calls++]!;
    assert.equal(init.method, method);
    assert.equal(request.pathname, path + suffix);
    assert.deepEqual(
      init.body ? JSON.parse(String(init.body)) : undefined,
      body,
    );
    if (calls <= 2)
      assert.equal(
        request.searchParams.get('status'),
        calls === 1 ? 'active' : 'archived',
      );
    return Promise.resolve(result);
  });
  try {
    assert.equal((await api.listCards({}, 1, signal)).data[0]?.id, first.id);
    assert.equal(
      (await api.listArchivedCards(1, signal)).data[0]?.archivedAt,
      timestamp,
    );
    assert.equal((await api.getCard(first.id, signal)).isArchived, true);
    await api.create(
      { columnId: first.columnId, title: '  Ready ', description: null },
      signal,
    );
    await api.update(first.id, { title: ' Changed ', dueDate: null }, signal);
    assert.equal(
      (
        await api.move(
          first.id,
          { toColumnId: moved.columnId, beforeCardId: null },
          signal,
        )
      ).position,
      moved.position,
    );
    assert.notEqual(
      (await api.duplicate(first.id, undefined, signal)).id,
      first.id,
    );
    assert.equal(
      (await api.duplicate(first.id, copy.columnId, signal)).columnId,
      copy.columnId,
    );
    assert.equal((await api.archive(first.id, signal)).archivedAt, timestamp);
    assert.equal((await api.restore(first.id, signal)).isArchived, false);
    assert.throws(
      () =>
        api.move(
          first.id,
          { toColumnId: first.columnId, beforeCardId: first.id.toUpperCase() },
          signal,
        ),
      { status: 400 },
    );
    assert.throws(() => api.update(first.id, {}, signal), { status: 400 });
    assert.throws(
      () => api.update(first.id, { description: 'x'.repeat(2001) }, signal),
      { status: 400 },
    );
    assert.throws(
      () => api.update(first.id, { dueDate: '2026-11-15' }, signal),
      { status: 400 },
    );
    assert.equal(cardTitle('x'.repeat(120)).length, 120);
    for (const value of [' ', 'x'.repeat(121)])
      assert.throws(() => cardTitle(value), { status: 400 });
    assert.equal(calls, steps.length);
    for (const [status, code] of [
      [409, 'CARD_NOT_ARCHIVED'],
      [409, 'CARD_COLUMN_UNAVAILABLE'],
      [429, 'RATE_LIMITED'],
    ] as const) {
      env.respond(() => Promise.resolve(failure(status, code)));
      await assert.rejects(api.restore(first.id, signal), { status, code });
    }
    env.respond(() => Promise.resolve(failure(404, 'CARD_NOT_FOUND')));
    await assert.rejects(
      api.move(
        first.id,
        { toColumnId: first.columnId, beforeCardId: uuid(123) },
        signal,
      ),
      { code: 'CARD_NOT_FOUND' },
    );
    for (const invalid of [
      { ...first, boardId: uuid(111) },
      { ...first, id: uuid(123) },
      { ...first, position: 1 },
    ]) {
      env.respond(() => Promise.resolve(success(invalid)));
      await assert.rejects(api.getCard(first.id, signal), {
        kind: 'invalid-response',
      });
    }
    env.respond(() => Promise.resolve(success(first, 202)));
    await assert.rejects(api.getCard(first.id, signal), {
      kind: 'invalid-response',
    });
  } finally {
    env.dispose();
  }
});

test('fetches a bounded number of pages for a 251-Card destination and rejects drifting rank snapshots', async () => {
  const env = await integration();
  const rows = Array.from({ length: 251 }, (_, index) => row(index + 1));
  const reads: number[] = [];
  let overlap = false;
  const id = column(1).id;
  env.respond((url) => {
    const query = new URL(url).searchParams;
    assert.equal(query.get('columnId'), id);
    assert.equal(query.get('status'), 'active');
    assert.equal(query.get('limit'), '100');
    assert.equal(query.get('sortBy'), null);
    const number = Number(query.get('page'));
    reads.push(number);
    const result = page(rows, number, 100);
    if (overlap && number === 2) result.data[0] = rows[99]!;
    return Promise.resolve(json(result));
  });
  try {
    const api = createCardApi(env.data.api, env.identity, BOARD);
    const { ids } = await readCardOrder(api, id, signal);
    assert.deepEqual(reads, [1, 2, 3]);
    assert.equal(ids.length, 251);
    assert.equal(moveAnchor(ids, ids[0]!, 'up'), undefined);
    assert.equal(moveAnchor(ids, ids[0]!, 'down'), ids[2]);
    assert.equal(moveAnchor(ids, ids[100]!, 'up'), ids[99]);
    assert.equal(moveAnchor(ids, ids[249]!, 'down'), null);
    assert.equal(moveAnchor(ids, ids[250]!, 'bottom'), undefined);
    assert.equal(moveAnchor(ids, uuid(1), 'top'), ids[0]);
    assert.equal(moveAnchor([], uuid(1), 'bottom'), null);
    overlap = true;
    await assert.rejects(readCardOrder(api, id, signal), {
      code: 'CARD_ORDER_CHANGED',
    });
  } finally {
    env.dispose();
  }
});

test('revalidates stale ranks, fences pending moves and reconciles socket hints without crossing sessions', async () => {
  const env = await integration();
  await env.join();
  const identity = env.identity;
  const first = row(1);
  let rows = [first, row(2), row(3)];
  const response = deferred<Response>();
  let writes = 0;
  const api = createCardApi(env.data.api, identity, BOARD);
  const boardKey = queryKeys.board(identity, BOARD);
  const listKey = queryKeys.cards(identity, BOARD, { status: 'active' });
  const observer = new QueryObserver(env.data.queryClient, {
    queryKey: listKey,
    queryFn: ({ signal }) => api.listCards({}, 1, signal),
  });
  const stop = observer.subscribe(() => {});
  env.data.queryClient.setQueryData(boardKey, writable);
  env.respond((url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/cards'))
      return Promise.resolve(json(page(rows, 1, 100)));
    if (path.endsWith(`/${first.id}`)) {
      assert.equal(init.method, 'GET');
      return Promise.resolve(success(rows.find(({ id }) => id === first.id)));
    }
    if (path.endsWith('/move')) {
      writes++;
      assert.deepEqual(JSON.parse(String(init.body)), {
        toColumnId: first.columnId,
        beforeCardId: null,
      });
      return response.promise;
    }
    return null;
  });
  try {
    await observer.refetch();
    const requests = env.requests.length;
    await assert.rejects(
      runCardMutation(
        env.data,
        identity,
        BOARD,
        {
          kind: 'create',
          input: { columnId: first.columnId, title: '   ' },
        },
        signal,
      ),
      { code: 'INVALID_CARD_INPUT' },
    );
    assert.equal(env.requests.length, requests);
    const initial = await readCardOrder(api, first.columnId, signal);
    const command = {
      kind: 'move',
      id: first.id,
      fromColumnId: first.columnId,
      toColumnId: first.columnId,
      placement: { kind: 'bottom', revision: initial.revision },
    } as const;
    rows = [first, rows[2]!, { ...rows[1]!, position: '4.0000000000' }];
    await assert.rejects(
      runCardMutation(env.data, identity, BOARD, command, signal),
      { code: 'CARD_ORDER_CHANGED' },
    );
    assert.equal(writes, 0);
    const revision = (await readCardOrder(api, first.columnId, signal))
      .revision;
    const move = runCardMutation(
      env.data,
      identity,
      BOARD,
      { ...command, placement: { kind: 'bottom', revision } },
      signal,
    );
    await flush();
    assert.equal(writes, 1);
    await assert.rejects(
      runCardMutation(env.data, identity, BOARD, command, signal),
      { code: 'CARD_WRITE_PENDING' },
    );
    rows = [...rows.slice(1), { ...first, position: '5.0000000000' }];
    response.resolve(success(rows[2]));
    await move;
    assert.equal(observer.getCurrentResult().data?.data[2]?.id, first.id);

    rows = [{ ...first, title: 'Changed in Web' }, row(2), row(3)];
    env.socket.server('card:updated', {
      boardId: BOARD,
      cardId: first.id,
      columnId: first.columnId,
    });
    env.time.advance(50);
    await flush();
    assert.equal(
      observer.getCurrentResult().data?.data[0]?.title,
      'Changed in Web',
    );
    await assert.rejects(
      runCardMutation(
        env.data,
        identity,
        BOARD,
        {
          kind: 'update',
          id: first.id,
          patch: { title: 'Local draft' },
          expectedTitle: first.title,
        },
        signal,
      ),
      { code: 'CARD_TITLE_CHANGED' },
    );
    rows = [{ ...first, title: 'Recovered after reconnect' }, row(2), row(3)];
    env.environment(false, false);
    env.environment(true, true);
    await flush();
    env.socket.server('connect');
    await flush();
    env.socket.ack(
      env.socket.commands.findLastIndex(({ event }) => event === 'board:join'),
    );
    await flush();
    assert.equal(
      observer.getCurrentResult().data?.data[0]?.title,
      'Recovered after reconnect',
    );
    await env.manager.establishSession(loginResponse(USER_B));
    await assert.rejects(
      runCardMutation(env.data, identity, BOARD, command, signal),
      { kind: 'session-changed' },
    );
    assert.equal(env.data.queryClient.getQueryData(listKey), undefined);
    assert.equal(writes, 1);
  } finally {
    response.resolve(success(first));
    stop();
    env.dispose();
  }
});
