import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryObserver } from '@tanstack/react-query';
import { workspaceActivityOptions } from '../../src/features/activity/queries.ts';
import { parseResourceId } from '../../src/navigation/routes.ts';
import { integration, ok } from '../realtime/integration-support.ts';
import { flush } from '../auth/support.ts';
import { activityWorkspace, workspaceId } from './fixtures.ts';

test('initial 429 cooldown survives transient query errors and renewed query options', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const env = await integration();
  t.after(env.dispose);
  env.respond((input) =>
    input.includes('/activity?')
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              success: false,
              statusCode: 429,
              code: 'TOO_MANY_REQUESTS',
              message: 'Limited',
            }),
            {
              status: 429,
              headers: {
                'content-type': 'application/json',
                'retry-after': '60',
              },
            },
          ),
        )
      : input.endsWith(`/workspaces/${workspaceId}`)
        ? Promise.resolve(ok(activityWorkspace()))
        : null,
  );
  const options = () =>
    workspaceActivityOptions(
      env.data,
      env.identity,
      parseResourceId(workspaceId)!,
      1,
    );
  const observer = new QueryObserver(env.data.queryClient, options());
  const stop = observer.subscribe(() => {});
  t.after(stop);
  await flush();
  assert.equal(observer.getCurrentResult().isError, true);
  assert.equal(observer.getCurrentResult().data, undefined);
  const before = env.requests.length;
  for (const wake of ['poll', 'focus', 'reconnect', 'options']) {
    now += 1000;
    if (wake === 'focus') env.data.queryClient.getQueryCache().onFocus();
    else if (wake === 'reconnect')
      env.data.queryClient.getQueryCache().onOnline();
    else {
      if (wake === 'options') observer.setOptions(options());
      await observer.refetch();
    }
    await flush();
    assert.equal(
      env.requests.length,
      before,
      `${wake} must respect the original Retry-After deadline`,
    );
  }
});
