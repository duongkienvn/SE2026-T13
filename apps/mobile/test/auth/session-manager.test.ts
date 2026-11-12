import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  credentialFromLogin,
  encodeCredential,
} from '../../src/infrastructure/auth/credential-record.ts';
import {
  CREDENTIAL_KEY,
  createCredentialStore,
} from '../../src/infrastructure/auth/credential-store.ts';
import {
  createSessionManager,
  type SessionStatus,
} from '../../src/infrastructure/auth/session-manager.ts';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  START,
  USER_A,
  USER_B,
  deferred,
  flush,
  loginResponse,
  makeJwt,
  user,
} from './support.ts';

const HOUR = 3_600_000;

function setup(stored?: { sub: string; expiresAt?: number; tag?: string }) {
  const time = new FakeTime();
  const storage = new MemorySecureStore();
  const api = new FakeSessionApi();
  if (stored) {
    const credential = credentialFromLogin(
      makeJwt(stored.sub, stored.tag),
      3600,
      START,
    )!;
    storage.values.set(
      CREDENTIAL_KEY,
      encodeCredential({
        ...credential,
        expiresAt: stored.expiresAt ?? START + HOUR,
      }),
    );
  }
  const manager = createSessionManager({
    store: createCredentialStore(storage),
    api,
    clock: time,
    timers: time,
  });
  const statuses: SessionStatus[] = [];
  manager.subscribe(() => statuses.push(manager.getSnapshot().status));
  const events: string[] = [];
  manager.addLifecycleListener({
    onSessionEnd: (event) =>
      events.push(`end:${event.reason}:${event.previousGeneration}`),
    onSessionStart: (event) =>
      events.push(`start:${event.userId}:${event.generation}`),
  });
  return { time, storage, api, manager, statuses, events };
}

test('cold start without a credential settles signed out with no network call', async () => {
  const { manager, api, statuses } = setup();
  assert.equal(manager.getSnapshot().status, 'restoring');
  await manager.start();
  assert.deepEqual(manager.getSnapshot(), {
    status: 'unauthenticated',
    generation: 1,
    reason: 'no-credential',
  });
  assert.deepEqual(statuses, ['unauthenticated']);
  assert.equal(api.verifyCalls.length, 0);
});

test('stored token is never usable before /users/me verifies it', async () => {
  const { manager, api, events } = setup({ sub: USER_A });
  const started = manager.start();
  await flush();
  assert.equal(manager.getSnapshot().status, 'verifying');
  assert.equal(manager.getAccessCredential(), null);
  assert.equal(api.verifyCalls.length, 1);

  api.answer({ kind: 'verified', user: user(USER_A) });
  await started;
  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.status, 'authenticated');
  assert.equal(snapshot.status === 'authenticated' && snapshot.user.id, USER_A);
  assert.doesNotMatch(JSON.stringify(snapshot), /eyJ/);
  assert.deepEqual(manager.getAccessCredential(), {
    accessToken: api.verifyCalls[0],
    generation: 1,
  });
  assert.deepEqual(events, [`start:${USER_A}:1`]);
});

test('start runs once even when called concurrently', async () => {
  const { manager, storage, api } = setup({ sub: USER_A });
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await Promise.all([manager.start(), manager.start(), manager.start()]);
  assert.equal(storage.calls.filter((call) => call === 'get').length, 1);
  assert.equal(api.verifyCalls.length, 1);
});

test('expired, corrupted and unreadable credentials sign out safely', async () => {
  const expired = setup({ sub: USER_A, expiresAt: START });
  await expired.manager.start();
  assert.equal(expired.manager.getSnapshot().status, 'expired');
  assert.equal(expired.storage.values.size, 0);
  assert.equal(expired.api.verifyCalls.length, 0);

  const corrupted = setup();
  corrupted.storage.values.set(CREDENTIAL_KEY, '{"v":1}');
  await corrupted.manager.start();
  assert.deepEqual(corrupted.manager.getSnapshot(), {
    status: 'unauthenticated',
    generation: 1,
    reason: 'invalid-credential',
  });
  assert.equal(corrupted.storage.values.size, 0);

  const broken = setup({ sub: USER_A });
  broken.storage.faults.add('get');
  await broken.manager.start();
  assert.deepEqual(broken.manager.getSnapshot(), {
    status: 'unauthenticated',
    generation: 1,
    reason: 'storage-error',
  });
  assert.equal(broken.api.verifyCalls.length, 0);
});

