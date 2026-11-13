import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { bindQueryLifecycle } from '../../src/infrastructure/query/lifecycle.ts';
import { nativeLifecycle } from '../fixtures/native-lifecycle.ts';
import { setup } from './support.ts';

test('native lifecycle fixture drives offline and cleans up subscriptions', async () => {
  const context = await setup();
  const native = nativeLifecycle();
  native.setAppState('background');
  const unbind = bindQueryLifecycle(
    context.manager,
    native.app,
    native.network,
  );
  assert.equal(focusManager.isFocused(), false);
  native.setAppState('active');
  assert.equal(native.app.currentState, 'active');
  assert.equal(focusManager.isFocused(), true);
  await Promise.resolve();
  native.setNetworkState({ isConnected: false });
  assert.equal(onlineManager.isOnline(), false);
  native.setNetworkState({ isConnected: true });
  assert.equal(onlineManager.isOnline(), true);
  unbind();
  native.setNetworkState({ isConnected: false });
  assert.equal(onlineManager.isOnline(), true);
  native.setAppState('background');
  assert.equal(focusManager.isFocused(), true);
  context.dispose();
});
