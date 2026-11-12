import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  focusManager,
  onlineManager,
  QueryObserver,
} from '@tanstack/react-query';
import {
  bindQueryLifecycle,
  type NetworkState,
} from '../../src/infrastructure/query/lifecycle.ts';
import { ok, setup } from './support.ts';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { createTransportSessionApi } from '../../src/infrastructure/auth/session-api.ts';
import { createCredentialStore } from '../../src/infrastructure/auth/credential-store.ts';
import { credentialFromLogin } from '../../src/infrastructure/auth/credential-record.ts';
import { createSessionManager } from '../../src/infrastructure/auth/session-manager.ts';
import {
  deferred,
  flush,
  FakeTime,
  MemorySecureStore,
  USER_A,
  loginResponse,
  user,
} from '../auth/support.ts';

test('native focus/reconnect refresh stale active data once; initial async status cannot overwrite a newer event', async () => {
  const context = await setup();
  const initial = deferred<NetworkState>();
  let appListener: ((state: string) => void) | undefined;
  let networkListener: ((state: NetworkState) => void) | undefined;
  let removed = 0;
  const unbind = bindQueryLifecycle(
    context.manager,
    {
      currentState: 'active',
      addEventListener(_event, callback) {
        appListener = callback;
        return {
          remove: () => {
            removed++;
          },
        };
      },
    },
    {
      getNetworkStateAsync: () => initial.promise,
      addNetworkStateListener(callback) {
        networkListener = callback;
        return {
          remove: () => {
            removed++;
          },
        };
      },
    },
  );
  context.layer.queryClient.mount();
  const observer = new QueryObserver(context.layer.queryClient, {
    ...context.layer.meOptions(context.layer.getIdentity()!),
    staleTime: 0,
  });
  const stop = observer.subscribe(() => {});
  try {
    await flush();
    assert.equal(context.requests.length, 1);
    appListener!('background');
    appListener!('active');
    await flush();
    assert.equal(context.requests.length, 2);
    networkListener!({ isConnected: false });
    assert.equal(onlineManager.isOnline(), false);
    initial.resolve({ isConnected: true });
    await flush();
    assert.equal(onlineManager.isOnline(), false);
    networkListener!({ isConnected: true, isInternetReachable: true });
    await flush();
    assert.equal(context.requests.length, 3);
    networkListener!({ isConnected: true });
    await flush();
    assert.equal(context.requests.length, 3);
    context.time.jump(3600_000);
    appListener!('background');
    appListener!('active');
    await flush();
    assert.equal(context.manager.getSnapshot().status, 'expired');
    assert.equal(context.requests.length, 3);
  } finally {
    stop();
    context.layer.queryClient.unmount();
    unbind();
    context.dispose();
  }
  assert.equal(removed, 2);
  assert.equal(focusManager.isFocused(), true);
  networkListener!({ isConnected: false });
  appListener!('background');
  assert.equal(onlineManager.isOnline(), true);
  assert.equal(focusManager.isFocused(), true);
});

for (const mode of ['restore', 'sign-in'] as const) {
  test(`one reconnect verifies an offline-uncertain ${mode} with the actual HTTP/session adapters`, async () => {
    const time = new FakeTime();
    const store = createCredentialStore(new MemorySecureStore());
    const login = loginResponse(USER_A);
    if (mode === 'restore')
      await store.write(
        credentialFromLogin(login.accessToken, login.expiresIn, time.now())!,
      );
    const requests: RequestInit[] = [];
    onlineManager.setOnline(false);
    const http = createHttpClient({
      baseUrl: new URL('https://example.test/api'),
      clock: time,
      timers: time,
      isOnline: () => onlineManager.isOnline(),
      fetch: (async (url, init) => {
        assert.equal(onlineManager.isOnline(), true);
        assert.equal(url, 'https://example.test/api/users/me');
        requests.push(init!);
        return ok(user(USER_A));
      }) as typeof fetch,
    });
    const manager = createSessionManager({
      store,
      api: createTransportSessionApi(http),
      clock: time,
      timers: time,
    });
    let change!: (state: NetworkState) => void;
    const unbind = bindQueryLifecycle(
      manager,
      {
        currentState: 'active',
        addEventListener: () => ({ remove() {} }),
      },
      {
        getNetworkStateAsync: async () => ({ isConnected: false }),
        addNetworkStateListener(callback) {
          change = callback;
          return { remove() {} };
        },
      },
    );
    try {
      if (mode === 'restore') await manager.start();
      else await manager.establishSession(login);
      assert.equal(manager.getSnapshot().status, 'offline-uncertain');
      assert.equal(requests.length, 0);
      const generation = manager.getSnapshot().generation;
      change({ isConnected: true });
      await flush();
      assert.equal(manager.getSnapshot().status, 'authenticated');
      assert.equal(manager.getSnapshot().generation, generation);
      assert.equal(requests.length, 1);
      assert.equal(
        (requests[0]!.headers as Record<string, string>).Authorization,
        `Bearer ${login.accessToken}`,
      );
      // A stale initial offline read and duplicate online hint cannot undo it.
      change({ isConnected: true });
      await flush();
      assert.equal(requests.length, 1);
    } finally {
      unbind();
      manager.dispose();
    }
    change({ isConnected: false });
    assert.equal(onlineManager.isOnline(), true);
  });
}
