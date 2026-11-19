import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInboxApi } from '../../src/features/notifications/api.ts';
import {
  inboxOptions,
  unreadOptions,
  inboxRows,
  pagesChanged,
} from '../../src/features/notifications/queries.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { notification, page } from './fixtures.ts';
test('Inbox uses bodyless exact contracts, complete page metadata and the shared session prefixes', async () => {
  const env = await integration();
  try {
    env.respond((input, init) => {
      const url = new URL(input);
      assert.equal(init.body, undefined);
      if (url.pathname === '/api/notifications') {
        assert.equal(url.searchParams.get('limit'), '20');
        assert.equal(url.searchParams.get('filter'), 'all');
        return Promise.resolve(json(page([notification()])));
      }
      return Promise.resolve(
        ok(
          url.pathname.endsWith('unread-count')
            ? { count: 101 }
            : url.pathname.endsWith('read-all')
              ? { updatedCount: 0 }
              : notification(1, { readAt: '2026-11-19T02:00:00Z' }),
        ),
      );
    });
    const api = createInboxApi(env.data.api, env.identity),
      signal = new AbortController().signal;
    assert.equal((await api.list('all', 1, signal)).meta.limit, 20);
    assert.equal(await api.count(signal), 101);
    assert.equal(await api.readAll(signal), 0);
    assert.ok((await api.read(notification().id, signal)).readAt);
    assert.deepEqual(
      inboxOptions(env.data, env.identity, 'all').queryKey.slice(0, 5),
      queryKeys.notifications(env.identity),
    );
    assert.deepEqual(
      unreadOptions(env.data, env.identity).queryKey,
      queryKeys.unreadCount(env.identity),
    );
    assert.equal(
      env.requests.find(({ url }) => url.endsWith('/read-all'))?.init.method,
      'POST',
    );
    assert.equal(
      env.requests.find(({ url }) => url.endsWith('/read'))?.init.method,
      'PATCH',
    );
  } finally {
    env.dispose();
  }
});
test('0/1/20/21/100+ pages validate requested windows, sorting and unread filters', async () => {
  const env = await integration();
  try {
    let response = page([]);
    env.respond(() => Promise.resolve(json(response)));
    const api = createInboxApi(env.data.api, env.identity),
      signal = new AbortController().signal;
    for (const total of [0, 1, 20, 21, 101]) {
      const rows = Array.from({ length: Math.min(20, total) }, (_, n) =>
        notification(200 - n),
      );
      response = page(rows, 1, total);
      assert.equal((await api.list('unread', 1, signal)).meta.total, total);
    }
    for (const bad of [
      page([notification()], 2),
      page([notification(1), notification(2)]),
      page([notification(1, { readAt: '2026-11-19T02:00:00Z' })]),
    ]) {
      response = bad;
      await assert.rejects(api.list('unread', 1, signal));
    }
    const p1 = page([notification(2)], 1, 21),
      p2 = page(
        [notification(2, { readAt: '2026-11-19T02:00:00Z' }), notification(1)],
        2,
        21,
      );
    assert.ok(inboxRows([p1, p2])[0]?.readAt);
    assert.equal(inboxRows([p1, p2]).length, 2);
    assert.equal(pagesChanged([p1, page([], 2, 1)]), true);
  } finally {
    env.dispose();
  }
});
