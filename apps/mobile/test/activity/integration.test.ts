import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryObserver } from '@tanstack/react-query';
import {
  boardActivityOptions,
  workspaceActivityOptions,
  discardActivity,
} from '../../src/features/activity/queries.ts';
import { activityKeys } from '../../src/features/activity/keys.ts';
import { verifyActivityTarget } from '../../src/features/activity/navigation.ts';
import { decodeBoardActivity } from '../../src/features/activity/board/decoder.ts';
import {
  hintTargets,
  workspaceActivityTargets,
} from '../../src/infrastructure/realtime/reconciliation.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { parseResourceId } from '../../src/navigation/routes.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import {
  integration,
  json,
  ok,
  BOARD,
} from '../realtime/integration-support.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { page, uuid } from '../workspaces/fixtures.ts';
import { cardDto } from '../workspaces/kanban-fixtures.ts';
import {
  activityBoard,
  activityWorkspace,
  boardEvent,
  boardId,
  workspaceEvent,
  workspaceId,
} from './fixtures.ts';

const ws = parseResourceId(workspaceId)!;
const board = parseResourceId(boardId)!;
const signal = new AbortController().signal;

for (const restored of [false, true])
  test(`unknown-Workspace Board revocation fences a pending activity response${restored ? ' even after a new grant' : ''}`, async (t) => {
    const env = await setup();
    t.after(env.dispose);
    env.socket.server('connect');
    const pending = deferred<Response>();
    env.state.pending = pending.promise;
    const options = workspaceActivityOptions(env.data, env.identity, ws, 1);
    const read = env.data.queryClient
      .fetchQuery(options)
      .catch((error: unknown) => error);
    await flush();
    assert.equal(env.data.resources.boardWorkspace(board), undefined);
    assert.deepEqual([...env.data.resources.trackedBoardIds()], []);
    const request = env.requests.find((entry) =>
      entry.url.includes('/activity?'),
    )!;
    env.socket.server('board:access-revoked', { boardId: board });
    assert.equal(
      request.init.signal?.aborted,
      false,
      'unknown parent cannot identify this request for cancellation',
    );
    if (restored) env.data.resources.confirmBoard(board, false, ws);
    pending.resolve(
      json(
        page(
          [
            {
              ...workspaceEvent(),
              eventType: 'BOARD_MOVED',
              board: { id: board, name: 'Revoked private context' },
            },
          ],
          1,
          20,
        ),
      ),
    );
    const result = await read;
    assert.ok(result instanceof ApiError);
    assert.equal(result.code, 'RESOURCE_ACCESS_CHANGED');
    assert.equal(
      env.data.queryClient.getQueryData(options.queryKey),
      undefined,
    );
  });

test('unknown Board revocation does not reject a pending Workspace page about another Board', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  env.socket.server('connect');
  const pending = deferred<Response>();
  env.state.pending = pending.promise;
  const read = env.data.queryClient.fetchQuery(
    workspaceActivityOptions(env.data, env.identity, ws, 1),
  );
  await flush();
  env.socket.server('board:access-revoked', { boardId: board });
  const row = {
    ...workspaceEvent(),
    eventType: 'BOARD_MOVED',
    board: { id: uuid(999), name: 'Still authorized' },
  };
  pending.resolve(json(page([row], 1, 20)));
  const result = await read;
  assert.equal(result.data[0]?.board?.id, row.board.id);
});

async function setup() {
  const env = await integration();
  const state = {
    workspace: activityWorkspace(),
    board: activityBoard(),
    workspaceStatus: 200,
    boardStatus: 200,
    feedStatus: 200,
    workspaces: [workspaceEvent()],
    boards: [boardEvent()],
    pending: null as Promise<Response> | null,
  };
  env.respond((input) => {
    const url = new URL(input);
    const path = url.pathname;
    if (path === `/api/workspaces/${ws}`)
      return Promise.resolve(
        state.workspaceStatus === 200
          ? ok(state.workspace)
          : json({}, state.workspaceStatus),
      );
    if (path === `/api/boards/${board}`)
      return Promise.resolve(
        state.boardStatus === 200
          ? ok(state.board)
          : json({}, state.boardStatus),
      );
    if (path.endsWith('/activity') || path.endsWith('/activities'))
      return (
        state.pending ??
        Promise.resolve(
          state.feedStatus === 200
            ? json(
                page<unknown>(
                  path.endsWith('/activity') ? state.workspaces : state.boards,
                  Number(url.searchParams.get('page')),
                  20,
                ),
              )
            : json({}, state.feedStatus),
        )
      );
    if (path.endsWith(`/cards/${uuid(3001)}`))
      return Promise.resolve(ok(cardDto(1)));
    return null;
  });
  return { ...env, state };
}

