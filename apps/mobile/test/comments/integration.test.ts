import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onlineManager, QueryObserver } from '@tanstack/react-query';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { boardMembersOptions } from '../../src/features/boards/members/queries.ts';
import {
  commentsOptions,
  runCommentWrite,
  canWriteComments,
  uncertainCommentWrite,
  type CommentCommand,
} from '../../src/features/cards/comments/queries.ts';
import { decodeCard } from '../../src/features/cards/decoder.ts';
import { decodeKanbanBoard } from '../../src/features/boards/kanban-api.ts';
import {
  integration,
  json,
  BOARD,
  CARD,
  ok,
} from '../realtime/integration-support.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { member, membershipBoard } from '../board-members/fixtures.ts';
import { cardDto } from '../workspaces/kanban-fixtures.ts';
import { page, uuid } from '../workspaces/fixtures.ts';
import { comment } from './fixtures.ts';

const signal = () => new AbortController().signal;
const success = (data: unknown, status = 200) =>
  json({ success: true, statusCode: status, message: 'OK', data }, status);
const failure = (status: number) =>
  json(
    {
      success: false,
      statusCode: status,
      code: 'COMMENT_ERROR',
      message: 'Rejected',
    },
    status,
  );
async function scenario() {
  const env = await integration();
  const state = {
    rows: [comment()],
    members: Array.from({ length: 101 }, (_, i) => member(i + 1)),
    writeStatus: 0,
    rosterStatus: 0,
  };
  const board = decodeKanbanBoard(membershipBoard(), BOARD)!;
  const card = decodeCard({ ...cardDto(1), id: CARD, boardId: BOARD }, BOARD);
  env.data.queryClient.setQueryData(
    queryKeys.board(env.identity, BOARD),
    board,
  );
  env.data.queryClient.setQueryData(
    queryKeys.card(env.identity, BOARD, CARD),
    card,
  );
  env.data.resources.confirmBoard(BOARD, true);
  env.respond((input, init) => {
    const url = new URL(input),
      method = init.method ?? 'GET';
    if (url.pathname === `/api/boards/${BOARD}`)
      return Promise.resolve(ok(board));
    if (url.pathname.endsWith('/members'))
      return Promise.resolve(
        state.rosterStatus
          ? failure(state.rosterStatus)
          : json(
              page(
                state.members,
                Number(url.searchParams.get('page')),
                Number(url.searchParams.get('limit')),
              ),
            ),
      );
    if (!url.pathname.includes('/comments')) return null;
    if (method === 'GET')
      return Promise.resolve(
        json(
          page(
            state.rows,
            Number(url.searchParams.get('page')),
            Number(url.searchParams.get('limit')),
          ),
        ),
      );
    if (state.writeStatus) return Promise.resolve(failure(state.writeStatus));
    if (method === 'DELETE') {
      state.rows = [];
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const body = JSON.parse(String(init.body));
    const row = { ...comment(), ...body };
    if (method === 'POST') state.rows.push({ ...row, id: uuid(999) });
    else state.rows[0] = row;
    return Promise.resolve(success(row, method === 'POST' ? 201 : 200));
  });
  const scope = { identity: env.identity, boardId: BOARD, cardId: CARD };
  const create = {
    kind: 'create' as const,
    draft: { text: 'New comment', spans: [] },
    rosterPages: [],
  };
  return {
    ...env,
    get socket() {
      return env.socket;
    },
    get identity() {
      return env.identity;
    },
    scope,
    state,
    board,
    card,
    create,
    writes: () =>
      env.requests.filter(({ init }) => init.method && init.method !== 'GET'),
    run: (command: CommentCommand = create, allowed = () => true) =>
      runCommentWrite(env.data, scope, command, allowed, signal()),
  };
}

test('OWNER/MEMBER and explicitly joined guests can write; read-only/nonmember/archived/other author cannot', async () => {
  const env = await scenario();
  try {
    assert.equal(canWriteComments(env.board, env.card), true);
    for (const board of [
      { ...env.board, currentUserRole: null },
      { ...env.board, isArchived: true },
      {
        ...env.board,
        capabilities: { ...env.board.capabilities, canWriteBoard: false },
      },
    ]) {
      assert.equal(canWriteComments(board, env.card), false);
      env.data.queryClient.setQueryData(
        queryKeys.board(env.identity, BOARD),
        board,
      );
      await assert.rejects(env.run());
    }
    env.data.queryClient.setQueryData(
      queryKeys.board(env.identity, BOARD),
      env.board,
    );
    assert.equal(
      canWriteComments(env.board, { ...env.card, isArchived: true }),
      false,
    );
    await assert.rejects(
      runCommentWrite(
        env.data,
        env.scope,
        {
          kind: 'delete',
          page: 1,
          original: { ...comment(), authorId: USER_B },
        },
        () => true,
        signal(),
      ),
    );
    assert.equal(env.writes().length, 0);
    const beforeInvalid = env.requests.length;
    await assert.rejects(
      env.run({ ...env.create, draft: { text: '', spans: [] } }),
    );
    assert.equal(env.requests.length, beforeInvalid);
    await env.run();
    assert.equal(env.writes().length, 1);
    env.data.queryClient.setQueryData(queryKeys.board(env.identity, BOARD), {
      ...env.board,
      currentUserRole: 'MEMBER',
    });
    await env.run();
    assert.equal(env.writes().length, 2);
  } finally {
    env.dispose();
  }
});

test('fresh MOB-25 page 6 validates selected identity; rename, removal or denial never sends stale metadata', async () => {
  const env = await scenario();
  try {
    const target = env.state.members[100];
    const text = `😀 @${target.user.displayName}`;
    const command = {
      kind: 'create' as const,
      draft: {
        text,
        spans: [{ userId: target.user.id, start: 3, end: text.length }],
      },
      rosterPages: [6],
    };
    await env.data.queryClient.fetchQuery(
      boardMembersOptions(env.data, env.identity, BOARD, 6),
    );
    await env.run(command);
    assert.equal(env.writes().length, 1);
    target.user.displayName = 'Changed name';
    await assert.rejects(env.run(command), /Reselect/);
    env.state.members.pop();
    await assert.rejects(env.run(command));
    env.state.rosterStatus = 403;
    await assert.rejects(env.run(command));
    assert.equal(env.writes().length, 1);
    assert.equal(
      env.data.queryClient.getQueryData(
        boardMembersOptions(env.data, env.identity, BOARD, 6).queryKey,
      ),
      undefined,
    );
  } finally {
    env.dispose();
  }
});

test('edit/delete preflight compares REST original; concurrent edits or deleted/moved rows require review', async () => {
  const env = await scenario();
  try {
    const original = comment();
    env.state.rows[0] = {
      ...original,
      content: 'Remote edit',
      updatedAt: '2026-11-20T00:01:00.000Z',
    };
    const edit = {
      kind: 'edit' as const,
      original,
      page: 1,
      draft: { text: 'My unsent edit', spans: [] },
      rosterPages: [],
    };
    await assert.rejects(env.run(edit), /changed/);
    await assert.rejects(
      runCommentWrite(
        env.data,
        env.scope,
        { kind: 'delete', original, page: 1 },
        () => true,
        signal(),
      ),
    );
    assert.equal(env.writes().length, 0);
    env.state.rows = [original];
    await env.run(edit);
    await runCommentWrite(
      env.data,
      env.scope,
      { kind: 'delete', original: env.state.rows[0], page: 1 },
      () => true,
      signal(),
    );
    assert.deepEqual(
      env.writes().map(({ init }) => init.method),
      ['PATCH', 'DELETE'],
    );
  } finally {
    env.dispose();
  }
});

test('rapid taps serialize per Card; timeout/5xx are ambiguous, offline preflight is certain and no POST replays', async () => {
  const env = await scenario();
  const gate = deferred<Response>();
  try {
    env.respond((input, init) =>
      input.includes('/comments') && init.method === 'POST'
        ? gate.promise
        : null,
    );
    const first = env.run();
    await flush();
    await assert.rejects(env.run(), /Wait/);
    gate.resolve(
      success({ ...comment(), content: env.create.draft.text }, 201),
    );
    await first;
    assert.equal(env.writes().length, 1);
    env.respond((input, init) =>
      input.includes('/comments') && init.method === 'POST'
        ? Promise.resolve(failure(503))
        : null,
    );
    await assert.rejects(env.run(), (error: unknown) =>
      uncertainCommentWrite(error),
    );
    assert.equal(env.writes().length, 2);
    onlineManager.setOnline(false);
    await assert.rejects(
      env.run(),
      (error: unknown) =>
        error instanceof ApiError && !uncertainCommentWrite(error),
    );
    assert.equal(env.writes().length, 2);
  } finally {
    onlineManager.setOnline(true);
    env.dispose();
  }
});

test('in-flight POST cannot resurrect data after logout/account switch or Board/roster fences', async () => {
  for (const mode of ['session', 'board', 'roster']) {
    const env = await scenario();
    const gate = deferred<Response>();
    try {
      const key = commentsOptions(env.data, env.scope, 1).queryKey;
      env.respond((input, init) =>
        input.includes('/comments') && init.method === 'POST'
          ? gate.promise
          : null,
      );
      const pending = env.run();
      await flush();
      if (mode === 'session')
        await env.manager.establishSession(loginResponse(USER_B));
      else if (mode === 'board') {
        env.data.resources.fenceBoard(BOARD, true);
        env.data.evict(env.identity, [queryKeys.board(env.identity, BOARD)]);
      } else
        env.data.evict(env.identity, [queryKeys.members(env.identity, BOARD)]);
      gate.resolve(
        success({ ...comment(), content: env.create.draft.text }, 201),
      );
      if (mode === 'roster')
        await pending; // No mentions: a roster fence does not revoke a plain-text write.
      else await assert.rejects(pending);
      assert.equal(env.data.queryClient.getQueryData(key), undefined);
    } finally {
      env.dispose();
    }
  }
});

test('socket hints coalesce scoped REST reads, never synthesize comments or notifications; revocation clears observers', async () => {
  const env = await scenario();
  const observer = new QueryObserver(
    env.data.queryClient,
    commentsOptions(env.data, env.scope, 1),
  );
  const stop = observer.subscribe(() => {});
  try {
    await env.join();
    await flush();
    const before = env.requests.length;
    for (const event of [
      'comment:created',
      'comment:updated',
      'comment:deleted',
    ])
      for (let i = 0; i < 3; i++)
        env.socket.server(event, {
          boardId: BOARD,
          cardId: CARD,
          commentId: comment().id,
        });
    env.time.advance(50);
    await flush();
    assert.equal(
      env.requests.slice(before).filter(({ url }) => url.includes('/comments'))
        .length,
      1,
    );
    assert.deepEqual(observer.getCurrentResult().data?.data, [comment()]);
    assert.equal(env.writes().length, 0);
    assert.equal(
      env.requests.some(({ url }) => url.includes('/notifications')),
      false,
    );
    env.environment(false, false);
    await flush();
    assert.equal(observer.getCurrentResult().data, undefined);
    env.environment(true, true);
    await flush();
    await env.join();
    env.time.advance(50);
    await flush();
    assert.deepEqual(observer.getCurrentResult().data?.data, [comment()]);
    env.realtime.revokeBoard(BOARD);
    await flush();
    assert.equal(observer.getCurrentResult().data, undefined);
  } finally {
    stop();
    env.dispose();
  }
});

test('POST committed before the 15-second timeout executes once; 401 ends session and roster fences reject late mention results', async () => {
  for (const mode of ['timeout', '401', 'roster']) {
    const env = await scenario();
    const gate = deferred<Response>();
    try {
      const target = env.state.members[0];
      const content = `@${target.user.displayName}`;
      const command: CommentCommand =
        mode === 'roster'
          ? {
              kind: 'create',
              draft: {
                text: content,
                spans: [
                  { userId: target.user.id, start: 0, end: content.length },
                ],
              },
              rosterPages: [1],
            }
          : env.create;
      env.respond((input, init) => {
        if (input.includes('/comments') && init.method === 'POST') {
          env.state.rows.push({
            ...comment(2),
            content: mode === 'roster' ? content : 'New comment',
          });
          return gate.promise;
        }
        if (input.includes('/members'))
          return Promise.resolve(json(page(env.state.members, 1, 20)));
        return null;
      });
      const result = env.run(command);
      const rejected = assert.rejects(result, (error: unknown) =>
        mode === '401'
          ? error instanceof ApiError && error.status === 401
          : uncertainCommentWrite(error),
      );
      await flush();
      if (mode === 'timeout') env.time.advance(15_000);
      else if (mode === '401') gate.resolve(failure(401));
      else {
        env.data.evict(env.identity, [queryKeys.members(env.identity, BOARD)]);
        gate.resolve(
          success(
            { ...comment(), content, mentions: command.draft.spans },
            201,
          ),
        );
      }
      await rejected;
      await flush();
      assert.equal(env.writes().length, 1);
      if (mode === '401')
        assert.notEqual(env.manager.getSnapshot().status, 'authenticated');
      if (mode === 'timeout')
        assert.equal(
          env.state.rows.filter((row) => row.content === 'New comment').length,
          1,
        );
    } finally {
      gate.resolve(success(comment(), 201));
      env.dispose();
    }
  }
});
