import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifySearchDestination } from '../../src/features/search/navigation.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import {
  integration,
  ok,
  json,
  BOARD,
  WORKSPACE,
} from '../realtime/integration-support.ts';
import { boardHit, cardHit, workspaceHit } from './fixtures.ts';
import { workspace } from '../workspaces/fixtures.ts';
import { deferred, flush } from '../auth/support.ts';

test('result taps verify fresh Board or Workspace access before canonical routing; guest context stays private', async () => {
  const env = await integration();
  try {
    env.respond((url) =>
      Promise.resolve(
        url.endsWith('/workspaces/' + WORKSPACE)
          ? ok({ ...workspace(), id: WORKSPACE })
          : ok({
              id: BOARD,
              workspaceId: WORKSPACE,
              isArchived: false,
              capabilities: { canReadBoard: true, canWriteBoard: false },
            }),
      ),
    );
    for (const hit of [workspaceHit, boardHit, cardHit])
      assert.equal(
        await verifySearchDestination(
          env.data,
          env.identity,
          hit,
          new AbortController().signal,
        ),
        hit.path,
      );
    assert.equal(
      env.requests.filter((r) => r.url.includes('/workspaces/')).length,
      1,
    );
  } finally {
    env.dispose();
  }
});
test('archived or denied results evict search data and cannot route', async () => {
  for (const hit of [cardHit, workspaceHit]) {
    const env = await integration();
    try {
      const key = [...queryKeys.search(env.identity), 'cached'];
      env.data.queryClient.setQueryData(key, { protected: true });
      env.respond(() => Promise.resolve(json({}, 404)));
      await assert.rejects(
        verifySearchDestination(
          env.data,
          env.identity,
          hit,
          new AbortController().signal,
        ),
      );
      assert.equal(env.data.queryClient.getQueryData(key), undefined);
    } finally {
      env.dispose();
    }
  }
});
test('revocation during a slow Board probe cannot regrant or route', async () => {
  const env = await integration();
  try {
    const response = deferred<Response>();
    env.respond(() => response.promise);
    const attempt = verifySearchDestination(
      env.data,
      env.identity,
      cardHit,
      new AbortController().signal,
    );
    await flush();
    env.data.resources.fenceBoard(BOARD, true);
    response.resolve(
      ok({
        id: BOARD,
        workspaceId: WORKSPACE,
        isArchived: false,
        capabilities: { canReadBoard: true, canWriteBoard: true },
      }),
    );
    await assert.rejects(attempt);
    assert.equal(
      env.data.resources.readable(queryKeys.board(env.identity, BOARD)),
      false,
    );
  } finally {
    env.dispose();
  }
});

test('a stale probe denial cannot revoke a newer verified Board grant', async () => {
  const env = await integration();
  try {
    const response = deferred<Response>();
    env.respond(() => response.promise);
    const attempt = verifySearchDestination(
      env.data,
      env.identity,
      cardHit,
      new AbortController().signal,
    );
    await flush();
    env.data.resources.fenceBoard(BOARD);
    env.data.resources.confirmBoard(BOARD, true, WORKSPACE);
    const key = queryKeys.board(env.identity, BOARD);
    env.data.queryClient.setQueryData(key, { title: 'New authoritative data' });
    response.resolve(json({}, 403));
    await assert.rejects(attempt);
    assert.equal(env.data.resources.readable(key), true);
    assert.deepEqual(env.data.queryClient.getQueryData(key), {
      title: 'New authoritative data',
    });
  } finally {
    env.dispose();
  }
});