for (const role of ['ADMIN', 'MEMBER'] as const)
  test(`Workspace ${role} history uses explicit membership and a distinct REST scope`, async (t) => {
    const env = await setup();
    t.after(env.dispose);
    env.state.workspace.role = role;
    const result = await env.data.queryClient.fetchQuery(
      workspaceActivityOptions(env.data, env.identity, ws, 1),
    );
    assert.equal(result.permissionScope, role);
    assert.equal(result.data.length, 1);
    assert.equal(
      env.requests.filter((r) => r.url.includes('/activities')).length,
      0,
    );
    assert.equal(
      env.requests.filter((r) => r.url.includes('/members')).length,
      0,
    );
  });

for (const label of ['Board-only guest', 'outsider'])
  test(`${label} cannot substitute a Board grant for Workspace history`, async (t) => {
    const env = await setup();
    t.after(env.dispose);
    env.state.workspaceStatus = 404;
    env.data.resources.confirmBoard(board, true, ws);
    await assert.rejects(
      env.data.queryClient.fetchQuery(
        workspaceActivityOptions(env.data, env.identity, ws, 1),
      ),
    );
    assert.equal(
      env.requests.filter((r) => r.url.includes('/activity?')).length,
      0,
    );
    assert.equal(
      env.data.resources.readable(queryKeys.workspace(env.identity, ws)),
      false,
    );
  });

for (const role of ['OWNER', 'MEMBER', null] as const)
  for (const archived of [false, true])
    test(`Board ${role ?? 'WORKSPACE_VISIBLE reader'} ${archived ? 'archived' : 'active'} history needs no roster`, async (t) => {
      const env = await setup();
      t.after(env.dispose);
      env.state.board.currentUserRole = role;
      env.state.board.isArchived = archived;
      env.state.board.archivedAt = archived ? boardEvent().createdAt : null;
      const result = await env.data.queryClient.fetchQuery(
        boardActivityOptions(env.data, env.identity, board, 1),
      );
      assert.equal(result.data.length, 1);
      assert.equal(result.archived, archived);
      assert.equal(
        env.requests.filter((r) => r.url.includes('/members')).length,
        0,
      );
    });

test('private outsider is denied before requesting Board activity', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  env.state.boardStatus = 404;
  await assert.rejects(
    env.data.queryClient.fetchQuery(
      boardActivityOptions(env.data, env.identity, board, 1),
    ),
  );
  assert.equal(
    env.requests.filter((r) => r.url.includes('/activities?')).length,
    0,
  );
});

for (const scope of ['board', 'workspace'] as const)
  test(`${scope} role transition drops protected old pages even when the next feed fails`, async (t) => {
    const env = await setup();
    t.after(env.dispose);
    env.state.board.currentUserRole = 'OWNER';
    env.state.workspace.role = 'ADMIN';
    const observer =
      scope === 'board'
        ? new QueryObserver(
            env.data.queryClient,
            boardActivityOptions(env.data, env.identity, board, 1),
          )
        : new QueryObserver(
            env.data.queryClient,
            workspaceActivityOptions(env.data, env.identity, ws, 1),
          );
    const stop = observer.subscribe(() => {});
    t.after(stop);
    await flush();
    assert.ok(observer.getCurrentResult().data);
    env.state.board.currentUserRole = null;
    env.state.workspace.role = 'MEMBER';
    env.state.feedStatus = 503;
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data, undefined);
    const error = observer.getCurrentResult().error;
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'RESOURCE_ACCESS_CHANGED');
  });

