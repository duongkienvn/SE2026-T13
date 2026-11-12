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
import { deferred, flush } from '../auth/support.ts';
import { setup } from './support.ts';

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
});
