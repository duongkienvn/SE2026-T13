import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integration } from '../realtime/integration-support.ts';
import { flush, deferred } from '../auth/support.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { InfiniteQueryObserver, QueryObserver } from '@tanstack/react-query';
import {
  inboxOptions,
  unreadOptions,
} from '../../src/features/notifications/queries.ts';
import { notification, page } from './fixtures.ts';
import { json, ok } from '../realtime/integration-support.ts';
test('hints during an in-flight read produce one trailing refresh without canceling it', async () => {
  const env = await integration(),
    stops: (() => void)[] = [];
  const response = deferred<Response>();
  let hold = false;
  try {
    env.socket.server('connect');
    env.respond((input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/unread-count'))
        return Promise.resolve(ok({ count: 1 }));
      if (url.pathname === '/api/notifications')
        return hold
          ? response.promise
          : Promise.resolve(json(page([notification()])));
      return null;
    });
    const list = new InfiniteQueryObserver(
      env.data.queryClient,
      inboxOptions(env.data, env.identity, 'all'),
    );
    const count = new QueryObserver(
      env.data.queryClient,
      unreadOptions(env.data, env.identity),
    );
    stops.push(
      list.subscribe(() => {}),
      count.subscribe(() => {}),
    );
    await flush();
    hold = true;
    env.socket.server('notifications:changed', {});
    env.time.advance(200);
    await flush();
    const pending = env.requests
      .filter(({ url }) => new URL(url).pathname === '/api/notifications')
      .at(-1)!;
    const before = env.requests.length;
    for (let i = 0; i < 4; i++) env.socket.server('notifications:changed', {});
    env.time.advance(200);
    await flush();
    assert.equal(pending.init.signal?.aborted, false);
    assert.equal(env.requests.length, before);
    hold = false;
    response.resolve(json(page([notification()])));
    await flush();
    env.time.advance(200);
    await flush();
    assert.equal(env.requests.length, before + 2);
    env.socket.server('notifications:changed', {});
    env.environment(false, true);
    env.time.advance(200);
    await flush();
    assert.equal(env.requests.length, before + 2);
  } finally {
    stops.forEach((stop) => stop());
    env.dispose();
  }
});

test('actual list/count data are fenced on revocation and resolve back to safe unavailable history', async () => {
  const env = await integration(),
    stops: (() => void)[] = [];
  let unavailable = false;
  try {
    await env.join();
    env.respond((input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/unread-count'))
        return Promise.resolve(ok({ count: 1 }));
      if (url.pathname === '/api/notifications')
        return Promise.resolve(
          json(
            page([
              notification(1, {
                isUnavailable: unavailable,
                summary: unavailable
                  ? 'This notification is no longer available'
                  : 'Private summary',
              }),
            ]),
          ),
        );
      return null;
    });
    const list = new InfiniteQueryObserver(
      env.data.queryClient,
      inboxOptions(env.data, env.identity, 'all'),
    );
    const count = new QueryObserver(
      env.data.queryClient,
      unreadOptions(env.data, env.identity),
    );
    stops.push(
      list.subscribe(() => {}),
      count.subscribe(() => {}),
    );
    await flush();
    assert.equal(
      list.getCurrentResult().data?.pages[0]?.data[0]?.actor?.displayName,
      'Teammate',
    );
    unavailable = true;
    env.socket.server('board:access-revoked', {
      boardId: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal(list.getCurrentResult().data, undefined);
    env.time.advance(50);
    await flush();
    const row = list.getCurrentResult().data?.pages[0]?.data[0];
    assert.equal(row?.actor, null);
    assert.equal(row?.context, null);
    assert.equal(row?.target, null);
    assert.equal(count.getCurrentResult().data, 1);
  } finally {
    stops.forEach((stop) => stop());
    env.dispose();
  }
});
test('a real two-page Inbox reconciles a remote read with only first-page and count requests', async () => {
  const env = await integration();
  const stops: (() => void)[] = [];
  let read = false;
  try {
    env.socket.server('connect');
    env.respond((input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/unread-count'))
        return Promise.resolve(ok({ count: read ? 1 : 21 }));
      if (url.pathname !== '/api/notifications') return null;
      const number = Number(url.searchParams.get('page'));
      const rows = Array.from({ length: 21 }, (_, n) =>
        notification(300 - n, {
          readAt: read && n < 20 ? '2026-11-19T02:00:00Z' : null,
        }),
      );
      return Promise.resolve(
        json(page(rows.slice((number - 1) * 20, number * 20), number, 21)),
      );
    });
    const list = new InfiniteQueryObserver(
      env.data.queryClient,
      inboxOptions(env.data, env.identity, 'all'),
    );
    const count = new QueryObserver(
      env.data.queryClient,
      unreadOptions(env.data, env.identity),
    );
    stops.push(
      list.subscribe(() => {}),
      count.subscribe(() => {}),
    );
    await flush();
    await list.fetchNextPage();
    assert.equal(list.getCurrentResult().data?.pages.length, 2);
    const before = env.requests.length;
    read = true;
    env.socket.server('notifications:changed', {});
    env.time.advance(150);
    env.time.advance(50);
    await flush();
    const reads = env.requests.slice(before);
    assert.deepEqual(
      reads
        .filter(({ url }) => new URL(url).pathname === '/api/notifications')
        .map(({ url }) => new URL(url).searchParams.get('page')),
      ['1'],
    );
    assert.equal(
      reads.filter(({ url }) => url.endsWith('/unread-count')).length,
      1,
    );
    assert.equal(list.getCurrentResult().data?.pages.length, 1);
    assert.equal(count.getCurrentResult().data, 1);
  } finally {
    stops.forEach((stop) => stop());
    env.dispose();
  }
});
test('notification hint bursts coalesce list/count REST refresh at 200ms without fabricating content', async () => {
  const env = await integration();
  try {
    env.socket.server('connect');
    const list = env.observe(
      queryKeys.notificationList(env.identity),
      'notification-list',
    );
    const count = env.observe(
      queryKeys.unreadCount(env.identity),
      'notification-count',
    );
    const before = env.requests.length;
    for (let i = 0; i < 5; i++) env.socket.server('notifications:changed', {});
    env.time.advance(149);
    await flush();
    assert.equal(env.requests.length, before);
    env.time.advance(1);
    env.time.advance(50);
    await flush();
    assert.equal(env.requests.length, before + 2);
    assert.equal(list.getCurrentResult().data, 1);
    assert.equal(count.getCurrentResult().data, 1);
    env.socket.server('notifications:changed', { id: 'untrusted-content' });
    env.time.advance(200);
    await flush();
    assert.equal(env.requests.length, before + 2);
  } finally {
    env.dispose();
  }
});