test('access revocation during paging and account switch reject late REST results', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  const pending = deferred<Response>();
  env.state.pending = pending.promise;
  const identity = env.identity;
  const options = boardActivityOptions(env.data, identity, board, 1);
  const read = env.data.queryClient
    .fetchQuery(options)
    .catch((e: unknown) => e);
  await flush();
  env.data.resources.fenceBoard(board, true);
  discardActivity(env.data, identity, activityKeys.board(identity, board));
  pending.resolve(json(page([boardEvent()], 1, 20)));
  await read;
  assert.equal(env.data.queryClient.getQueryData(options.queryKey), undefined);
  const late = deferred<Response>();
  env.state.pending = late.promise;
  env.data.resources.confirmBoard(board, false, ws);
  const second = env.data.queryClient
    .fetchQuery(boardActivityOptions(env.data, identity, board, 2))
    .catch((e: unknown) => e);
  await flush();
  await env.manager.establishSession(loginResponse(USER_B));
  late.resolve(
    json(
      page(
        Array.from({ length: 21 }, (_, i) => boardEvent(i)),
        2,
        20,
      ),
    ),
  );
  await second;
  assert.equal(env.data.queryClient.getQueryData(options.queryKey), undefined);
  assert.ok(
    env.data.queryClient
      .getQueryCache()
      .getAll()
      .every((query) => query.queryKey[2] !== identity.userId),
  );
});

test('loaded activity survives a background 503, but 429 cooldown prevents repeated HTTP', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  const options = boardActivityOptions(env.data, env.identity, board, 1);
  const observer = new QueryObserver(env.data.queryClient, options);
  const stop = observer.subscribe(() => {});
  t.after(stop);
  await flush();
  env.state.feedStatus = 503;
  await observer.refetch();
  assert.equal(observer.getCurrentResult().data?.data.length, 1);
  env.respond((input) =>
    input.includes('/activities?')
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
      : input.endsWith(`/boards/${board}`)
        ? Promise.resolve(ok(env.state.board))
        : null,
  );
  await observer.refetch();
  const before = env.requests.length;
  await observer.refetch();
  assert.equal(env.requests.length, before);
  assert.equal(observer.getCurrentResult().data?.data.length, 1);
});

test('safe destinations recheck Workspace/Board and Card relation before producing a route', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  const source = activityKeys.workspace(env.identity, ws);
  const target = { kind: 'board' as const, boardId: board, workspaceId: ws };
  assert.equal(
    await verifyActivityTarget(env.data, env.identity, source, target, signal),
    `/boards/${board}`,
  );
  env.state.board.workspaceId = uuid(8);
  await assert.rejects(
    verifyActivityTarget(env.data, env.identity, source, target, signal),
  );
  env.state.board.workspaceId = ws;
  const event = decodeBoardActivity(boardEvent(), board, false);
  const card = { kind: 'card' as const, boardId: board, event };
  assert.equal(
    await verifyActivityTarget(
      env.data,
      env.identity,
      activityKeys.board(env.identity, board),
      card,
      signal,
    ),
    `/boards/${board}/cards/${uuid(3001)}`,
  );
  for (const entityType of ['COLUMN', 'COMMENT', 'MEMBER'])
    await assert.rejects(
      verifyActivityTarget(
        env.data,
        env.identity,
        source,
        { ...card, event: { ...event, entityType } },
        signal,
      ),
    );
  env.respond((input) =>
    input.endsWith(`/boards/${board}`)
      ? Promise.resolve(ok(env.state.board))
      : input.includes('/cards/')
        ? Promise.resolve(ok({ ...cardDto(1), boardId: uuid(8) }))
        : null,
  );
  await assert.rejects(
    verifyActivityTarget(env.data, env.identity, source, card, signal),
  );
});

