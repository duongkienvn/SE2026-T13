import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presenceView } from '../../src/features/boards/presence.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { flush, USER_A, USER_B } from '../auth/support.ts';
import { uuid } from '../workspaces/fixtures.ts';
import { BOARD, CARD, integration, payload } from './integration-support.ts';

const live = (userIds: string[]) => ({
  status: 'live' as const,
  canRead: true,
  userIds,
});
const ADA = uuid(7001);
const BEN = uuid(7002);
const CY = uuid(7003);
const DEE = uuid(7004);
const roster = new Map([
  [ADA, { displayName: 'Ada' }],
  [BEN, { displayName: 'Ben' }],
  [CY, { displayName: 'Cy' }],
  [DEE, { displayName: 'Dee', isDeleted: true }],
]);

test('presence is shown only for a live, readable room and never counts you or duplicate devices', () => {
  for (const status of [
    'paused',
    'checking',
    'joining',
    'unavailable',
  ] as const)
    assert.equal(
      presenceView({ ...live([ADA]), status }, true, USER_A, roster).kind,
      'hidden',
    );
  assert.equal(
    presenceView({ ...live([ADA]), canRead: false }, true, USER_A, roster).kind,
    'hidden',
  );
  assert.equal(presenceView(live([ADA]), false, USER_A, roster).kind, 'hidden');
  assert.equal(
    presenceView(live([USER_A, USER_A.toUpperCase()]), true, USER_A, roster)
      .kind,
    'hidden',
  );
  const view = presenceView(
    live([ADA, ADA.toUpperCase(), USER_A]),
    true,
    USER_A,
    roster,
  );
  assert.equal(view.kind, 'people');
  assert.equal(view.kind === 'people' && view.others, 1);
  assert.equal(
    view.kind === 'people' && view.label,
    'Viewing this board now: Ada',
  );
});

test('without an authorized roster only a count is shown; unknown and deleted ids are never named', () => {
  const count = presenceView(live([ADA, BEN]), true, USER_A, null);
  assert.deepEqual(count, {
    kind: 'count',
    others: 2,
    label: '2 other people viewing this board now',
  });
  const view = presenceView(
    live([CY, BEN, ADA, DEE, USER_B]),
    true,
    USER_A,
    roster,
  );
  assert.equal(view.kind, 'people');
  if (view.kind !== 'people') return;
  assert.deepEqual(
    view.shown.map(({ displayName }) => displayName),
    ['Ada', 'Ben', 'Cy'],
  );
  // Deleted Dee and unknown USER_B are counted but not named.
  assert.equal(view.more, 2);
  assert.equal(view.label, 'Viewing this board now: Ada, Ben, Cy and 2 more');
  const unknown = presenceView(live([USER_B]), true, USER_A, roster);
  assert.equal(
    unknown.kind === 'people' ? unknown.label : unknown.kind,
    'Viewing this board now: 1 other person',
  );
});

const gets = (
  c: Awaited<ReturnType<typeof integration>>,
  suffix: string,
  from: number,
) =>
  c.requests
    .slice(from)
    .filter(
      ({ url, init }) =>
        (init.method ?? 'GET') === 'GET' &&
        url.endsWith(`/boards/${BOARD}/${suffix}`),
    ).length;

test('request trace: a burst of comment hints plus presence costs one comment GET and no Board or sibling refetch', async () => {
  const c = await integration();
  try {
    await c.join();
    const identity = c.identity;
    c.observe(queryKeys.comments(identity, BOARD, CARD), 'comments');
    c.observe(queryKeys.checklists(identity, BOARD, CARD), 'checklists');
    c.observe(queryKeys.attachments(identity, BOARD, CARD), 'attachments');
    c.observe(queryKeys.board(identity, BOARD), 'board');
    c.observe(queryKeys.columns(identity, BOARD), 'columns');
    const start = c.requests.length;
    for (let i = 0; i < 10; i++) {
      c.socket.server('comment:created', {
        ...payload,
        commentId: uuid(9000 + i),
        operationId: `op-${i}`,
      });
      c.socket.server('presence:sync', {
        boardId: BOARD,
        userIds: [USER_A, USER_B],
      });
    }
    for (let i = 0; i < 3; i++)
      c.socket.server('comment:updated', { ...payload, commentId: uuid(9000) });
    c.time.advance(50);
    await flush();
    const trace = {
      comments: gets(c, 'comments', start),
      checklists: gets(c, 'checklists', start),
      attachments: gets(c, 'attachments', start),
      board: gets(c, 'board', start),
      columns: gets(c, 'columns', start),
      total: c.requests.length - start,
    };
    assert.deepEqual(trace, {
      comments: 1,
      checklists: 0,
      attachments: 0,
      board: 0,
      columns: 0,
      total: 1,
    });
    assert.deepEqual(c.realtime.getBoardSnapshot(BOARD).userIds, [
      USER_A,
      USER_B,
    ]);
    // Presence alone never refetches business data.
    const quiet = c.requests.length;
    for (let i = 0; i < 20; i++)
      c.socket.server('presence:sync', {
        boardId: BOARD,
        userIds: i % 2 ? [USER_A] : [USER_A, USER_B],
      });
    c.time.advance(500);
    await flush();
    assert.equal(c.requests.length, quiet);
  } finally {
    c.dispose();
  }
});