test('401 during restore signs out and removes the stored token', async () => {
  const { manager, api, storage } = setup({ sub: USER_A });
  api.auto = () => ({ kind: 'unauthorized' });
  await manager.start();
  await flush();
  assert.deepEqual(manager.getSnapshot(), {
    status: 'unauthenticated',
    generation: 2,
    reason: 'unauthorized',
  });
  assert.equal(storage.values.size, 0);
});

test('timeout is offline-uncertain: credential kept, content locked, retry works', async () => {
  const { manager, api, storage } = setup({ sub: USER_A });
  api.auto = () => ({ kind: 'unavailable', reason: 'timeout' });
  await manager.start();
  assert.deepEqual(manager.getSnapshot(), {
    status: 'offline-uncertain',
    generation: 1,
    reason: 'timeout',
    expiresAt: START + HOUR,
  });
  assert.equal(manager.getAccessCredential(), null);
  assert.equal(storage.values.size, 1);

  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  manager.handleNetworkRestored();
  await flush();
  assert.equal(manager.getSnapshot().status, 'authenticated');
  assert.equal(manager.getSnapshot().generation, 1);
  assert.equal(api.verifyCalls.length, 2);
});

test('retry while a retry is running reuses the same request', async () => {
  const { manager, api } = setup({ sub: USER_A });
  api.auto = () => ({ kind: 'unavailable', reason: 'network' });
  await manager.start();
  api.auto = null;
  const first = manager.retryVerification();
  const second = manager.retryVerification();
  manager.handleForeground();
  assert.equal(api.verifyCalls.length, 2);
  api.answer({ kind: 'verified', user: user(USER_A) });
  await Promise.all([first, second]);
  assert.equal(manager.getSnapshot().status, 'authenticated');
});

test('/users/me identity that differs from the token subject is rejected', async () => {
  const { manager, api, storage } = setup({ sub: USER_A });
  api.auto = () => ({ kind: 'verified', user: user(USER_B) });
  await manager.start();
  await flush();
  assert.deepEqual(manager.getSnapshot(), {
    status: 'unauthenticated',
    generation: 2,
    reason: 'invalid-credential',
  });
  assert.equal(storage.values.size, 0);
});

test('establishSession verifies, persists and starts the session', async () => {
  const { manager, api, storage, events } = setup();
  await manager.start();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  const result = await manager.establishSession(loginResponse(USER_A));
  assert.deepEqual(result, { ok: true, user: user(USER_A), persisted: true });
  assert.equal(manager.getSnapshot().status, 'authenticated');
  assert.equal(manager.getSnapshot().generation, 2);
  assert.equal(
    JSON.parse(storage.values.get(CREDENTIAL_KEY)!).accessToken,
    api.verifyCalls[0],
  );
  assert.deepEqual(events, [`start:${USER_A}:2`]);
});

test('malformed login responses never touch the current session', async () => {
  const { manager, api } = setup();
  await manager.start();
  const good = loginResponse(USER_A);
  for (const bad of [
    { ...good, tokenType: 'Basic' },
    { ...good, expiresIn: 0 },
    { ...good, accessToken: 'abc' },
    { ...good, user: null },
    { ...good, user: { id: USER_B } },
  ])
    assert.deepEqual(await manager.establishSession(bad), {
      ok: false,
      reason: 'invalid-response',
    });
  assert.equal(api.verifyCalls.length, 0);
  assert.equal(manager.getSnapshot().generation, 1);
});