test('pending deep links are cancelled by a source fence, deletion and explicit AbortSignal', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  const source = activityKeys.board(env.identity, board);
  const event = decodeBoardActivity(boardEvent(), board, false);
  const target = { kind: 'card' as const, boardId: board, event };
  const pending = deferred<Response>();
  env.respond((input) =>
    input.endsWith(`/boards/${board}`)
      ? Promise.resolve(ok(env.state.board))
      : input.includes('/cards/')
        ? pending.promise
        : null,
  );
  const read = verifyActivityTarget(
    env.data,
    env.identity,
    source,
    target,
    signal,
  );
  const rejection = assert.rejects(read);
  await flush();
  discardActivity(env.data, env.identity, source);
  pending.resolve(ok(cardDto(1)));
  await rejection;
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    verifyActivityTarget(env.data, env.identity, source, target, abort.signal),
  );
  env.respond((input) =>
    input.endsWith(`/boards/${board}`)
      ? Promise.resolve(ok(env.state.board))
      : input.includes('/cards/')
        ? Promise.resolve(json({}, 404))
        : null,
  );
  await assert.rejects(
    verifyActivityTarget(env.data, env.identity, source, target, signal),
  );
});

test('a burst of socket events coalesces one REST feed read and never appends audit rows', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  // Existing harness watches BOARD; use the same activity Board id in responses.
  env.state.board.id = BOARD;
  env.state.boards = [{ ...boardEvent(), boardId: BOARD }];
  const baseRespond = (input: string) =>
    input.endsWith(`/boards/${BOARD}`)
      ? Promise.resolve(ok(env.state.board))
      : input.includes(`/boards/${BOARD}/activities?`)
        ? Promise.resolve(json(page(env.state.boards, 1, 20)))
        : null;
  env.respond(baseRespond);
  await env.join();
  const options = boardActivityOptions(
    env.data,
    env.identity,
    parseResourceId(BOARD)!,
    1,
  );
  const observer = new QueryObserver(env.data.queryClient, options);
  const stop = observer.subscribe(() => {});
  t.after(stop);
  await flush();
  const before = env.requests.filter((r) =>
    r.url.includes('/activities?'),
  ).length;
  for (let i = 0; i < 30; i++)
    env.socket.server('card:moved', {
      boardId: BOARD,
      cardId: uuid(3001),
      fromColumnId: uuid(2001),
      toColumnId: uuid(2002),
    });
  assert.equal(observer.getCurrentResult().data?.data.length, 1);
  env.time.advance(50);
  await flush();
  assert.equal(
    env.requests.filter((r) => r.url.includes('/activities?')).length,
    before + 1,
  );
  assert.deepEqual(
    observer.getCurrentResult().data?.data.map((row) => row.id),
    [boardEvent().id],
  );
  const other = activityKeys.board(env.identity, uuid(77));
  assert.ok(
    !hintTargets(env.identity, 'card:moved', {
      boardId: BOARD,
      cardId: uuid(3001),
    }).some((key) => JSON.stringify(key) === JSON.stringify(other)),
  );
});

test('offline reads perform no HTTP and reconnect obtains only server-backed rows', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  env.environment(false, false);
  const api = (
    await import('../../src/features/activity/board/api.ts')
  ).createBoardActivityApi(env.data.api, env.identity, board);
  const before = env.requests.length;
  await assert.rejects(
    api.list(1, false, signal),
    (error: unknown) => error instanceof ApiError && error.kind === 'offline',
  );
  assert.equal(env.requests.length, before);
  env.environment(true, true);
  const result = await api.list(1, false, signal);
  assert.deepEqual(
    result.data.map((row) => row.id),
    [boardEvent().id],
  );
});

test('Board revocation evicts Workspace audit context without clearing an unrelated Workspace feed', async (t) => {
  const env = await setup();
  t.after(env.dispose);
  await env.join();
  const affected = activityKeys.workspace(env.identity, ws);
  const unrelated = activityKeys.workspace(env.identity, uuid(42));
  env.data.queryClient.setQueryData(affected, {
    data: [
      { ...workspaceEvent(), board: { id: BOARD, name: 'Private Board' } },
    ],
  });
  env.data.queryClient.setQueryData(unrelated, { data: [workspaceEvent()] });
  assert.deepEqual(workspaceActivityTargets(env.data, env.identity, BOARD), [
    affected,
  ]);
  env.socket.server('board:access-revoked', { boardId: BOARD });
  assert.equal(env.data.queryClient.getQueryData(affected), undefined);
  assert.ok(env.data.queryClient.getQueryData(unrelated));
});
