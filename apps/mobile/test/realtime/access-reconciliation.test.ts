import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { BOARD, WORKSPACE, integration, ok } from './integration-support.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';

function aggregates(c: Awaited<ReturnType<typeof integration>>) {
  return [
    queryKeys.boards(c.identity, null),
    queryKeys.workspaces(c.identity),
    queryKeys.notifications(c.identity),
    queryKeys.home(c.identity),
    queryKeys.tasks(c.identity),
    queryKeys.search(c.identity),
  ].map((key, i) => c.observe(key, `aggregate-${i}`));
}

for (const event of [
  'board:archived',
  'board:restored',
  'board:access-changed',
  'member:role-changed',
]) {
  test(`${event} recovers mounted aggregates once after fencing and access verification`, async () => {
    const c = await integration();
    try {
      await c.join();
      const observers = aggregates(c);
      c.configure({
        archived: event === 'board:archived',
        writable: event !== 'member:role-changed',
      });
      const before = c.requests.length;
      for (let i = 0; i < 10; i++)
        c.socket.server(event, { boardId: BOARD, userId: c.identity.userId });
      observers.forEach((observer) => {
        assert.equal(observer.getCurrentResult().data, undefined);
        const error = observer.getCurrentResult().error;
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, 'RESOURCE_ACCESS_CHANGED');
      });
      c.time.advance(50);
      await flush();
      c.socket.ack(
        c.socket.commands.findLastIndex(
          (command) => command.event === 'board:join',
        ),
      );
      await flush();
      observers.forEach((observer) => {
        assert.equal(observer.getCurrentResult().status, 'success');
        assert.equal(observer.getCurrentResult().data, 1);
      });
      assert.equal(
        c.requests.length,
        before + 7,
        'one Board probe and six authoritative aggregate reads',
      );
    } finally {
      c.dispose();
    }
  });
}

test('global access and Workspace revocation recover aggregates without fetching revoked Workspace details', async () => {
  const c = await integration();
  try {
    await c.join();
    const observers = aggregates(c);
    const workspaceKey = queryKeys.workspace(c.identity, WORKSPACE);
    const workspace = c.observe(workspaceKey, 'workspace-detail');
    const before = c.requests.length;
    c.socket.server('workspace:access-revoked', { workspaceId: WORKSPACE });
    c.socket.server('access:changed');
    c.time.advance(50);
    await flush();
    observers.forEach((observer) =>
      assert.equal(observer.getCurrentResult().status, 'success'),
    );
    assert.equal(workspace.getCurrentResult().data, undefined);
    assert.equal(c.requests.length, before + 7);
    assert.equal(
      c.realtime.getBoardSnapshot(BOARD).canRead,
      true,
      'independent Board membership remains valid',
    );
  } finally {
    c.dispose();
  }
});

test('confirmed Board revocation recovers only safe aggregates and remains blocked through global reconciliation', async () => {
  const c = await integration();
  try {
    await c.join();
    const observers = aggregates(c);
    const board = c.observe(c.cardKey);
    const before = c.requests.length;
    c.socket.server('board:access-revoked', { boardId: BOARD });
    c.time.advance(50);
    await flush();
    observers.forEach((observer) =>
      assert.equal(observer.getCurrentResult().status, 'success'),
    );
    assert.equal(board.getCurrentResult().data, undefined);
    assert.equal(c.requests.length, before + 6);
    c.socket.server('access:changed');
    c.time.advance(50);
    await flush();
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'unavailable');
    assert.equal(
      c.requests.filter((request) => request.url.endsWith(`/boards/${BOARD}`))
        .length,
      1,
    );
    await assert.rejects(
      c.data.api.json('/protected', (value) => value, {
        identity: c.identity,
        resourceKey: c.cardKey,
      }),
      { code: 'RESOURCE_ACCESS_CHANGED' },
    );
  } finally {
    c.dispose();
  }
});

test('global reconciliation recovers mounted aggregates even with no Board consumer', async () => {
  const c = await integration();
  try {
    c.socket.server('connect');
    const observers = aggregates(c);
    const workspace = c.observe(
      queryKeys.workspace(c.identity, WORKSPACE),
      'workspace',
    );
    const before = c.requests.length;
    c.socket.server('access:changed');
    c.time.advance(50);
    await flush();
    [...observers, workspace].forEach((observer) =>
      assert.equal(observer.getCurrentResult().status, 'success'),
    );
    assert.equal(
      c.requests.length,
      before + 7,
      'only affected aggregates, no Board probe',
    );
  } finally {
    c.dispose();
  }
});

test('an account switch during access verification cannot refresh or restore old aggregates', async () => {
  const c = await integration();
  try {
    await c.join();
    aggregates(c);
    const oldIdentity = c.identity;
    const gate = deferred<Response>();
    c.respond((url) =>
      url.endsWith(`/boards/${BOARD}`) ? gate.promise : null,
    );
    c.socket.server('board:archived', { boardId: BOARD });
    c.time.advance(50);
    await flush();
    await c.manager.establishSession(loginResponse(USER_B));
    const freshKey = queryKeys.notifications(c.identity);
    c.data.queryClient.setQueryData(freshKey, 'new account');
    const before = c.requests.length;
    gate.resolve(
      ok({
        id: BOARD,
        workspaceId: WORKSPACE,
        isArchived: false,
        capabilities: { canReadBoard: true, canWriteBoard: true },
      }),
    );
    await flush();
    c.time.advance(100);
    await flush();
    assert.equal(c.requests.length, before);
    assert.equal(c.data.queryClient.getQueryData(freshKey), 'new account');
    assert.equal(
      c.data.queryClient.getQueryData(queryKeys.home(oldIdentity)),
      undefined,
    );
  } finally {
    c.dispose();
  }
});
