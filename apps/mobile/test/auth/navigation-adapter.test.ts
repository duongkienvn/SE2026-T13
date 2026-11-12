import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigationSessionAdapter } from '../../src/navigation/native-session-adapter.ts';
import type { SessionSnapshot } from '../../src/infrastructure/auth/session-manager.ts';
import { USER_A, USER_B, user } from './support.ts';

test('native session feeds navigation with stable, token-free state and generation-scoped identity', () => {
  let snapshot: SessionSnapshot = { status: 'restoring', generation: 1 };
  const listeners = new Set<() => void>();
  const adapter = createNavigationSessionAdapter({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  assert.deepEqual(adapter.getSnapshot(), { status: 'restoring' });
  assert.equal(adapter.getSnapshot(), adapter.getSnapshot());
  let notifications = 0;
  const unsubscribe = adapter.subscribe(() => {
    notifications++;
  });
  const publish = (value: SessionSnapshot) => {
    snapshot = value;
    listeners.forEach((listener) => listener());
    return adapter.getSnapshot();
  };
  for (const status of ['verifying', 'expired'] as const) {
    assert.deepEqual(publish({ status, generation: 1 }), { status });
  }
  assert.deepEqual(
    publish({
      status: 'offline-uncertain',
      generation: 1,
      reason: 'network',
      expiresAt: 100,
    }),
    { status: 'offline-uncertain' },
  );
  const first = publish({
    status: 'authenticated',
    generation: 2,
    user: user(USER_A),
    expiresAt: 100,
  });
  assert.deepEqual(first, {
    status: 'authenticated',
    sessionKey: `2:${USER_A}`,
  });
  assert.equal(adapter.getSnapshot(), first);
  assert.notDeepEqual(
    publish({
      status: 'authenticated',
      generation: 3,
      user: user(USER_A),
      expiresAt: 100,
    }),
    first,
  );
  assert.deepEqual(
    publish({ status: 'unauthenticated', generation: 4, reason: 'signed-out' }),
    { status: 'unauthenticated' },
  );
  assert.deepEqual(
    publish({
      status: 'authenticated',
      generation: 5,
      user: user(USER_B),
      expiresAt: 100,
    }),
    { status: 'authenticated', sessionKey: `5:${USER_B}` },
  );
  const count = notifications;
  unsubscribe();
  publish({ status: 'expired', generation: 6 });
  assert.equal(notifications, count);
});
