import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardStarKey, setBoardStar } from '../../src/features/boards/star.ts';
import { createBoardApi } from '../../src/features/boards/api.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { deferred, flush } from '../auth/support.ts';
import { uuid } from './fixtures.ts';

test('stars a read-only Board, rolls back failures and reconciles successful response', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const id = uuid(1024);
  env.data.resources.confirmBoard(id, false);
  await assert.rejects(
    createBoardApi(env.data.api, env.identity).update(
      id,
      { name: 'No access' },
      new AbortController().signal,
    ),
  );
  const key = boardStarKey(env.identity, id);
  env.data.queryClient.setQueryData(key, {
    isStarred: false,
    lastViewedAt: null,
  });
  let fail = true;
  env.respond(() =>
    Promise.resolve(
      fail ? json({}, 503) : ok({ isStarred: true, lastViewedAt: null }),
    ),
  );
  await assert.rejects(setBoardStar(env.data, env.identity, id, true));
  assert.equal(
    env.data.queryClient.getQueryData<{ isStarred: boolean }>(key)?.isStarred,
    false,
  );
  fail = false;
  await setBoardStar(env.data, env.identity, id, true);
  assert.equal(
    env.data.queryClient.getQueryData<{ isStarred: boolean }>(key)?.isStarred,
    true,
  );
});

test('serializes rapid toggles and fences a late response after access loss', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const id = uuid(1025);
  const pending = deferred<Response>();
  let calls = 0;
  env.respond((_url, init) => {
    calls++;
    return calls === 1
      ? pending.promise
      : Promise.resolve(
          ok({ isStarred: init.method === 'PUT', lastViewedAt: null }),
        );
  });
  const first = setBoardStar(env.data, env.identity, id, true);
  const second = setBoardStar(env.data, env.identity, id, false);
  await flush();
  assert.equal(calls, 1);
  pending.resolve(ok({ isStarred: true, lastViewedAt: null }));
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal(
    env.data.queryClient.getQueryData<{ isStarred: boolean }>(
      boardStarKey(env.identity, id),
    )?.isStarred,
    false,
  );
  const late = deferred<Response>();
  env.respond(() => late.promise);
  const write = setBoardStar(env.data, env.identity, id, true);
  await flush();
  env.data.resources.fenceBoard(id, true);
  env.data.evict(env.identity, [boardStarKey(env.identity, id)]);
  late.resolve(ok({ isStarred: true, lastViewedAt: null }));
  await assert.rejects(write);
  assert.equal(
    env.data.queryClient.getQueryData(boardStarKey(env.identity, id)),
    undefined,
  );
});
