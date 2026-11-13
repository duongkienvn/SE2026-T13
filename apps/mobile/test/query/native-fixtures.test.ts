import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onlineManager } from '@tanstack/react-query';
import { bindQueryLifecycle } from '../../src/infrastructure/query/lifecycle.ts';
import { nativeLifecycle } from '../fixtures/native-lifecycle.ts';
import { setup } from './support.ts';

test('native lifecycle fixture drives offline and cleans up subscriptions', async () => {
  const context = await setup();
  const native = nativeLifecycle();
  const unbind = bindQueryLifecycle(
    context.manager,
    native.app,
    native.network,
  );
  await Promise.resolve();
  native.setNetworkState({ isConnected: false });
  assert.equal(onlineManager.isOnline(), false);
  native.setNetworkState({ isConnected: true });
  assert.equal(onlineManager.isOnline(), true);
  unbind();
  native.setNetworkState({ isConnected: false });
  assert.equal(onlineManager.isOnline(), true);
  context.dispose();
});
