import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryObserver, partialMatchKey } from '@tanstack/react-query';
import { calendarCardOptions } from '../../src/features/calendar/queries.ts';
import { cardsByDueDay } from '../../src/features/calendar/due-groups.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { BOARD, integration, json } from '../realtime/integration-support.ts';
import { card } from '../workspaces/kanban-fixtures.ts';
import { page, uuid } from '../workspaces/fixtures.ts';

const rows = (count: number, due = '2026-11-17T12:00:00.000Z') =>
  Array.from({ length: count }, (_, n) => ({
    ...card(n),
    boardId: BOARD,
    dueDate: due,
  }));

async function fixture() {
  const env = await integration();
  await env.join();
  return env;
}

test('server filters retain CSV OR sets, status=active, normalized keys and complete pagination', async () => {
  const env = await fixture();
  try {
    const data = rows(101);
    env.respond((url) =>
      url.includes('/cards?')
        ? Promise.resolve(
            json(
              page(data, Number(new URL(url).searchParams.get('page')), 100),
            ),
          )
        : null,
    );
    const filters = {
      q: ' title ',
      columnId: data[0]!.columnId,
      labelIds: [uuid(8), uuid(7), uuid(8)],
      assigneeIds: [uuid(10), uuid(9)],
      dueStatus: 'UPCOMING' as const,
    };
    const options = calendarCardOptions(
      env.data.api,
      env.identity,
      BOARD,
      filters,
    );
    assert.equal((await env.data.queryClient.fetchQuery(options)).length, 101);
    assert.ok(
      partialMatchKey(options.queryKey, queryKeys.cards(env.identity, BOARD)),
    );
    const reads = env.requests.filter(({ url }) => url.includes('/cards?'));
    assert.equal(reads.length, 3);
    for (const { url } of reads) {
      const params = new URL(url).searchParams;
      assert.equal(params.get('labelIds'), [uuid(7), uuid(8)].join(','));
      assert.equal(params.get('assigneeIds'), [uuid(9), uuid(10)].join(','));
      assert.equal(params.get('q'), 'title');
      assert.equal(params.get('status'), 'active');
      assert.equal(params.get('limit'), '100');
      assert.equal(params.get('dueStatus'), 'UPCOMING');
    }
  } finally {
    env.dispose();
  }
});

test('filter replacement cancels/fences stale middle page and starts at page one', async () => {
  const env = await fixture();
  try {
    const gate = deferred<Response>();
    const data = rows(101);
    env.respond((url) => {
      const parsed = new URL(url);
      if (!url.includes('/cards?')) return null;
      if (parsed.searchParams.get('q') === 'next')
        return Promise.resolve(json(page([], 1, 100)));
      return parsed.searchParams.get('page') === '2'
        ? gate.promise
        : Promise.resolve(json(page(data, 1, 100)));
    });
    const old = calendarCardOptions(env.data.api, env.identity, BOARD, {});
    const pending = env.data.queryClient
      .fetchQuery(old)
      .catch((error) => error);
    await flush();
    await env.data.queryClient.cancelQueries({
      queryKey: old.queryKey,
      exact: true,
    });
    const next = calendarCardOptions(env.data.api, env.identity, BOARD, {
      q: 'next',
    });
    assert.deepEqual(await env.data.queryClient.fetchQuery(next), []);
    gate.resolve(json(page(data, 2, 100)));
    await pending;
    assert.equal(env.data.queryClient.getQueryData(old.queryKey), undefined);
    assert.deepEqual(env.data.queryClient.getQueryData(next.queryKey), []);
  } finally {
    env.dispose();
  }
});

for (const action of ['revoke', 'switch', 'logout'] as const)
  test(`${action} aborts a late final page without restoring Card data`, async () => {
    const env = await fixture();
    try {
      const captured = env.identity;
      const gate = deferred<Response>();
      const data = rows(101);
      env.respond((url) =>
        url.includes('/cards?')
          ? new URL(url).searchParams.get('page') === '2'
            ? gate.promise
            : Promise.resolve(json(page(data, 1, 100)))
          : null,
      );
      const options = calendarCardOptions(env.data.api, captured, BOARD, {});
      const pending = env.data.queryClient
        .fetchQuery(options)
        .catch((error) => error);
      await flush();
      if (action === 'revoke') env.realtime.revokeBoard(BOARD);
      else if (action === 'switch')
        await env.manager.establishSession(loginResponse(USER_B));
      else await env.manager.logout();
      gate.resolve(json(page(data, 2, 100)));
      await pending;
      assert.equal(
        env.data.queryClient.getQueryData(options.queryKey),
        undefined,
      );
    } finally {
      env.dispose();
    }
  });

for (const status of [401, 403, 404, 429])
  test(`HTTP ${status} never promotes a partial dataset`, async () => {
    const env = await fixture();
    try {
      const data = rows(101);
      env.respond((url) =>
        url.includes('/cards?')
          ? Promise.resolve(
              new URL(url).searchParams.get('page') === '2'
                ? json({}, status)
                : json(page(data, 1, 100)),
            )
          : null,
      );
      const options = calendarCardOptions(
        env.data.api,
        env.identity,
        BOARD,
        {},
      );
      await assert.rejects(
        env.data.queryClient.fetchQuery(options),
        (error: unknown) =>
          status === 429
            ? (error as { status: number }).status === status
            : (error as Error).message === 'CancelledError',
      );
      assert.equal(
        env.data.queryClient.getQueryData(options.queryKey),
        undefined,
      );
      assert.equal(
        env.requests.filter(({ url }) => url.includes('/cards?')).length,
        2,
      );
    } finally {
      env.dispose();
    }
  });

test('real socket due-date hints coalesce into one complete REST walk and regroup; unrelated Boards do not refetch', async () => {
  const env = await fixture();
  let stop: (() => void) | undefined;
  try {
    let data = rows(101);
    env.respond((url) =>
      url.includes('/cards?')
        ? Promise.resolve(
            json(
              page(data, Number(new URL(url).searchParams.get('page')), 100),
            ),
          )
        : null,
    );
    const observer = new QueryObserver(
      env.data.queryClient,
      calendarCardOptions(env.data.api, env.identity, BOARD, {}),
    );
    stop = observer.subscribe(() => {});
    await flush();
    assert.equal(observer.getCurrentResult().data?.length, 101);
    const before = env.requests.filter(({ url }) =>
      url.includes('/cards?'),
    ).length;
    data = rows(101, '2026-11-18T12:00:00.000Z');
    for (let n = 0; n < 20; n++)
      env.socket.server('card:updated', {
        boardId: BOARD,
        cardId: data[0]!.id,
        columnId: data[0]!.columnId,
      });
    await env.time.advance(50);
    await flush();
    assert.equal(
      env.requests.filter(({ url }) => url.includes('/cards?')).length - before,
      3,
    );
    const groups = cardsByDueDay(observer.getCurrentResult().data ?? [], 'UTC');
    assert.equal(groups.get('2026-11-18')?.length, 101);
    assert.equal(groups.has('2026-11-17'), false);
    env.socket.server('card:updated', {
      boardId: uuid(999),
      cardId: data[0]!.id,
      columnId: data[0]!.columnId,
    });
    await env.time.advance(50);
    assert.equal(
      env.requests.filter(({ url }) => url.includes('/cards?')).length - before,
      3,
    );
  } finally {
    stop?.();
    env.dispose();
  }
});
