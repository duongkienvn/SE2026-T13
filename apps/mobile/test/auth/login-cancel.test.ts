import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../../src/infrastructure/auth/session-manager.ts';
import { createCredentialStore } from '../../src/infrastructure/auth/credential-store.ts';
import {
  FakeTime,
  MemorySecureStore,
  FakeSessionApi,
  USER_A,
  USER_B,
  loginResponse,
  user,
  flush,
} from './support.ts';
test('cancel during users/me cannot persist or publish a usable session', async () => {
  const time = new FakeTime(),
    storage = new MemorySecureStore(),
    api = new FakeSessionApi();
  const manager = createSessionManager({
    store: createCredentialStore(storage),
    api,
    clock: time,
    timers: time,
  });
  await manager.start();
  const controller = new AbortController();
  const result = manager.establishSession(
    loginResponse(USER_A),
    controller.signal,
  );
  controller.abort();
  api.answer({ kind: 'verified', user: user(USER_A) });
  assert.deepEqual(await result, { ok: false, reason: 'superseded' });
  await flush();
  assert.equal(manager.getSnapshot().status, 'unauthenticated');
  assert.equal(storage.values.size, 0);
  manager.dispose();
});
test('cancelling an older login cannot cancel a newer account generation', async () => {
  const time = new FakeTime(),
    storage = new MemorySecureStore(),
    api = new FakeSessionApi();
  const manager = createSessionManager({
    store: createCredentialStore(storage),
    api,
    clock: time,
    timers: time,
  });
  await manager.start();
  const controller = new AbortController();
  const old = manager.establishSession(
    loginResponse(USER_A),
    controller.signal,
  );
  const next = manager.establishSession(loginResponse(USER_B));
  controller.abort();
  api.answer({ kind: 'verified', user: user(USER_A) });
  api.answer({ kind: 'verified', user: user(USER_B) });
  assert.equal((await old).ok, false);
  assert.equal((await next).ok, true);
  assert.equal(manager.getSnapshot().status, 'authenticated');
  manager.dispose();
});
