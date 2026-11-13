import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceDetailOptions } from '../../src/features/workspaces/queries.ts';
import {
  BOARD,
  CARD,
  WORKSPACE,
  integration,
  json,
  ok,
  payload,
} from './integration-support.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import type { ResourceId } from '../../src/navigation/routes.ts';

test('REST Workspace denial suspends a live room and rejoins it after one authorized probe', async (t) => {
  const c = await integration();
  t.after(c.dispose);
  await c.join();
  const identity = c.identity;
  c.respond((url) =>
    url.endsWith(`/workspaces/${WORKSPACE}`)
      ? Promise.resolve(json({}, 404))
      : null,
  );
  await assert.rejects(
    c.data.queryClient.fetchQuery(
      workspaceDetailOptions(c.data, identity, WORKSPACE as ResourceId),
    ),
  );
  assert.equal(c.realtime.getBoardSnapshot(BOARD).canRead, false);
  const leave = c.socket.commands.length - 1;
  assert.equal(c.socket.commands[leave]?.event, 'board:leave');
  c.socket.ack(leave);
  const before = c.requests.length;
  c.time.advance(50);
  await flush();
  assert.deepEqual(
    c.requests.slice(before).map(({ url }) => new URL(url).pathname),
    [`/api/boards/${BOARD}`],
  );
  const join = c.socket.commands.length - 1;
  assert.equal(c.socket.commands[join]?.event, 'board:join');
  assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'joining');
  c.socket.ack(join);
  assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'live');
});

test('account replacement aborts a Workspace-triggered Board probe before it can restore access', async (t) => {
  const c = await integration();
  t.after(c.dispose);
  const oldIdentity = c.identity;
  const late = deferred<Response>();
  const boardPath = `/boards/${BOARD}`;
  c.respond((url) =>
    url.endsWith(`/workspaces/${WORKSPACE}`)
      ? Promise.resolve(json({}, 403))
      : url.endsWith(boardPath)
        ? late.promise
        : null,
  );
  c.data.queryClient.setQueryData(c.cardKey, 'private');
  await assert.rejects(
    c.data.queryClient.fetchQuery(
      workspaceDetailOptions(c.data, oldIdentity, WORKSPACE as ResourceId),
    ),
  );
  c.time.advance(50);
  await flush();
  const probe = c.requests.find(({ url }) => url.endsWith(boardPath));
  assert.ok(probe);
  assert.equal(probe.init.signal?.aborted, false);
  await c.manager.establishSession(loginResponse(USER_B));
  assert.equal(probe.init.signal?.aborted, true);
  const newKey = queryKeys.card(c.identity, BOARD, CARD);
  c.data.resources.fenceBoard(BOARD, true);
  late.resolve(
    ok({
      id: BOARD,
      workspaceId: WORKSPACE,
      isArchived: false,
      capabilities: { canReadBoard: true, canWriteBoard: true },
    }),
  );
  await flush();
  assert.equal(c.data.resources.readable(newKey), false);
  assert.equal(c.data.queryClient.getQueryData(newKey), undefined);
  assert.equal(
    c.data.queryClient.getQueryData(queryKeys.card(oldIdentity, BOARD, CARD)),
    undefined,
  );
});

