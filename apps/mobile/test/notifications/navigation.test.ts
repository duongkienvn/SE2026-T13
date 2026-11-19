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
