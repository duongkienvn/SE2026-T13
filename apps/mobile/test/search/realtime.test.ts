import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InfiniteQueryObserver } from '@tanstack/react-query';
import { searchOptions } from '../../src/features/search/queries.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import {
  integration,
  payload,
  BOARD,
  WORKSPACE,
  ok,
} from '../realtime/integration-support.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { results } from './fixtures.ts';

test('real Search queries reconcile coalesced Card hints and drop rows immediately on Board/Workspace revocation', async () => {
  for (const event of ['board:access-revoked', 'workspace:access-revoked']) {
    const env = await integration();
    let stop = () => {};
    try {
      await env.join();
      env.respond((url) =>
        new URL(url).pathname === '/api/search'
          ? Promise.resolve(ok(results()))
          : null,
      );
      const observer = new InfiniteQueryObserver(
        env.data.queryClient,
        searchOptions(env.data, env.identity, 'design', 'all'),
      );
      stop = observer.subscribe(() => {});
      await flush();
      assert.equal(
        observer.getCurrentResult().data?.pages[0]?.groups.cards.total,
        1,
      );
      const before = env.requests.filter(
        ({ url }) => new URL(url).pathname === '/api/search',
      ).length;
      for (let i = 0; i < 5; i++) env.socket.server('card:updated', payload);
      env.time.advance(50);
      await flush();
      assert.equal(
        env.requests.filter(
          ({ url }) => new URL(url).pathname === '/api/search',
        ).length,
        before + 1,
      );
      env.socket.server(event, { boardId: BOARD, workspaceId: WORKSPACE });
      assert.equal(observer.getCurrentResult().data, undefined);
    } finally {
      stop();
      env.dispose();
    }
  }
});

test('logout/account switch aborts ignored-abort Search and clears query text keys and cached pages', async () => {
  const env = await integration();
  try {
    const previousIdentity = env.identity;
    const response = deferred<Response>();
    env.respond(() => response.promise);
    const options = searchOptions(env.data, previousIdentity, 'design', 'all');
    const request = env.data.queryClient
      .fetchInfiniteQuery(options)
      .catch(() => undefined);
    await flush();
    await env.manager.establishSession(loginResponse(USER_B));
    response.resolve(ok(results()));
    await request;
    assert.equal(
      env.data.queryClient.getQueryData(options.queryKey),
      undefined,
    );
    assert.equal(
      env.data.queryClient
        .getQueryCache()
        .findAll({ queryKey: queryKeys.search(previousIdentity) }).length,
      0,
    );
    assert.notDeepEqual(
      searchOptions(env.data, env.identity, 'design', 'all').queryKey,
      options.queryKey,
    );
  } finally {
    env.dispose();
  }
});

test('reconnect evicts search aggregates before accepting fresh REST state', async () => {
  const env = await integration();
  try {
    await env.join();
    const options = searchOptions(env.data, env.identity, 'design', 'all');
    env.data.queryClient.setQueryData(options.queryKey, {
      pages: [results()],
      pageParams: [1],
    });
    env.environment(false, true);
    assert.equal(
      env.data.queryClient.getQueryData(options.queryKey),
      undefined,
    );
    env.environment(true, true);
    await flush();
    env.respond(() => Promise.resolve(ok(results())));
    await env.data.queryClient.fetchInfiniteQuery(options);
    assert.equal(
      env.data.queryClient.getQueryData(options.queryKey)?.pages[0]?.query,
      'design',
    );
  } finally {
    env.dispose();
  }
});