test('revocation clears details and aggregates, aborts queries, fences delayed HTTP and queued optimistic mutations', async () => {
  const c = await integration();
  try {
    await c.join();
    const identity = c.identity;
    const key = c.cardKey;
    c.data.queryClient.setQueryData(key, 'private');
    c.data.queryClient.setQueryData(
      queryKeys.notifications(identity),
      'private notification',
    );
    const gate = deferred<Response>();
    c.respond((url) => (url.endsWith('/slow') ? gate.promise : null));
    const request = c.data.api.json(`/boards/${BOARD}/slow`, (value) => value, {
      identity,
      resourceKey: key,
    });
    const fenced = assert.rejects(request, { code: 'RESOURCE_ACCESS_CHANGED' });
    const mutationGate = deferred<string>();
    const first = c.data.optimistic({
      identity,
      key,
      update: () => 'first',
      mutation: () => mutationGate.promise,
    });
    const firstFailure = assert.rejects(first, {
      code: 'RESOURCE_ACCESS_CHANGED',
    });
    let queuedCalls = 0;
    const queued = c.data.optimistic({
      identity,
      key,
      update: () => 'queued',
      mutation: async () => {
        queuedCalls++;
        return 'write';
      },
    });
    const queuedFailure = assert.rejects(queued, {
      code: 'RESOURCE_ACCESS_CHANGED',
    });
    await flush();
    c.socket.server('board:access-revoked', { boardId: BOARD });
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'unavailable');
    assert.equal(c.data.queryClient.getQueryData(key), undefined);
    assert.equal(
      c.data.queryClient.getQueryData(queryKeys.notifications(identity)),
      undefined,
    );
    mutationGate.resolve('private success');
    gate.resolve(ok('private response'));
    await Promise.all([fenced, firstFailure, queuedFailure]);
    await flush();
    assert.equal(queuedCalls, 0);
    assert.equal(c.data.queryClient.getQueryData(key), undefined);
    await assert.rejects(
      c.data.api.json(`/boards/${BOARD}/card`, (value) => value, {
        identity,
        resourceKey: key,
      }),
      { code: 'RESOURCE_ACCESS_CHANGED' },
    );
  } finally {
    c.dispose();
  }
});

test('a revoked active query drops its protected result, aborts its signal and ignores a delayed server response', async () => {
  const c = await integration();
  try {
    await c.join();
    const key = c.cardKey;
    const gate = deferred<Response>();
    c.respond((url) => (url.endsWith('/delayed') ? gate.promise : null));
    c.observe(key, 'delayed');
    const pending = c.data.invalidate(c.identity, [key]);
    await flush();
    const request = c.requests.find((entry) => entry.url.endsWith('/delayed'))!;
    c.socket.server('board:access-revoked', { boardId: BOARD });
    assert.equal(request.init.signal?.aborted, true);
    assert.equal(c.data.queryClient.getQueryData(key), undefined);
    gate.resolve(ok('private late value'));
    await pending;
    await flush();
    assert.equal(c.data.queryClient.getQueryData(key), undefined);
  } finally {
    c.dispose();
  }
});
test('Workspace revocation rechecks independent Board grants and own membership downgrade becomes read-only', async () => {
  const c = await integration();
  try {
    await c.join();
    c.socket.server('workspace:access-revoked', { workspaceId: WORKSPACE });
    c.socket.server('access:changed');
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canWrite, false);
    const before = c.requests.length;
    c.time.advance(50);
    await flush();
    assert.equal(
      c.requests.length,
      before + 1,
      'adjacent access hints share one REST probe',
    );
    c.socket.ack(
      c.socket.commands.findLastIndex(
        (command) => command.event === 'board:join',
      ),
    );
    assert.equal(
      c.realtime.getBoardSnapshot(BOARD).status,
      'live',
      'independent explicit Board read grant remains valid',
    );
    c.configure({ writable: false });
    c.socket.server('member:removed', {
      boardId: BOARD,
      userId: c.identity.userId,
      retainsReadAccess: true,
    });
    c.time.advance(50);
    await flush();
    c.socket.ack(
      c.socket.commands.findLastIndex(
        (command) => command.event === 'board:join',
      ),
    );
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canRead, true);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canWrite, false);
    await assert.rejects(
      c.data.optimistic({
        identity: c.identity,
        key: c.cardKey,
        update: () => 'bad',
        mutation: async () => 'bad',
      }),
      { code: 'RESOURCE_ACCESS_CHANGED' },
    );
  } finally {
    c.dispose();
  }
});
test('archive and PRIVATE access changes are fenced immediately and only authoritative REST can confirm subsequent access', async () => {
  const c = await integration();
  try {
    await c.join();
    c.configure({ archived: true });
    c.socket.server('board:archived', { boardId: BOARD });
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canWrite, false);
    c.time.advance(50);
    await flush();
    c.socket.ack(
      c.socket.commands.findLastIndex(
        (command) => command.event === 'board:join',
      ),
    );
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canRead, true);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canWrite, false);
    c.configure({ allowed: false });
    c.socket.server('board:access-changed', { boardId: BOARD });
    c.time.advance(50);
    await flush();
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'unavailable');
    assert.equal(
      c.data.queryClient.getQueryData(queryKeys.card(c.identity, BOARD, CARD)),
      undefined,
    );
  } finally {
    c.dispose();
  }
});
test('REST child denial escalates only after an authoritative Board denial; the session remains valid', async () => {
  const c = await integration();
  try {
    await c.join();
    c.respond((url) =>
      url.endsWith('/denied')
        ? Promise.resolve(new Response('{}', { status: 403 }))
        : null,
    );
    await assert.rejects(
      c.data.api.json(`/boards/${BOARD}/denied`, (value) => value, {
        identity: c.identity,
        resourceKey: c.cardKey,
      }),
    );
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'live');
    c.configure({ allowed: false });
    c.time.advance(50);
    await flush();
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'unavailable');
    assert.equal(c.manager.getSnapshot().status, 'authenticated');
  } finally {
    c.dispose();
  }
});
test('old socket callbacks, hints and in-flight requests cannot clear or populate the next account', async () => {
  const c = await integration();
  try {
    await c.join();
    const oldIdentity = c.identity;
    const oldKey = c.cardKey;
    const old = c.socket;
    const late = old.listeners.get('board:access-revoked')![0]!;
    const gate = deferred<Response>();
    c.respond((url) => (url.endsWith('/slow') ? gate.promise : null));
    const pending = c.data.api.json('/slow', (value) => value, {
      identity: oldIdentity,
    });
    const check = assert.rejects(pending, { kind: 'session-changed' });
    c.socket.server('card:updated', payload);
    await c.manager.establishSession(loginResponse(USER_B));
    await check;
    c.data.queryClient.setQueryData(
      queryKeys.notifications(c.identity),
      'new user',
    );
    late({ boardId: BOARD });
    gate.resolve(ok('old user'));
    c.time.advance(100);
    await flush();
    assert.equal(
      c.data.queryClient.getQueryData(queryKeys.notifications(c.identity)),
      'new user',
    );
    assert.equal(c.data.queryClient.getQueryData(oldKey), undefined);
    assert.equal(old.listeners.size, 0);
  } finally {
    c.dispose();
  }
});

