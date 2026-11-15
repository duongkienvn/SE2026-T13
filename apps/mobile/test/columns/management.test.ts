import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InfiniteQueryObserver } from '@tanstack/react-query';
import { columnName, createColumnApi } from '../../src/features/columns/api.ts';
import {
  canMutateColumns,
  columnMoveAnchor,
  isUncertainColumnWrite,
  runColumnMutation,
} from '../../src/features/columns/mutations.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { nextPage } from '../../src/infrastructure/query/pagination.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { BOARD, integration, json } from '../realtime/integration-support.ts';
import { boardDetail, column } from '../workspaces/kanban-fixtures.ts';
import { page, uuid } from '../workspaces/fixtures.ts';

const signal = new AbortController().signal;
const row = (index: number) => ({ ...column(index), boardId: BOARD });
const success = (data: unknown, status = 200) =>
  json({ success: true, statusCode: status, message: 'OK', data }, status);
const failure = (status: number, code: string) =>
  json(
    {
      success: false,
      statusCode: status,
      message: 'Column error',
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

test('validates names and derives nullable move anchors across loaded Board order', () => {
  assert.equal(columnName('  Planning  '), 'Planning');
  assert.equal(columnName('x'.repeat(120)).length, 120);
  for (const invalid of ['', '   ', 'x'.repeat(121)])
    assert.throws(() => columnName(invalid));
  const ids = Array.from({ length: 31 }, (_, i) => uuid(i + 1));
  assert.equal(columnMoveAnchor(ids, ids[0]!, 'left'), undefined);
  assert.equal(columnMoveAnchor(ids, ids[0]!, 'right'), ids[2]);
  assert.equal(columnMoveAnchor(ids, ids[15]!, 'left'), ids[14]);
  assert.equal(columnMoveAnchor(ids, ids[15]!, 'right'), ids[17]);
  assert.equal(columnMoveAnchor(ids, ids[30]!, 'left'), ids[29]);
  assert.equal(columnMoveAnchor(ids, ids[29]!, 'right'), null);
  assert.equal(columnMoveAnchor(ids, ids[30]!, 'right'), undefined);
  assert.equal(columnMoveAnchor(ids.slice(0, 1), ids[0]!, 'right'), undefined);
  assert.equal(columnMoveAnchor(ids.slice(0, 2), ids[0]!, 'right'), null);
  assert.equal(columnMoveAnchor(ids, uuid(100), 'left'), undefined);
  assert.equal(canMutateColumns(writable), true);
  assert.equal(canMutateColumns(boardDetail), false);
  assert.equal(canMutateColumns({ ...writable, isArchived: true }), false);
  assert.equal(canMutateColumns(null), false);
});

test('typed Column adapter uses exact verbs, paths, envelopes and empty body semantics', async () => {
  const c = await integration();
  const created = row(1);
  const path = `/api/boards/${BOARD}/columns`;
  try {
    const api = createColumnApi(c.data.api, c.identity, BOARD);
    let calls = 0;
    c.respond((url, init) => {
      const request = new URL(url);
      const body =
        typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      switch (calls++) {
        case 0:
          assert.equal(init.method, 'GET');
          assert.equal(request.pathname, path);
          assert.equal(request.searchParams.get('page'), '1');
          assert.equal(request.searchParams.get('limit'), '100');
          return Promise.resolve(json(page([created], 1, 100)));
        case 1:
          assert.equal(init.method, 'POST');
          assert.equal(request.pathname, path);
          assert.deepEqual(body, { name: 'Ready' });
          return Promise.resolve(success({ ...created, name: 'Ready' }, 201));
        case 2:
          assert.equal(init.method, 'PATCH');
          assert.equal(request.pathname, `${path}/${created.id}`);
          assert.deepEqual(body, { name: 'Review' });
          return Promise.resolve(success({ ...created, name: 'Review' }));
        case 3:
          assert.equal(init.method, 'PATCH');
          assert.equal(request.pathname, `${path}/${created.id}/move`);
          assert.deepEqual(body, { beforeColumnId: null });
          return Promise.resolve(
            success({ ...created, position: '9000000000.0000000001' }),
          );
        default:
          assert.equal(init.method, 'DELETE');
          assert.equal(request.pathname, `${path}/${created.id}`);
          assert.equal(body, undefined);
          return Promise.resolve(new Response(null, { status: 204 }));
      }
    });
    assert.equal((await api.list(1, signal)).data[0]?.id, created.id);
    assert.equal((await api.create('  Ready  ', signal)).name, 'Ready');
    assert.equal(
      (await api.rename(created.id, ' Review ', signal)).name,
      'Review',
    );
    assert.equal(
      (await api.move(created.id, null, signal)).position,
      '9000000000.0000000001',
    );
    assert.equal(await api.remove(created.id, signal), undefined);
    assert.throws(
      () => api.move(created.id, created.id.toUpperCase(), signal),
      { code: 'INVALID_COLUMN_MOVE' },
    );
    assert.throws(() => api.move(created.id, 'fake', signal), {
      code: 'INVALID_COLUMN_MOVE',
    });
    assert.throws(
      () => api.move(created.id, undefined as unknown as string, signal),
      { code: 'INVALID_COLUMN_MOVE' },
    );
    assert.throws(() => api.rename(created.id, '  ', signal), { status: 400 });
    assert.equal(calls, 5);
    c.respond(() => Promise.resolve(success(row(2))));
    await assert.rejects(api.rename(created.id, 'Renamed', signal), {
      kind: 'invalid-response',
    });
    c.respond(() => Promise.resolve(success(column(1), 201)));
    await assert.rejects(api.create('Wrong Board', signal), {
      kind: 'invalid-response',
    });
  } finally {
    c.dispose();
  }
});

test('write lock, server ordering, Web hints and reconnect converge on the authoritative list', async () => {
  const c = await integration();
  const first = row(1);
  const second = row(2);
  const third = row(3);
  const columns = queryKeys.columns(c.identity, BOARD);
  const api = createColumnApi(c.data.api, c.identity, BOARD);
  let rows = [first, second, third];
  let reads = 0;
  let writes = 0;
  const moved = deferred<Response>();
  c.respond((url, init) => {
    if (new URL(url).pathname.endsWith('/columns')) {
      reads++;
      return Promise.resolve(json(page(rows, 1, 100)));
    }
    if (url.endsWith('/move')) {
      writes++;
      assert.deepEqual(JSON.parse(String(init.body)), { beforeColumnId: null });
      return moved.promise;
    }
    return null;
  });
  try {
    await c.join();
    c.data.queryClient.setQueryData(
      queryKeys.board(c.identity, BOARD),
      writable,
    );
    const observer = new InfiniteQueryObserver(c.data.queryClient, {
      queryKey: columns,
      initialPageParam: 1,
      queryFn: ({ pageParam, signal }) => api.list(pageParam, signal),
      getNextPageParam: (value) => nextPage(value.meta),
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => {});
    try {
      await observer.refetch();
      const readsBeforeWrite = reads;
      const move = runColumnMutation(
        c.data,
        c.identity,
        BOARD,
        { kind: 'move', id: second.id, direction: 'right' },
        signal,
      );
      await flush();
      assert.equal(writes, 1);
      await assert.rejects(
        runColumnMutation(
          c.data,
          c.identity,
          BOARD,
          { kind: 'remove', id: third.id },
          signal,
        ),
        { code: 'COLUMN_WRITE_PENDING' },
      );
      assert.equal(
        observer.getCurrentResult().data?.pages[0]?.data[1]?.id,
        second.id,
      );
      // The server publishes an order different from the earlier mobile snapshot.
      rows = [third, first, { ...second, position: '4.0000000000' }];
      moved.resolve(success(rows[2]));
      assert.equal((await move).kind, 'moved');
      assert.equal(reads, readsBeforeWrite + 1);
      assert.deepEqual(
        observer.getCurrentResult().data?.pages[0]?.data.map(({ id }) => id),
        [third.id, first.id, second.id],
      );

      rows = [second, third, first];
      c.socket.server('column:moved', { boardId: BOARD, columnId: second.id });
      c.time.advance(50);
      await flush();
      assert.equal(
        observer.getCurrentResult().data?.pages[0]?.data[0]?.id,
        second.id,
      );
      c.environment(false, false);
      c.environment(true, true);
      await flush();
      rows = [first, second, third];
      c.socket.server('connect');
      await flush();
      c.socket.ack(
        c.socket.commands.findLastIndex(({ event }) => event === 'board:join'),
      );
      await flush();
      assert.equal(
        observer.getCurrentResult().data?.pages[0]?.data[0]?.id,
        first.id,
      );
    } finally {
      stop();
    }
  } finally {
    moved.resolve(success(second));
    c.dispose();
  }
});

test('denied, timed-out and stale-session writes cannot reproduce or cache a mutation', async () => {
  const c = await integration();
  const command = { kind: 'create' as const, name: 'Inbox' };
  const boardKey = queryKeys.board(c.identity, BOARD);
  const oldIdentity = c.identity;
  try {
    c.data.queryClient.setQueryData(boardKey, {
      ...writable,
      isArchived: true,
    });
    await assert.rejects(
      runColumnMutation(c.data, c.identity, BOARD, command, signal),
      { status: 403 },
    );
    assert.equal(c.requests.length, 0);
    c.data.queryClient.setQueryData(boardKey, writable);
    const api = createColumnApi(c.data.api, c.identity, BOARD);
    for (const [status, code] of [
      [403, 'FORBIDDEN'],
      [404, 'COLUMN_NOT_FOUND'],
      [409, 'COLUMN_NOT_EMPTY'],
      [429, 'TOO_MANY_REQUESTS'],
    ] as const) {
      c.respond(() => Promise.resolve(failure(status, code)));
      await assert.rejects(api.remove(row(1).id, signal), { status, code });
    }
    const gate = deferred<Response>();
    let postCount = 0;
    c.respond((_url, init) => {
      if (init.method === 'POST') {
        postCount++;
        return gate.promise;
      }
      return null;
    });
    const timedOut = runColumnMutation(
      c.data,
      c.identity,
      BOARD,
      command,
      signal,
    );
    const timeoutCheck = assert.rejects(
      timedOut,
      (error) =>
        error instanceof ApiError &&
        error.kind === 'timeout' &&
        isUncertainColumnWrite(error),
    );
    await flush();
    c.time.advance(15000);
    await timeoutCheck;
    assert.equal(postCount, 1);
    const stale = runColumnMutation(c.data, c.identity, BOARD, command, signal);
    const staleCheck = assert.rejects(stale, { kind: 'session-changed' });
    await flush();
    await c.manager.establishSession(loginResponse(USER_B));
    gate.resolve(success(row(1), 201));
    await staleCheck;
    assert.equal(
      c.data.queryClient.getQueryData(queryKeys.board(oldIdentity, BOARD)),
      undefined,
    );
    assert.equal(postCount, 2);
    c.respond(() => Promise.resolve(failure(401, 'UNAUTHORIZED')));
    await assert.rejects(
      createColumnApi(c.data.api, c.identity, BOARD).remove(row(1).id, signal),
      { status: 401 },
    );
    assert.equal(c.manager.getSnapshot().status, 'unauthenticated');
  } finally {
    c.dispose();
  }
});
