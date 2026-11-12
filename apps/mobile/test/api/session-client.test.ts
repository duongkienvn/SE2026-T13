import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import {
  createSessionHttpClient,
  currentIdentity,
} from '../../src/infrastructure/api/session-client.ts';
import { createCredentialStore } from '../../src/infrastructure/auth/credential-store.ts';
import { createSessionManager } from '../../src/infrastructure/auth/session-manager.ts';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  deferred,
  flush,
  loginResponse,
  user,
} from '../auth/support.ts';

function setup(respond: (init: RequestInit) => Promise<Response>) {
  const time = new FakeTime();
  const api = new FakeSessionApi();
  api.auto = (token) => ({
    kind: 'verified',
    user: user(token === loginResponse(USER_A).accessToken ? USER_A : USER_B),
  });
  const manager = createSessionManager({
    store: createCredentialStore(new MemorySecureStore()),
    api,
    clock: time,
    timers: time,
  });
  const requests: RequestInit[] = [];
  const transport = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    clock: time,
    timers: time,
    fetch: (async (_url, init) => {
      requests.push(init!);
      return respond(init!);
    }) as typeof fetch,
  });
  const scoped = createSessionHttpClient(transport, manager);
  return { ...scoped, manager, api, time, requests };
}
const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ success: true, statusCode: 200, message: 'OK', data }),
    { headers: { 'content-type': 'application/json' } },
  );
const identity = (value: unknown) => value;

test('missing/expired/offline-uncertain sessions never send protected requests', async () => {
  const context = setup(async () => envelope({}));
  await assert.rejects(context.client.json('/items', identity), {
    kind: 'unauthenticated',
  });
  await context.manager.establishSession(loginResponse(USER_A));
  context.time.jump(3600_000);
  await assert.rejects(context.client.json('/items', identity), {
    kind: 'unauthenticated',
  });
  assert.equal(context.manager.getSnapshot().status, 'expired');
  assert.equal(context.requests.length, 0);
  context.api.auto = () => ({ kind: 'unavailable', reason: 'network' });
  await context.manager.establishSession(loginResponse(USER_A));
  await assert.rejects(context.client.json('/items', identity), {
    kind: 'unauthenticated',
  });
  assert.equal(context.manager.getSnapshot().status, 'offline-uncertain');
  context.dispose();
  context.manager.dispose();
});

test('bearer is acquired for each request; old query identity cannot send under a new account', async () => {
  const context = setup(async () => envelope('ok'));
  await context.manager.establishSession(loginResponse(USER_A));
  const first = currentIdentity(context.manager)!;
  await context.client.json('/items', identity, { identity: first });
  await context.manager.establishSession(loginResponse(USER_B));
  await context.client.json('/items', identity);
  assert.equal(
    (context.requests[0]!.headers as Record<string, string>).Authorization,
    `Bearer ${loginResponse(USER_A).accessToken}`,
  );
  assert.equal(
    (context.requests[1]!.headers as Record<string, string>).Authorization,
    `Bearer ${loginResponse(USER_B).accessToken}`,
  );
  await assert.rejects(
    context.client.json('/items', identity, { identity: first }),
    { kind: 'session-changed' },
  );
  assert.equal(context.requests.length, 2);
  context.dispose();
  context.manager.dispose();
});

test('late 401 cannot end a newer session even when native fetch ignores abort', async () => {
  const gate = deferred<Response>();
  const context = setup(() => gate.promise);
  await context.manager.establishSession(loginResponse(USER_A));
  const pending = context.client.json('/items', identity);
  const check = assert.rejects(pending, { kind: 'session-changed' });
  await context.manager.establishSession(loginResponse(USER_B));
  await check;
  gate.resolve(
    new Response('{}', {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await flush();
  assert.equal(currentIdentity(context.manager)?.userId, USER_B);
  assert.equal(context.requests[0]!.signal?.aborted, true);
  context.dispose();
  context.manager.dispose();
});

test('logout and security revocation fence in-flight success before storage/network teardown completes', async () => {
  for (const reason of ['logout', 'security'] as const) {
    const gate = deferred<Response>();
    const context = setup(() => gate.promise);
    await context.manager.establishSession(loginResponse(USER_A));
    const pending = context.client.json('/items', identity);
    const check = assert.rejects(pending, { kind: 'session-changed' });
    if (reason === 'logout') void context.manager.logout();
    else
      context.manager.handleSecurityInvalidation(
        context.manager.getSnapshot().generation,
      );
    await check;
    gate.resolve(envelope({ private: true }));
    await flush();
    assert.equal(context.requests[0]!.signal?.aborted, true);
    assert.equal(currentIdentity(context.manager), null);
    context.dispose();
    context.manager.dispose();
  }
});

test('current generation 401 invokes the actual session owner, 403 preserves the identity', async () => {
  for (const status of [401, 403]) {
    const context = setup(
      async () =>
        new Response('{}', {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await context.manager.establishSession(loginResponse(USER_A));
    await assert.rejects(
      context.client.json('/items', identity),
      (error: unknown) => error instanceof ApiError && error.status === status,
    );
    assert.equal(
      context.manager.getSnapshot().status,
      status === 401 ? 'unauthenticated' : 'authenticated',
    );
    context.dispose();
    context.manager.dispose();
  }
});