test('ID-free access loss also fences queued work whose resource has not populated the cache yet', async () => {
  const c = await integration();
  try {
    await c.join();
    const key = queryKeys.card(c.identity, WORKSPACE, CARD);
    let writes = 0;
    const pending = c.data.optimistic({
      identity: c.identity,
      key,
      update: () => 'private',
      mutation: async () => {
        writes++;
        return 'private';
      },
    });
    const rejected = assert.rejects(pending, {
      code: 'RESOURCE_ACCESS_CHANGED',
    });
    c.socket.server('access:changed');
    await rejected;
    assert.equal(writes, 0);
    assert.equal(c.data.queryClient.getQueryData(key), undefined);
  } finally {
    c.dispose();
  }
});

test('a Board access hint fences cached and queued data even without an active room consumer', async () => {
  const c = await integration();
  try {
    const release = await c.join();
    release();
    c.data.queryClient.setQueryData(c.cardKey, 'private');
    let writes = 0;
    const pending = c.data.optimistic({
      identity: c.identity,
      key: c.cardKey,
      update: () => 'edited',
      mutation: async () => {
        writes++;
      },
    });
    const rejected = assert.rejects(pending, {
      code: 'RESOURCE_ACCESS_CHANGED',
    });
    c.socket.server('board:access-changed', { boardId: BOARD });
    await rejected;
    assert.equal(writes, 0);
    assert.equal(c.data.queryClient.getQueryData(c.cardKey), undefined);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canRead, false);
  } finally {
    c.dispose();
  }
});
