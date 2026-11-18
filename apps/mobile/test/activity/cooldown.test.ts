import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryObserver } from '@tanstack/react-query';
import { WorkspaceRole } from '@kanban/shared';
import { decodeWorkspaceActivity } from '../../src/features/activity/workspace/decoder.ts';
import { workspaceActivityOptions } from '../../src/features/activity/queries.ts';
import { canRetryWorkspace } from '../../src/features/workspaces/status.ts';
import { parseResourceId } from '../../src/navigation/routes.ts';
import { integration, ok, json } from '../realtime/integration-support.ts';
import { flush } from '../auth/support.ts';
import { activityWorkspace, workspaceId, workspaceEvent } from './fixtures.ts';
import { page } from '../workspaces/fixtures.ts';

for (const loaded of [false, true])
  test(`suppressed polls preserve the original 429 error timestamp with ${loaded ? 'loaded' : 'empty'} data`, async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const env = await integration();
    t.after(env.dispose);
    let limited = true;
    const result = page([workspaceEvent()], 1, 20);
    env.respond((input) =>
      input.includes('/activity?')
        ? Promise.resolve(
            limited
              ? new Response(
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
                )
              : json(result),
          )
        : input.endsWith(`/workspaces/${workspaceId}`)
          ? Promise.resolve(ok(activityWorkspace()))
          : null,
    );
    const options = workspaceActivityOptions(
      env.data,
      env.identity,
      parseResourceId(workspaceId)!,
      1,
    );
    if (loaded)
      env.data.queryClient.setQueryData(options.queryKey, {
        ...result,
        success: true,
        data: result.data.map((row) =>
          decodeWorkspaceActivity(row, WorkspaceRole.MEMBER),
        ),
        name: activityWorkspace().name,
        permissionScope: 'MEMBER',
        archived: false,
      });
    let failures = 0;
    const unsubscribe = env.data.queryClient
      .getQueryCache()
      .subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'error')
          failures++;
      });
    t.after(unsubscribe);
    const observer = new QueryObserver(env.data.queryClient, options);
    const stop = observer.subscribe(() => {});
    t.after(stop);
    await flush();
    const error = observer.getCurrentResult().error;
    const failedAt = observer.getCurrentResult().errorUpdatedAt;
    const before = env.requests.length;
    assert.equal(failures, 1);
    for (const elapsed of [30_000, 59_999]) {
      now = failedAt + elapsed;
      await observer.refetch();
      assert.equal(env.requests.length, before);
      assert.equal(observer.getCurrentResult().errorUpdatedAt, failedAt);
      assert.equal(observer.getCurrentResult().error, error);
      assert.equal(observer.getCurrentResult().isFetching, false);
      assert.equal(observer.getCurrentResult().isError, true);
      assert.equal(
        failures,
        1,
        'suppression is cancellation, not another HTTP failure',
      );
      assert.equal(canRetryWorkspace(error, failedAt), false);
    }
    now = failedAt + 60_000;
    limited = false;
    assert.equal(
      canRetryWorkspace(
        observer.getCurrentResult().error,
        observer.getCurrentResult().errorUpdatedAt,
      ),
      true,
    );
    await observer.refetch();
    assert.equal(observer.getCurrentResult().isSuccess, true);
    assert.equal(env.requests.length, before + 2);
  });

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
