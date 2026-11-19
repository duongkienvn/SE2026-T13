import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integration } from '../realtime/integration-support.ts';
import { flush } from '../auth/support.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
test('notification hint bursts coalesce list/count REST refresh at 200ms without fabricating content', async () => {
  const env = await integration();
  try {
    env.socket.server('connect');
    const list = env.observe(
      queryKeys.notificationList(env.identity),
      'notification-list',
    );
    const count = env.observe(
      queryKeys.unreadCount(env.identity),
      'notification-count',
    );
    const before = env.requests.length;
    for (let i = 0; i < 5; i++) env.socket.server('notifications:changed', {});
    env.time.advance(149);
    await flush();
    assert.equal(env.requests.length, before);
    env.time.advance(1);
    env.time.advance(50);
    await flush();
    assert.equal(env.requests.length, before + 2);
    assert.equal(list.getCurrentResult().data, 1);
    assert.equal(count.getCurrentResult().data, 1);
    env.socket.server('notifications:changed', { id: 'untrusted-content' });
    env.time.advance(200);
    await flush();
    assert.equal(env.requests.length, before + 2);
  } finally {
    env.dispose();
  }
});