test('login verification outcomes: rejected, unavailable, unsaved', async () => {
  const rejected = setup();
  await rejected.manager.start();
  rejected.api.auto = () => ({ kind: 'unauthorized' });
  assert.deepEqual(
    await rejected.manager.establishSession(loginResponse(USER_A)),
    {
      ok: false,
      reason: 'rejected',
    },
  );
  assert.equal(rejected.storage.values.size, 0);

  const offline = setup();
  await offline.manager.start();
  offline.api.auto = () => ({ kind: 'unavailable', reason: 'network' });
  assert.deepEqual(
    await offline.manager.establishSession(loginResponse(USER_A)),
    {
      ok: false,
      reason: 'unavailable',
    },
  );
  // Not written until it is verified.
  assert.equal(offline.storage.values.size, 0);
  offline.api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await offline.manager.retryVerification();
  assert.equal(offline.manager.getSnapshot().status, 'authenticated');
  assert.equal(offline.storage.values.size, 1);

  const unsaved = setup();
  await unsaved.manager.start();
  unsaved.storage.faults.add('set');
  unsaved.api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  const result = await unsaved.manager.establishSession(loginResponse(USER_A));
  assert.equal(result.ok && result.persisted, false);
  assert.equal(unsaved.manager.getSnapshot().status, 'authenticated');
  assert.equal(unsaved.storage.values.size, 0);
});

test('login during cold restore drops the late restore answer', async () => {
  const { manager, api, events } = setup({ sub: USER_A, tag: 'old' });
  const restoring = manager.start();
  await flush();
  assert.equal(api.verifyCalls.length, 1);

  const login = manager.establishSession(loginResponse(USER_B, 'new'));
  await flush();
  assert.equal(api.verifyCalls.length, 2);
  api.answer({ kind: 'verified', user: user(USER_A) }, 0);
  await restoring;
  assert.equal(manager.getSnapshot().status, 'verifying');

  api.answer({ kind: 'verified', user: user(USER_B) });
  const result = await login;
  assert.equal(result.ok, true);
  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.status === 'authenticated' && snapshot.user.id, USER_B);
  assert.deepEqual(events, ['end:replaced:1', `start:${USER_B}:2`]);
});

test('logout during login verification wins and leaves no stored token', async () => {
  const { manager, api, storage } = setup();
  await manager.start();
  const login = manager.establishSession(loginResponse(USER_A));
  await flush();
  const logout = manager.logout();
  api.answer({ kind: 'verified', user: user(USER_A) });
  assert.deepEqual(await login, { ok: false, reason: 'superseded' });
  await logout;
  assert.equal(manager.getSnapshot().status, 'unauthenticated');
  assert.equal(storage.values.size, 0);
});

test('logout queued behind a slow credential write still removes it', async () => {
  const { manager, api, storage } = setup();
  await manager.start();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  const gate = deferred<void>();
  storage.gate = gate.promise;
  const login = manager.establishSession(loginResponse(USER_A));
  await flush();
  assert.ok(storage.calls.includes('set'));
  const logout = manager.logout();
  gate.resolve();
  await Promise.all([login, logout]);
  await flush();
  assert.equal(storage.values.size, 0);
  assert.equal(manager.getSnapshot().status, 'unauthenticated');
});

test('logout tears down before publishing, then calls the API with the old token', async () => {
  const { manager, api, storage } = setup();
  await manager.start();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await manager.establishSession(loginResponse(USER_A));
  const order: string[] = [];
  manager.addLifecycleListener({
    onSessionEnd: () => order.push(`teardown:${manager.getSnapshot().status}`),
  });
  manager.subscribe(() =>
    order.push(`publish:${manager.getSnapshot().status}`),
  );
  api.logoutResult = false;
  const result = await manager.logout();
  assert.deepEqual(order, [
    'teardown:authenticated',
    'publish:unauthenticated',
  ]);
  assert.deepEqual(result, { serverAcknowledged: false, storageCleared: true });
  assert.deepEqual(api.logoutCalls, [api.verifyCalls[0]]);
  assert.equal(storage.values.size, 0);
  assert.equal(manager.getAccessCredential(), null);
});

test('logout still signs out locally when the keychain refuses deletion', async () => {
  const { manager, api, storage } = setup();
  await manager.start();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await manager.establishSession(loginResponse(USER_A));
  storage.faults.add('delete');
  const result = await manager.logout();
  assert.deepEqual(result, { serverAcknowledged: true, storageCleared: false });
  assert.equal(manager.getSnapshot().status, 'unauthenticated');
});

