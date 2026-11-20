import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyNotificationDestination } from '../../src/features/notifications/navigation.ts';
import { createInvitationFlow } from '../../src/features/workspaces/invitations/flow.ts';
import { decodeNotification } from '../../src/features/notifications/decoder.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { notification, page, proof, boardId, workspaceId } from './fixtures.ts';
import { workspace } from '../workspaces/fixtures.ts';
import { deferred, flush } from '../auth/support.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { workspaceDirectoryFilters } from '../../src/features/workspaces/api.ts';
test('a current Workspace denial still evicts its grant and directory entry', async () => {
  const env = await integration();
  try {
    const row = notification(1, {
      kind: 'MEMBERSHIP_CHANGED',
      context: { workspaceId, boardId: null, cardId: null },
      target: { kind: 'workspace', path: '/workspaces/' + workspaceId },
    });
    const key = queryKeys.workspace(env.identity, workspaceId);
    const directory = queryKeys.workspaces(
      env.identity,
      workspaceDirectoryFilters,
    );
    env.data.resources.confirmWorkspace(workspaceId);
    env.data.queryClient.setQueryData(key, { current: true });
    env.data.queryClient.setQueryData(directory, [
      { ...workspace(), id: workspaceId },
    ]);
    env.respond((url) =>
      Promise.resolve(
        new URL(url).pathname === '/api/notifications'
          ? json(page([row]))
          : json({}, 403),
      ),
    );
    await assert.rejects(
      verifyNotificationDestination(
        env.data,
        env.identity,
        row,
        { filter: 'all', page: 1 },
        new AbortController().signal,
      ),
      { status: 403 },
    );
    assert.equal(env.data.resources.readable(key), false);
    assert.equal(env.data.queryClient.getQueryData(key), undefined);
    assert.equal(env.data.queryClient.getQueryData(directory), undefined);
  } finally {
    env.dispose();
  }
});
test('a concurrent Workspace confirmation survives an older notification probe 403', async () => {
  const env = await integration();
  try {
    const row = notification(1, {
      kind: 'MEMBERSHIP_CHANGED',
      context: { workspaceId, boardId: null, cardId: null },
      target: { kind: 'workspace', path: '/workspaces/' + workspaceId },
    });
    const response = deferred<Response>();
    let probes = 0;
    const latest = { ...workspace(), id: workspaceId };
    env.respond((url) => {
      if (new URL(url).pathname === '/api/notifications')
        return Promise.resolve(json(page([row])));
      return ++probes === 1 ? response.promise : Promise.resolve(ok(latest));
    });
    const older = verifyNotificationDestination(
      env.data,
      env.identity,
      row,
      { filter: 'all', page: 1 },
      new AbortController().signal,
    );
    await flush();
    assert.equal(probes, 1);
    const newer = await verifyNotificationDestination(
      env.data,
      env.identity,
      row,
      { filter: 'all', page: 1 },
      new AbortController().signal,
    );
    assert.equal(newer, row.target?.path);
    const key = queryKeys.workspace(env.identity, workspaceId);
    const directory = queryKeys.workspaces(
      env.identity,
      workspaceDirectoryFilters,
    );
    env.data.queryClient.setQueryData(key, latest);
    env.data.queryClient.setQueryData(directory, [latest]);
    response.resolve(json({}, 403));
    await assert.rejects(older, { code: 'RESOURCE_ACCESS_CHANGED' });
    assert.equal(env.data.resources.readable(key), true);
    assert.deepEqual(env.data.queryClient.getQueryData(key), latest);
    assert.deepEqual(env.data.queryClient.getQueryData(directory), [latest]);
  } finally {
    env.dispose();
  }
});
test('fresh owned rows allow only guarded Workspace/Board/Card destinations; no hidden name lookups', async () => {
  for (const kind of ['workspace', 'board', 'card'] as const) {
    const env = await integration();
    try {
      const row = notification(1, {
        target:
          kind === 'workspace'
            ? { kind, path: '/workspaces/' + workspaceId }
            : kind === 'board'
              ? { kind, path: '/boards/' + boardId }
              : notification().target,
      });
      env.respond((input) => {
        const url = new URL(input);
        return Promise.resolve(
          url.pathname === '/api/notifications'
            ? json(page([row]))
            : kind === 'workspace'
              ? ok({ ...workspace(), id: workspaceId })
              : ok({
                  id: boardId,
                  workspaceId,
                  isArchived: true,
                  capabilities: { canReadBoard: true, canWriteBoard: false },
                }),
        );
      });
      assert.equal(
        await verifyNotificationDestination(
          env.data,
          env.identity,
          row,
          { filter: 'all', page: 1 },
          new AbortController().signal,
        ),
        row.target?.path,
      );
      assert.equal(
        env.requests.filter(({ url }) => url.includes('/workspaces/')).length,
        kind === 'workspace' ? 1 : 0,
      );
    } finally {
      env.dispose();
    }
  }
});
test('fresh invitation proof goes only to the session-bound memory flow and canonical recipient route', async () => {
  const env = await integration(),
    flow = createInvitationFlow(env.time, () => env.time.now());
  try {
    const wire = notification(1, {
      kind: 'WORKSPACE_INVITED',
      target: {
        kind: 'invitation',
        path: '/invitations/workspace#proof=' + proof,
      },
    });
    env.respond(() => Promise.resolve(json(page([wire]))));
    const safe = decodeNotification(wire);
    assert.equal(
      await verifyNotificationDestination(
        env.data,
        env.identity,
        safe,
        { filter: 'all', page: 1 },
        new AbortController().signal,
        flow,
      ),
      '/invitations/workspace',
    );
    const claim = flow.claim(env.identity);
    assert.equal(claim?.proof, proof);
    claim?.finish();
    assert.ok(!JSON.stringify(safe).includes(proof));
  } finally {
    flow.clear();
    env.dispose();
  }
});
test('revoke during target fetch prevents a delayed grant from navigating or restoring details', async () => {
  const env = await integration();
  try {
    const response = deferred<Response>();
    env.respond((url) =>
      new URL(url).pathname === '/api/notifications'
        ? Promise.resolve(json(page([notification()])))
        : response.promise,
    );
    const request = verifyNotificationDestination(
      env.data,
      env.identity,
      notification(),
      { filter: 'all', page: 1 },
      new AbortController().signal,
    );
    await flush();
    env.data.evict(env.identity, [queryKeys.notifications(env.identity)]);
    response.resolve(
      ok({
        id: boardId,
        workspaceId,
        isArchived: false,
        capabilities: { canReadBoard: true, canWriteBoard: true },
      }),
    );
    await assert.rejects(request);
  } finally {
    env.dispose();
  }
});

test('a stale denial cannot revoke a newer authoritative Board grant', async () => {
  const env = await integration();
  try {
    const response = deferred<Response>();
    env.respond((url) =>
      new URL(url).pathname === '/api/notifications'
        ? Promise.resolve(json(page([notification()])))
        : response.promise,
    );
    const request = verifyNotificationDestination(
      env.data,
      env.identity,
      notification(),
      { filter: 'all', page: 1 },
      new AbortController().signal,
    );
    await flush();
    env.data.resources.fenceBoard(boardId);
    env.data.resources.confirmBoard(boardId, true, workspaceId);
    const key = queryKeys.board(env.identity, boardId);
    env.data.queryClient.setQueryData(key, { current: true });
    response.resolve(json({}, 403));
    await assert.rejects(request);
    assert.equal(env.data.resources.readable(key), true);
    assert.deepEqual(env.data.queryClient.getQueryData(key), { current: true });
  } finally {
    env.dispose();
  }
});
