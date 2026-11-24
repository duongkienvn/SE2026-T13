import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../../src/infrastructure/auth/session-manager.ts';
import { createCredentialStore } from '../../src/infrastructure/auth/credential-store.ts';
import {
  FakeTime,
  FakeSessionApi,
  MemorySecureStore,
  USER_A,
  USER_B,
  user,
  loginResponse,
  flush,
  deferred,
} from '../auth/support.ts';
async function setup() {
  const time = new FakeTime(),
    api = new FakeSessionApi(),
    storage = new MemorySecureStore();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  const manager = createSessionManager({
    store: createCredentialStore(storage),
    api,
    clock: time,
    timers: time,
  });
  await manager.establishSession(loginResponse(USER_A));
  return { manager, storage, api, time };
}
test('deletion preparation removes restorable token before transfer; both outcomes end all private lifecycles without logout POST', async () => {
  for (const confirmed of [true, false]) {
    const e = await setup(),
      generation = e.manager.getSnapshot().generation;
    let ended = 0;
    e.manager.addLifecycleListener({ onSessionEnd: () => ended++ });
    assert.equal(await e.manager.prepareAccountDeletion(generation), true);
    assert.equal(e.storage.values.size, 0);
    assert.equal(e.manager.getSnapshot().status, 'authenticated');
    const ending = e.manager.endAccountDeletion(generation, confirmed);
    assert.equal(e.manager.getAccessCredential(), null);
    assert.equal(ended, 1);
    assert.equal((await ending).ended, true);
    assert.equal(e.api.logoutCalls.length, 0);
    const snapshot = e.manager.getSnapshot();
    assert.equal(snapshot.status, 'unauthenticated');
    if (snapshot.status === 'unauthenticated')
      assert.equal(
        snapshot.reason,
        confirmed ? 'account-deleted' : 'deletion-uncertain',
      );
    const next = createSessionManager({
      store: createCredentialStore(e.storage),
      api: e.api,
      clock: e.time,
      timers: e.time,
    });
    await next.start();
    assert.equal(next.getSnapshot().status, 'unauthenticated');
    next.dispose();
    e.manager.dispose();
  }
});
test('SecureStore refusal blocks preparation and never pretends a credential was removed', async () => {
  const e = await setup();
  e.storage.faults.add('delete');
  assert.equal(
    await e.manager.prepareAccountDeletion(e.manager.getSnapshot().generation),
    false,
  );
  assert.equal(e.storage.values.size, 1);
  e.manager.dispose();
});

test('a later wipe refusal remains fail-closed and reports cleanup status after an already prepared request', async () => {
  const e = await setup(),
    generation = e.manager.getSnapshot().generation;
  assert.equal(await e.manager.prepareAccountDeletion(generation), true);
  e.storage.faults.add('delete');
  const result = await e.manager.endAccountDeletion(generation, true);
  assert.equal(result.storageCleared, false);
  assert.equal(e.manager.getAccessCredential(), null);
  assert.equal(e.storage.values.size, 0);
  const snapshot = e.manager.getSnapshot();
  if (snapshot.status === 'unauthenticated')
    assert.equal(snapshot.storageCleared, false);
  else assert.fail('Protected session remained');
  e.manager.dispose();
});
test('a delayed preparation or result from A cannot clear or sign out B', async () => {
  const e = await setup(),
    generation = e.manager.getSnapshot().generation;
  const gate = deferred<void>();
  e.storage.gate = gate.promise;
  const preparing = e.manager.prepareAccountDeletion(generation);
  await flush();
  e.api.auto = () => ({ kind: 'verified', user: user(USER_B) });
  const login = e.manager.establishSession(loginResponse(USER_B));
  gate.resolve();
  assert.equal(await preparing, false);
  await login;
  assert.equal(
    (await e.manager.endAccountDeletion(generation, true)).ended,
    false,
  );
  const snapshot = e.manager.getSnapshot();
  assert.equal(snapshot.status, 'authenticated');
  if (snapshot.status === 'authenticated')
    assert.equal(snapshot.user.id, USER_B);
  assert.equal(e.storage.values.size, 1);
  e.manager.dispose();
});