test('stale 401 and security events from older generations are ignored', async () => {
  const { manager, api, events } = setup();
  await manager.start();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await manager.establishSession(loginResponse(USER_A, 'a'));
  const generationA = manager.getSnapshot().generation;
  api.auto = () => ({ kind: 'verified', user: user(USER_B) });
  await manager.establishSession(loginResponse(USER_B, 'b'));
  const generationB = manager.getSnapshot().generation;

  assert.ok(generationB > generationA);
  assert.equal(manager.isCurrent(generationA), false);
  assert.equal(manager.handleUnauthorized(generationA), false);
  assert.equal(manager.handleSecurityInvalidation(generationA), false);
  assert.equal(manager.getSnapshot().status, 'authenticated');
  assert.deepEqual(events, [
    `start:${USER_A}:${generationA}`,
    `end:replaced:${generationA}`,
    `start:${USER_B}:${generationB}`,
  ]);

  assert.equal(manager.handleUnauthorized(generationB), true);
  assert.equal(manager.handleUnauthorized(generationB), false);
  assert.deepEqual(manager.getSnapshot(), {
    status: 'unauthenticated',
    generation: generationB + 1,
    reason: 'unauthorized',
  });
});

test('security invalidation ends the current session with its own reason', async () => {
  const { manager, api, storage, events } = setup();
  await manager.start();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await manager.establishSession(loginResponse(USER_A));
  assert.equal(manager.handleSecurityInvalidation(2), true);
  await flush();
  assert.deepEqual(manager.getSnapshot(), {
    status: 'unauthenticated',
    generation: 3,
    reason: 'security-change',
  });
  assert.equal(storage.values.size, 0);
  assert.deepEqual(events.at(-1), 'end:security-change:2');
});

test('expiry timer ends the session at the absolute expiry', async () => {
  const { manager, api, time, storage, events } = setup();
  await manager.start();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await manager.establishSession(loginResponse(USER_A));
  time.advance(HOUR - 1);
  assert.equal(manager.getSnapshot().status, 'authenticated');
  time.advance(1);
  assert.equal(manager.getSnapshot().status, 'expired');
  assert.equal(manager.getAccessCredential(), null);
  await flush();
  assert.equal(storage.values.size, 0);
  assert.equal(events.at(-1), 'end:expired:2');
  assert.equal(time.timerCount, 0);
});

test('clock jump while backgrounded expires on next access or foreground', async () => {
  const access = setup();
  await access.manager.start();
  access.api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await access.manager.establishSession(loginResponse(USER_A));
  access.time.jump(HOUR);
  assert.equal(access.manager.getAccessCredential(), null);
  assert.equal(access.manager.getSnapshot().status, 'expired');

  const foreground = setup();
  await foreground.manager.start();
  foreground.api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await foreground.manager.establishSession(loginResponse(USER_A));
  foreground.time.jump(2 * HOUR);
  foreground.manager.handleForeground();
  assert.equal(foreground.manager.getSnapshot().status, 'expired');
});

test('token expiring while /users/me is pending ends as expired, not authenticated', async () => {
  const { manager, api, time } = setup({
    sub: USER_A,
    expiresAt: START + 1000,
  });
  const started = manager.start();
  await flush();
  time.jump(1000);
  api.answer({ kind: 'verified', user: user(USER_A) });
  await started;
  assert.equal(manager.getSnapshot().status, 'expired');
});

test('a throwing listener does not stop teardown for the others', async () => {
  const { manager, api } = setup();
  await manager.start();
  api.auto = () => ({ kind: 'verified', user: user(USER_A) });
  await manager.establishSession(loginResponse(USER_A));
  const reached: string[] = [];
  manager.addLifecycleListener({
    onSessionEnd: () => {
      throw new Error('boom');
    },
  });
  manager.addLifecycleListener({ onSessionEnd: () => reached.push('second') });
  manager.subscribe(() => {
    throw new Error('subscriber boom');
  });
  await manager.logout();
  assert.deepEqual(reached, ['second']);
  assert.equal(manager.getSnapshot().status, 'unauthenticated');
});

test('dispose stops timers and ignores late answers', async () => {
  const { manager, api, time } = setup({ sub: USER_A });
  const started = manager.start();
  await flush();
  manager.dispose();
  api.answer({ kind: 'verified', user: user(USER_A) });
  await started;
  assert.equal(manager.getSnapshot().status, 'verifying');
  assert.equal(time.timerCount, 0);
});
