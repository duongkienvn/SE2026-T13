import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  inboxCommands,
  applyReadResponse,
} from '../../src/features/notifications/mutations.ts';
import { inboxOptions } from '../../src/features/notifications/queries.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { integration, ok, json } from '../realtime/integration-support.ts';
import { deferred, flush } from '../auth/support.ts';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { createMobileDataLayer } from '../../src/infrastructure/query/data-layer.ts';
import { notification, page } from './fixtures.ts';
const readAt = '2026-11-19T02:00:00Z';
test('a started offline failure is ambiguous while a preflight offline rejection is safe to retry', async () => {
  const env = await integration();
  let online = true;
  const data = createMobileDataLayer(
    env.manager,
    createHttpClient({
      baseUrl: new URL('https://offline.example.test/api'),
      isOnline: () => online,
      fetch: async () => {
        online = false;
        throw new TypeError('connection lost after send');
      },
    }),
  );
  try {
    const commands = inboxCommands(data, data.getIdentity()!);
    await assert.rejects(commands.readAll());
    assert.equal(commands.getSnapshot().mustReview, true);
    const secondData = createMobileDataLayer(
      env.manager,
      createHttpClient({
        baseUrl: new URL('https://offline.example.test/api'),
        isOnline: () => false,
        fetch: async () => {
          throw new Error('must not send');
        },
      }),
    );
    try {
      const beforeSend = inboxCommands(secondData, secondData.getIdentity()!);
      await assert.rejects(beforeSend.readAll());
      assert.equal(beforeSend.getSnapshot().mustReview, false);
    } finally {
      secondData.dispose();
    }
  } finally {
    data.dispose();
    env.dispose();
  }
});
test('one/read-all duplicate and overlapping submissions are blocked synchronously', async () => {
  const env = await integration();
  try {
    const response = deferred<Response>();
    env.respond(() => response.promise);
    const commands = inboxCommands(env.data, env.identity);
    const request = commands.read(notification().id);
    await assert.rejects(commands.read(notification().id));
    await assert.rejects(commands.readAll());
    assert.equal(env.requests.length, 1);
    response.resolve(ok(notification(1, { readAt })));
    await request;
    env.respond(() => Promise.resolve(ok({ updatedCount: 0 })));
    assert.equal(await commands.readAll(), 0);
    assert.equal(commands.getSnapshot().pending, null);
  } finally {
    env.dispose();
  }
});
test('read ACK changes only readAt and can never resurrect unavailable details', () => {
  const stub = notification(1, {
    isUnavailable: true,
    actor: null,
    context: null,
    target: null,
    summary: 'Unavailable',
  });
  const merged = applyReadResponse(stub, notification(1, { readAt }));
  assert.equal(merged.actor, null);
  assert.equal(merged.target, null);
  assert.equal(merged.summary, 'Unavailable');
  assert.equal(merged.readAt, readAt);
  assert.equal(
    applyReadResponse(
      notification(1, { readAt }),
      notification(1, { readAt: '2026-11-19T03:00:00Z' }),
    ).readAt,
    readAt,
  );
});
test('ambiguous writes stay blocked until fresh count and first page are both reviewed', async () => {
  const env = await integration();
  try {
    env.respond(() => Promise.resolve(json({}, 500)));
    const commands = inboxCommands(env.data, env.identity);
    await assert.rejects(commands.readAll());
    assert.equal(commands.getSnapshot().mustReview, true);
    const count = env.requests.length;
    await assert.rejects(commands.readAll());
    assert.equal(env.requests.length, count);
    await assert.rejects(commands.review('unread'));
    assert.equal(commands.getSnapshot().mustReview, true);
    env.respond((url) =>
      Promise.resolve(
        url.endsWith('/unread-count') ? ok({ count: 0 }) : json(page([])),
      ),
    );
    await commands.review('unread');
    assert.equal(commands.getSnapshot().mustReview, false);
    assert.equal(
      env.data.queryClient.getQueryData(queryKeys.unreadCount(env.identity)),
      0,
    );
  } finally {
    env.dispose();
  }
});
test('revocation during read ACK cannot put protected fields back into caches', async () => {
  const env = await integration();
  try {
    const key = inboxOptions(env.data, env.identity, 'all').queryKey;
    env.data.queryClient.setQueryData(key, {
      pages: [page([notification()])],
      pageParams: [1],
    });
    const response = deferred<Response>();
    env.respond(() => response.promise);
    const commands = inboxCommands(env.data, env.identity),
      request = commands.read(notification().id);
    await flush();
    env.data.evict(env.identity, [queryKeys.notifications(env.identity)]);
    response.resolve(ok(notification(1, { readAt })));
    await assert.rejects(request);
    assert.equal(env.data.queryClient.getQueryData(key), undefined);
    assert.equal(commands.getSnapshot().mustReview, true);
  } finally {
    env.dispose();
  }
});

test('a real timed-out write stays gated after its late response', async () => {
  const env = await integration();
  try {
    const response = deferred<Response>();
    env.respond(() => response.promise);
    const commands = inboxCommands(env.data, env.identity);
    const request = commands.readAll();
    const rejected = assert.rejects(request);
    await flush();
    env.time.advance(15_000);
    await flush();
    await rejected;
    assert.equal(commands.getSnapshot().mustReview, true);
    response.resolve(ok({ updatedCount: 1 }));
    await flush();
    assert.equal(commands.getSnapshot().mustReview, true);
    await assert.rejects(commands.readAll());
    assert.equal(
      env.requests.filter(({ url }) => url.endsWith('/read-all')).length,
      1,
    );
  } finally {
    env.dispose();
  }
});

test('read action 429 honors its deadline without automatically repeating the write', async (t) => {
  const env = await integration();
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  try {
    env.respond(() =>
      Promise.resolve(
        new Response('{}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '300' },
        }),
      ),
    );
    const commands = inboxCommands(env.data, env.identity);
    await assert.rejects(commands.readAll());
    assert.equal(commands.getSnapshot().mustReview, false);
    await assert.rejects(commands.readAll());
    assert.equal(env.requests.length, 1);
    commands.clearDefiniteError();
    await assert.rejects(commands.readAll());
    assert.equal(env.requests.length, 1);
    now += 300_000;
    env.respond(() => Promise.resolve(ok({ updatedCount: 0 })));
    await commands.readAll();
    assert.equal(env.requests.length, 2);
  } finally {
    env.dispose();
  }
});
