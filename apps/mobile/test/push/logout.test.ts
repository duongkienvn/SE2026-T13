import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integration } from '../realtime/integration-support.ts';
import { loginResponse, USER_B } from '../auth/support.ts';
test('voluntary logout calls bounded enrollment cleanup before credential teardown', async () => {
  const env = await integration();
  try {
    let called = false;
    env.manager.addLifecycleListener({
      beforeLogout: async () => {
        called = true;
        assert(env.manager.getAccessCredential());
      },
    });
    await env.manager.logout();
    assert(called);
    assert.equal(env.manager.getSnapshot().status, 'unauthenticated');
  } finally {
    env.dispose();
  }
});
test('a replacement session during logout cleanup is never signed out by the old request', async () => {
  const env = await integration();
  try {
    env.manager.addLifecycleListener({
      beforeLogout: async () => {
        await env.manager.establishSession(loginResponse(USER_B));
      },
    });
    await env.manager.logout();
    const state = env.manager.getSnapshot();
    assert.equal(state.status, 'authenticated');
    if (state.status === 'authenticated') assert.equal(state.user.id, USER_B);
  } finally {
    env.dispose();
  }
});
