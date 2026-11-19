import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tasksOptions } from '../../src/features/tasks/queries.ts';
import {
  integration,
  payload,
  BOARD,
} from '../realtime/integration-support.ts';
import { flush } from '../auth/support.ts';

test('Card hints refresh filtered My Tasks once and Board revoke fences the aggregate', async () => {
  const env = await integration();
  try {
    await env.join();
    const options = tasksOptions(
      env.data,
      env.identity,
      { boardId: BOARD },
      'UTC',
    );
    const observer = env.observe(options.queryKey, 'tasks');
    for (let i = 0; i < 5; i++) env.socket.server('card:updated', payload);
    env.time.advance(50);
    await flush();
    assert.equal(observer.getCurrentResult().data, 1);
    assert.equal(
      env.requests.filter(({ url }) => url.endsWith('/tasks')).length,
      1,
    );
    env.socket.server('board:access-revoked', { boardId: BOARD });
    assert.equal(observer.getCurrentResult().data, undefined);
  } finally {
    env.dispose();
  }
});