test('request trace: hints for a Board that is not live are ignored; checklist hints stay child-scoped', async () => {
  const c = await integration();
  try {
    const identity = c.identity;
    c.observe(queryKeys.comments(identity, BOARD, CARD), 'comments');
    c.observe(queryKeys.checklists(identity, BOARD, CARD), 'checklists');
    c.socket.server('connect');
    const before = c.requests.length;
    // Not joined yet: the room is not live, so hints and presence are dropped.
    c.socket.server('comment:created', { ...payload, commentId: uuid(1) });
    c.socket.server('presence:sync', { boardId: BOARD, userIds: [USER_B] });
    c.time.advance(50);
    await flush();
    assert.equal(gets(c, 'comments', before), 0);
    assert.deepEqual(c.realtime.getBoardSnapshot(BOARD).userIds, []);
    await c.join();
    const start = c.requests.length;
    for (let i = 0; i < 5; i++)
      c.socket.server('card:updated', {
        ...payload,
        changeScope: 'checklists',
      });
    c.time.advance(50);
    await flush();
    assert.equal(gets(c, 'checklists', start), 1);
    assert.equal(gets(c, 'comments', start), 0);
  } finally {
    c.dispose();
  }
});

test('presence is cleared on disconnect and on Board revoke, and a late snapshot never revives it', async () => {
  const c = await integration();
  try {
    await c.join();
    c.socket.server('presence:sync', {
      boardId: BOARD,
      userIds: [USER_A, USER_B],
    });
    assert.deepEqual(c.realtime.getBoardSnapshot(BOARD).userIds, [
      USER_A,
      USER_B,
    ]);
    const socket = c.socket;
    socket.server('disconnect');
    await flush();
    assert.deepEqual(c.realtime.getBoardSnapshot(BOARD).userIds, []);
    assert.equal(
      presenceView(c.realtime.getBoardSnapshot(BOARD), true, USER_A, null).kind,
      'hidden',
    );
    // A late snapshot on the dropped connection, before any new join ACK.
    socket.server('presence:sync', { boardId: BOARD, userIds: [USER_B] });
    assert.deepEqual(c.realtime.getBoardSnapshot(BOARD).userIds, []);
  } finally {
    c.dispose();
  }
  const r = await integration();
  try {
    await r.join();
    r.socket.server('presence:sync', { boardId: BOARD, userIds: [USER_B] });
    r.configure({ allowed: false });
    r.socket.server('board:access-revoked', { boardId: BOARD });
    await flush();
    r.socket.server('presence:sync', { boardId: BOARD, userIds: [USER_B] });
    const state = r.realtime.getBoardSnapshot(BOARD);
    assert.equal(state.status, 'unavailable');
    assert.deepEqual(state.userIds, []);
    assert.equal(presenceView(state, true, USER_A, null).kind, 'hidden');
  } finally {
    r.dispose();
  }
});

test('request trace: own POST plus its socket echo converge in one list with no duplicate row', async () => {
  const { runCommentWrite, commentsOptions } =
    await import('../../src/features/cards/comments/queries.ts');
  const { QueryObserver } = await import('@tanstack/react-query');
  const c = await integration();
  try {
    await c.join();
    const identity = c.identity;
    const created = {
      id: uuid(9500),
      cardId: CARD,
      authorId: identity.userId,
      content: 'Hello',
      mentions: [],
      createdAt: '2026-11-13T09:00:00.000Z',
      updatedAt: '2026-11-13T09:00:00.000Z',
    };
    let rows: unknown[] = [];
    const envelope = (data: unknown, status = 200, meta?: unknown) =>
      new Response(
        JSON.stringify({
          success: true,
          statusCode: status,
          message: 'OK',
          data,
          meta,
        }),
        { status, headers: { 'content-type': 'application/json' } },
      );
    c.respond((url, init) => {
      if (!url.includes(`/cards/${CARD}/comments`)) return null;
      if (init.method === 'POST') {
        rows = [created];
        // The server publishes after commit; the echo can beat the HTTP reply.
        c.socket.server('comment:created', {
          ...payload,
          commentId: created.id,
          operationId: 'op-1',
        });
        return Promise.resolve(envelope(created, 201));
      }
      return Promise.resolve(
        envelope(rows, 200, {
          page: 1,
          limit: 20,
          total: rows.length,
          totalPages: rows.length ? 1 : 0,
        }),
      );
    });
    c.data.queryClient.setQueryData(queryKeys.board(identity, BOARD), {
      id: BOARD,
      currentUserRole: 'MEMBER',
      isArchived: false,
      capabilities: { canReadBoard: true, canWriteBoard: true },
    });
    c.data.queryClient.setQueryData(queryKeys.card(identity, BOARD, CARD), {
      isArchived: false,
    });
    const scope = { identity, boardId: BOARD, cardId: CARD };
    const observer = new QueryObserver(
      c.data.queryClient,
      commentsOptions(c.data, scope, 1),
    );
    const stop = observer.subscribe(() => {});
    await flush();
    const start = c.requests.length;
    await runCommentWrite(
      c.data,
      scope,
      { kind: 'create', draft: { text: 'Hello', spans: [] }, rosterPages: [] },
      () => true,
      new AbortController().signal,
    );
    c.time.advance(50);
    await flush();
    const commentGets = c.requests
      .slice(start)
      .filter(
        ({ url, init }) =>
          (init.method ?? 'GET') === 'GET' && url.includes('/comments'),
      ).length;
    // The echo lands while the mutation refetch is queued: one GET in total.
    assert.equal(commentGets, 1);
    assert.equal(
      c.requests.slice(start).filter(({ init }) => init.method === 'POST')
        .length,
      1,
    );
    assert.deepEqual(
      (observer.getCurrentResult().data as { data: { id: string }[] }).data.map(
        ({ id }) => id,
      ),
      [created.id],
    );
    stop();
  } finally {
    c.dispose();
  }
});
