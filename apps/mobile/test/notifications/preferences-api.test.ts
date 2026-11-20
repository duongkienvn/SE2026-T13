import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPreferencesApi,
  preferencesOptions,
} from '../../src/features/notifications/preferences/api.ts';
import { taskEmailEnabled } from '../../src/features/notifications/preferences/config.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { integration, ok } from '../realtime/integration-support.ts';
import { defaults } from './preferences-fixtures.ts';

test('GET/PATCH use exact existing envelopes, identity and sparse body without Inbox invalidation', async () => {
  const env = await integration();
  try {
    const server = defaults();
    server.email.cardAssigned = true;
    env.respond(async (url, init) => {
      assert.equal(
        new URL(url).pathname,
        '/api/users/me/notification-preferences',
      );
      if (init.method === 'PATCH') {
        assert.deepEqual(JSON.parse(init.body as string), {
          inApp: { cardAssigned: false },
        });
        server.inApp.cardAssigned = false;
      } else assert.equal(init.body, undefined);
      return ok(server);
    });
    const api = createPreferencesApi(env.data.api, env.identity, false),
      signal = new AbortController().signal;
    assert.deepEqual(
      await env.data.queryClient.fetchQuery(
        preferencesOptions(env.data, env.identity),
      ),
      server,
    );
    const unreadKey = queryKeys.unreadCount(env.identity);
    env.data.queryClient.setQueryData(unreadKey, 7);
    assert.deepEqual(
      await api.patch({ inApp: { cardAssigned: false } }, signal),
      server,
    );
    assert.equal(env.requests.length, 2);
    await assert.rejects(async () =>
      api.patch({ email: { cardAssigned: false } }, signal),
    );
    await assert.rejects(async () => api.patch({}, signal));
    assert.equal(env.requests.length, 2);
    assert.deepEqual(
      preferencesOptions(env.data, env.identity).queryKey,
      queryKeys.notificationPreferences(env.identity),
    );
    const unread = env.data.queryClient.getQueryState(unreadKey);
    assert.ok(unread);
    assert.equal(unread.data, 7);
    assert.equal(unread.isInvalidated, false);
  } finally {
    env.dispose();
  }
});

test('malformed authoritative response fails and 401 follows the existing session invalidation flow', async () => {
  const env = await integration();
  try {
    const identity = env.identity;
    env.respond(async () => ok({ ...defaults(), email: {} }));
    await assert.rejects(
      env.data.queryClient.fetchQuery(
        preferencesOptions(env.data, env.identity),
      ),
    );
    env.respond(async () => ok(defaults()));
    await env.data.queryClient.fetchQuery(
      preferencesOptions(env.data, identity),
    );
    const preferencesKey = queryKeys.notificationPreferences(identity);
    assert.deepEqual(
      env.data.queryClient.getQueryData(preferencesKey),
      defaults(),
    );
    assert.equal(
      env.data.queryClient.getQueryState(preferencesKey)?.status,
      'success',
    );
    env.respond(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            statusCode: 401,
            message: 'Sign in',
            code: 'UNAUTHORIZED',
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    );
    await assert.rejects(
      createPreferencesApi(env.data.api, env.identity, true).get(
        new AbortController().signal,
      ),
    );
    assert.equal(env.data.getIdentity(), null);
    assert.equal(env.data.queryClient.getQueryState(preferencesKey), undefined);
  } finally {
    env.dispose();
  }
});

test('public task-email flag is opt-in and never inferred from server values', () => {
  for (const flag of [undefined, '', 'false', '1', 'TRUE'])
    assert.equal(taskEmailEnabled(flag), false);
  assert.equal(taskEmailEnabled('true'), true);
});

test('GET rate limit cannot be bypassed by a new observer or direct refetch', async () => {
  const env = await integration();
  try {
    env.respond(
      async () =>
        new Response('{}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '60' },
        }),
    );
    await assert.rejects(
      env.data.queryClient.fetchQuery(
        preferencesOptions(env.data, env.identity),
      ),
    );
    await assert.rejects(
      env.data.queryClient.fetchQuery(
        preferencesOptions(env.data, env.identity),
      ),
    );
    assert.equal(env.requests.length, 1);
  } finally {
    env.dispose();
  }
});

test('preference response fences isolate own requests from Board aggregate access changes', async () => {
  const env = await integration();
  try {
    const key = queryKeys.notificationPreferences(env.identity);
    const current = env.data.resources.capture(key, false);
    const dates = env.data.resources.capture(
      queryKeys.datePreferences(env.identity),
      false,
    );
    env.data.resources.fenceAggregates();
    assert.doesNotThrow(current);
    env.data.resources.bumpKey(key);
    assert.throws(current);
    assert.doesNotThrow(dates);
  } finally {
    env.dispose();
  }
});
