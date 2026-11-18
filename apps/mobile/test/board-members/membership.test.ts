import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardRole } from '@kanban/shared';
import { onlineManager, QueryObserver } from '@tanstack/react-query';
import { decodeBoard } from '../../src/features/boards/api.ts';
import {
  boardMemberEmail,
  boardMembersKey,
  createBoardMembersApi,
  decodeBoardMember,
} from '../../src/features/boards/members/api.ts';
import {
  boardMembershipAccessOptions,
  boardMembershipPermissions,
  boardMembersOptions,
  boardPolicyOptions,
  refreshBoardMembership,
} from '../../src/features/boards/members/queries.ts';
import {
  changeBoardMembership,
  memberActionBlock,
  uncertainBoardMembershipWrite,
} from '../../src/features/boards/members/mutations.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { parsePath, destinationPath } from '../../src/navigation/routes.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { page, uuid } from '../workspaces/fixtures.ts';
import {
  actor,
  boardId,
  member,
  membershipBoard,
  policy,
  workspaceId,
} from './fixtures.ts';

const signal = () => new AbortController().signal;
const success = (data: unknown, status = 200) =>
  json({ success: true, statusCode: status, message: 'OK', data }, status);
const fail = (status: number, message = 'Request denied') =>
  json(
    { success: false, statusCode: status, code: 'CONFLICT', message },
    status,
  );

async function scenario() {
  const env = await integration();
  const state = {
    board: membershipBoard(),
    policy: { ...policy },
    members: [actor, member()],
    writeStatus: 0,
  };
  env.respond((input, init) => {
    const url = new URL(input);
    const path = url.pathname;
    const method = init.method ?? 'GET';
    if (path === `/api/boards/${boardId}`)
      return Promise.resolve(ok(state.board));
    if (path.endsWith('/policy-capabilities'))
      return Promise.resolve(ok(state.policy));
    if (method === 'GET' && path.endsWith('/members'))
      return Promise.resolve(
        json(
          page(
            state.members,
            Number(url.searchParams.get('page')),
            Number(url.searchParams.get('limit')),
          ),
        ),
      );
    if (path.includes('/members')) {
      if (state.writeStatus) return Promise.resolve(fail(state.writeStatus));
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      if (method === 'POST')
        return Promise.resolve(
          success(
            { ...member(10), user: { ...member(10).user, email: body.email } },
            201,
          ),
        );
      if (method === 'PATCH')
        return Promise.resolve(ok({ ...member(), role: body.role }));
      if (method === 'DELETE')
        return Promise.resolve(new Response(null, { status: 204 }));
    }
    return null;
  });
  return {
    ...env,
    state,
    writes: () =>
      env.requests.filter(({ init }) => (init.method ?? 'GET') !== 'GET'),
  };
}

test('Board member decoder allowlists full DTO, deleted email, IDs, roles and timestamps', () => {
  const dto = member();
  assert.deepEqual(
    decodeBoardMember({
      ...dto,
      password: 'never',
      user: { ...dto.user, token: 'never' },
    }),
    dto,
  );
  assert.equal(
    decodeBoard(decodeBoard(membershipBoard())).createdById,
    uuid(900),
  );
  assert.equal(
    decodeBoardMember({
      ...dto,
      user: { ...dto.user, isDeleted: true, email: '' },
    }).user.isDeleted,
    true,
  );
  for (const invalid of [
    null,
    [],
    { ...dto, role: 'ADMIN' },
    { ...dto, id: 'bad' },
    { ...dto, joinedAt: 'yesterday' },
    ...[
      { id: 'bad' },
      { email: '' },
      { email: 'a'.repeat(321) },
      { displayName: '' },
      { avatarRevision: -1 },
      { avatarRevision: '0' },
      { avatarUrl: {} },
      { updatedAt: 'bad' },
      { isDeleted: 'yes' },
    ].map((bad) => ({ ...dto, user: { ...dto.user, ...bad } })),
  ])
    assert.throws(() => decodeBoardMember(invalid), ApiError);
  assert.equal(boardMemberEmail('  A@Example.test '), 'a@example.test');
  assert.equal(boardMemberEmail(`${'x'.repeat(307)}@example.test`).length, 320);
  for (const input of [
    '',
    'a@',
    'a b@example.test',
    `${'x'.repeat(308)}@example.test`,
  ])
    assert.throws(() => boardMemberEmail(input));
});

test('exact 200/201/200/204 paths, bodies, policy decoder and page keys', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  const api = createBoardMembersApi(c.data.api, c.identity, boardId);
  assert.equal((await api.list(1, signal())).data[0]?.role, BoardRole.OWNER);
  assert.equal(
    (await api.add(' NEW@example.test ', signal())).role,
    BoardRole.MEMBER,
  );
  assert.equal(
    (await api.changeRole(member().user.id, BoardRole.OWNER, signal())).role,
    BoardRole.OWNER,
  );
  assert.equal(await api.remove(member().user.id, signal()), undefined);
  assert.deepEqual(
    await c.data.queryClient.fetchQuery(
      boardPolicyOptions(c.data, c.identity, boardId),
    ),
    policy,
  );
  assert.deepEqual(
    c
      .writes()
      .map(({ url, init }) => [
        new URL(url).pathname,
        init.method,
        init.body ? JSON.parse(String(init.body)) : undefined,
      ]),
    [
      [`/api/boards/${boardId}/members`, 'POST', { email: 'new@example.test' }],
      [
        `/api/boards/${boardId}/members/${member().user.id}`,
        'PATCH',
        { role: BoardRole.OWNER },
      ],
      [
        `/api/boards/${boardId}/members/${member().user.id}`,
        'DELETE',
        undefined,
      ],
    ],
  );
  assert.deepEqual(
    boardMembersKey(c.identity, boardId, 1).slice(0, 7),
    queryKeys.members(c.identity, boardId),
  );
  assert.notDeepEqual(
    boardMembersKey(c.identity, boardId, 1),
    boardMembersKey(c.identity, boardId, 2),
  );
  const path = `/boards/${boardId}/members`;
  assert.equal(destinationPath(parsePath(path)!), path);
  assert.equal(parsePath('/boards/bad/members'), null);
});

for (const count of [0, 1, 20, 21, 101, 251])
  test(`roster ${count}: server-backed pages, no search and limit <=100`, async (t) => {
    const c = await scenario();
    t.after(c.dispose);
    c.state.members = Array.from({ length: count }, (_, n) => member(n + 1));
    const api = createBoardMembersApi(c.data.api, c.identity, boardId);
    const first = await api.list(1, signal());
    assert.equal(first.data.length, Math.min(count, 20));
    assert.equal(first.meta.total, count);
    if (count > 20)
      assert.equal(
        (await api.list(2, signal())).data[0]?.user.id,
        member(21).user.id,
      );
    for (const { url } of c.requests)
      assert.equal(new URL(url).searchParams.has('search'), false);
    await assert.rejects(api.list(1, signal(), 101));
    await assert.rejects(api.list(0, signal()));
    await assert.rejects(api.list(Number.MAX_SAFE_INTEGER, signal(), 100));
  });

test('malformed page metadata, duplicate DTOs, contradictory add/PATCH and wrong statuses fail closed', async (t) => {
  const c = await integration();
  t.after(c.dispose);
  const api = createBoardMembersApi(c.data.api, c.identity, boardId);
  for (const response of [
    {
      ...page([member()], 1, 20),
      meta: { page: 1, limit: 20, total: 21, totalPages: 1 },
    },
    {
      ...page([member()], 1, 20),
      meta: { page: 2, limit: 20, total: 1, totalPages: 1 },
    },
    page([member(), member()], 1, 20),
    { success: true, statusCode: 200, message: 'OK', data: [member()] },
  ]) {
    c.respond(() => Promise.resolve(json(response)));
    await assert.rejects(api.list(1, signal()), ApiError);
  }
  c.respond(() => Promise.resolve(success(member(1, BoardRole.OWNER), 201)));
  await assert.rejects(api.add(member().user.email, signal()), ApiError);
  c.respond(() => Promise.resolve(ok(member())));
  await assert.rejects(
    api.changeRole(member().user.id, BoardRole.OWNER, signal()),
    ApiError,
  );
  await assert.rejects(api.remove(member().user.id, signal()), ApiError);
  await assert.rejects(api.add(member().user.email, signal()), ApiError);
  assert.throws(
    () => api.changeRole(member().user.id, 'ADMIN' as BoardRole, signal()),
    ApiError,
  );
});

test('explicit Board role and each policy gate are independent of Workspace role/umbrella flag', () => {
  for (const role of [null, BoardRole.MEMBER, BoardRole.OWNER])
    for (const archived of [false, true])
      for (const invite of [false, true])
        for (const change of [false, true]) {
          const b = decodeBoard(
            membershipBoard({
              currentUserRole: role,
              isArchived: archived,
              archivedAt: archived ? '2026-11-15T09:00:00.000Z' : null,
            }),
          );
          const p = boardMembershipPermissions(b, {
            ...policy,
            canInviteMembers: invite,
            canChangeMembership: change,
          });
          assert.equal(p.canReadMembers, role !== null);
          assert.equal(
            p.canAdd,
            role === BoardRole.OWNER && !archived && invite,
          );
          assert.equal(
            p.canChange,
            role === BoardRole.OWNER && !archived && change,
          );
        }
  const b = decodeBoard(
    membershipBoard({
      capabilities: {
        ...membershipBoard().capabilities,
        canManageMembers: false,
      },
    }),
  );
  assert.equal(
    boardMembershipPermissions(b, policy).canAdd,
    true,
    'per-action policy + explicit role are authoritative',
  );
});

test('Workspace-visible reader purges cached full roster without calling roster endpoint', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  const key = boardMembersKey(c.identity, boardId, 1);
  c.data.queryClient.setQueryData(key, page([member()], 1, 20));
  c.state.board.currentUserRole = null;
  const board = await c.data.queryClient.fetchQuery(
    boardMembershipAccessOptions(c.data, c.identity, boardId),
  );
  assert.equal(boardMembershipPermissions(board, policy).canReadMembers, false);
  assert.equal(c.data.queryClient.getQueryData(key), undefined);
  assert.equal(
    c.requests.filter(({ url }) => new URL(url).pathname.endsWith('/members'))
      .length,
    0,
  );
});

test('creator, self and sole OWNER guards preserve membership; partial pages cannot count all owners', () => {
  const b = decodeBoard(membershipBoard());
  assert.match(
    memberActionBlock(
      { ...member(), user: { ...member().user, id: b.createdById } },
      b,
      cActor(),
    )!,
    /creator/,
  );
  assert.match(memberActionBlock(actor, b, cActor())!, /yourself/);
  assert.match(
    memberActionBlock(member(1, BoardRole.OWNER), b, cActor(), 1)!,
    /at least one OWNER/,
  );
  assert.equal(
    memberActionBlock(member(1, BoardRole.OWNER), b, cActor()),
    undefined,
  );
});
function cActor() {
  return actor.user.id;
}

test('mutation preflight blocks policy denial, Workspace-only viewer, archived Board, self and creator', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  for (const overrides of [
    { currentUserRole: null },
    { currentUserRole: BoardRole.MEMBER },
    { isArchived: true, archivedAt: '2026-11-15T09:00:00.000Z' },
  ]) {
    c.state.board = membershipBoard(overrides);
    await assert.rejects(
      changeBoardMembership(
        c.data,
        c.identity,
        boardId,
        { kind: 'add', email: member().user.email },
        signal(),
      ),
    );
  }
  c.state.board = membershipBoard();
  c.state.policy.canInviteMembers = false;
  await assert.rejects(
    changeBoardMembership(
      c.data,
      c.identity,
      boardId,
      { kind: 'add', email: member().user.email },
      signal(),
    ),
  );
  c.state.policy.canInviteMembers = true;
  c.state.policy.canChangeMembership = false;
  await assert.rejects(
    changeBoardMembership(
      c.data,
      c.identity,
      boardId,
      { kind: 'remove', member: member(), page: 1 },
      signal(),
    ),
  );
  c.state.policy.canChangeMembership = true;
  for (const target of [
    actor,
    { ...member(), user: { ...member().user, id: c.state.board.createdById } },
  ])
    await assert.rejects(
      changeBoardMembership(
        c.data,
        c.identity,
        boardId,
        { kind: 'remove', member: target, page: 1 },
        signal(),
      ),
    );
  assert.equal(c.writes().length, 0);
});

test('role changed during confirmation conflicts before PATCH; server last-owner 409 is not success', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  c.state.members[1] = member(1, BoardRole.OWNER);
  await assert.rejects(
    changeBoardMembership(
      c.data,
      c.identity,
      boardId,
      { kind: 'role', member: member(), role: BoardRole.OWNER, page: 1 },
      signal(),
    ),
    { status: 409 },
  );
  assert.equal(c.writes().length, 0);
  c.state.members[1] = member();
  c.state.writeStatus = 409;
  await assert.rejects(
    changeBoardMembership(
      c.data,
      c.identity,
      boardId,
      { kind: 'remove', member: member(), page: 1 },
      signal(),
    ),
    { status: 409 },
  );
  assert.equal(c.writes().length, 1);
});

test('204 removal clears assignment/roster/guest snapshots and targets current session only', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  const identity = c.identity;
  const affected = [
    queryKeys.members(identity, boardId),
    queryKeys.card(identity, boardId, uuid(400)),
    queryKeys.cards(identity, boardId),
    [...queryKeys.workspace(identity, workspaceId), 'guests'] as const,
  ];
  for (const key of affected)
    c.data.queryClient.setQueryData(key, 'stale private projection');
  const other = queryKeys.members(identity, uuid(8));
  const workspaceMembers = [
    ...queryKeys.workspace(identity, workspaceId),
    'members',
  ] as const;
  c.data.queryClient.setQueryData(other, 'other Board');
  c.data.queryClient.setQueryData(workspaceMembers, 'Workspace members');
  await changeBoardMembership(
    c.data,
    identity,
    boardId,
    { kind: 'remove', member: member(), page: 1 },
    signal(),
  );
  for (const key of affected)
    assert.equal(c.data.queryClient.getQueryData(key), undefined);
  assert.equal(c.data.queryClient.getQueryData(other), 'other Board');
  assert.equal(
    c.data.queryClient.getQueryData(workspaceMembers),
    'Workspace members',
  );
});

for (const status of [401, 403, 404, 409, 429, 500, 503])
  test(`membership HTTP ${status}: one command, preserved error and no auto retry`, async (t) => {
    const c = await scenario();
    t.after(c.dispose);
    c.state.writeStatus = status;
    const error = await changeBoardMembership(
      c.data,
      c.identity,
      boardId,
      { kind: 'add', email: member().user.email },
      signal(),
    ).catch((error: unknown) => error);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(c.writes().length, 1);
    assert.equal(uncertainBoardMembershipWrite(error), status >= 500);
  });

test('offline sends nothing; an aborted preflight is not an uncertain write', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  onlineManager.setOnline(false);
  try {
    await assert.rejects(
      changeBoardMembership(
        c.data,
        c.identity,
        boardId,
        { kind: 'add', email: member().user.email },
        signal(),
      ),
      { kind: 'offline' },
    );
  } finally {
    onlineManager.setOnline(true);
  }
  assert.equal(c.requests.length, 0);
  c.respond(() => Promise.resolve(fail(503)));
  const error = await changeBoardMembership(
    c.data,
    c.identity,
    boardId,
    { kind: 'add', email: member().user.email },
    signal(),
  ).catch((error: unknown) => error);
  assert.equal(uncertainBoardMembershipWrite(error), false);
});

test('pending Board command locks rapid duplicate submits and logout fences late results', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  const oldIdentity = c.identity;
  const gate = deferred<Response>();
  c.respond((url, init) =>
    init.method === 'POST'
      ? gate.promise
      : new URL(url).pathname.endsWith('/policy-capabilities')
        ? Promise.resolve(ok(policy))
        : Promise.resolve(ok(membershipBoard())),
  );
  const command = { kind: 'add', email: member().user.email } as const;
  const write = changeBoardMembership(
    c.data,
    oldIdentity,
    boardId,
    command,
    signal(),
  );
  const rejected = assert.rejects(write);
  await flush();
  await assert.rejects(
    changeBoardMembership(c.data, oldIdentity, boardId, command, signal()),
    { status: 409 },
  );
  assert.equal(c.writes().length, 1);
  await c.manager.establishSession(loginResponse(USER_B));
  gate.resolve(success(member(), 201));
  await rejected;
  await flush();
  assert.equal(
    c.data.queryClient.getQueryData(boardMembersKey(oldIdentity, boardId, 1)),
    undefined,
  );
});

test('stale roster completion after membership fence cannot restore private names/emails', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  const options = boardMembersOptions(c.data, c.identity, boardId, 1);
  const gate = deferred<Response>();
  c.respond(() => gate.promise);
  const read = c.data.queryClient.fetchQuery(options);
  const failed = assert.rejects(read);
  await flush();
  c.data.resources.fenceBoard(boardId, true);
  c.data.evict(c.identity, [queryKeys.board(c.identity, boardId)]);
  gate.resolve(json(page([member()], 1, 20)));
  await failed;
  await flush();
  assert.equal(c.data.queryClient.getQueryData(options.queryKey), undefined);
});

test('a committed mutation succeeds even when mounted reconciliation GET fails', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  const key = boardMembersKey(c.identity, boardId, 1);
  const observer = new QueryObserver(c.data.queryClient, {
    queryKey: key,
    queryFn: async () => {
      throw new ApiError('network');
    },
    retry: false,
    staleTime: Infinity,
  });
  const stop = observer.subscribe(() => {});
  t.after(stop);
  assert.equal(
    (
      await changeBoardMembership(
        c.data,
        c.identity,
        boardId,
        { kind: 'add', email: 'new@example.test' },
        signal(),
      )
    )?.role,
    BoardRole.MEMBER,
  );
  await flush();
  assert.equal(observer.getCurrentResult().data, undefined);
});

test('timeout after POST has unknown outcome, never automatically retries, and never seeds roster', async (t) => {
  const c = await scenario();
  t.after(c.dispose);
  const gate = deferred<Response>();
  c.respond((url, init) =>
    init.method === 'POST'
      ? gate.promise
      : Promise.resolve(
          ok(
            new URL(url).pathname.endsWith('/policy-capabilities')
              ? policy
              : membershipBoard(),
          ),
        ),
  );
  const write = changeBoardMembership(
    c.data,
    c.identity,
    boardId,
    { kind: 'add', email: member().user.email },
    signal(),
  );
  const failed = write.catch((error: unknown) => error);
  await flush();
  c.time.advance(15_000);
  await flush();
  const error = await failed;
  assert.ok(error instanceof ApiError);
  assert.equal(error.kind, 'timeout');
  assert.equal(uncertainBoardMembershipWrite(error), true);
  assert.equal(c.writes().length, 1);
  gate.resolve(success(member(), 201));
  await flush();
  assert.equal(
    c.data.queryClient.getQueryData(boardMembersKey(c.identity, boardId, 1)),
    undefined,
  );
});

for (const event of ['member:added', 'member:role-changed'] as const)
  test(`${event} coalesces roster and policy reads from REST`, async (t) => {
    const c = await integration();
    t.after(c.dispose);
    await c.join();
    const root = queryKeys.board(c.identity, boardId);
    const roster = c.observe(queryKeys.members(c.identity, boardId), 'roster');
    const capabilities = c.observe([...root, 'settings', 'policy'], 'policy');
    const unrelated = c.observe(
      queryKeys.columns(c.identity, boardId),
      'columns',
    );
    const before = c.requests.length;
    for (let i = 0; i < 10; i++)
      c.socket.server(event, { boardId, userId: USER_B });
    c.time.advance(50);
    await flush();
    assert.equal(roster.getCurrentResult().data, 1);
    assert.equal(capabilities.getCurrentResult().data, 1);
    assert.equal(unrelated.getCurrentResult().data, 0);
    assert.equal(c.requests.length, before + 2);
  });

test('all member hints reconcile REST; own removal retains read only when REST permits, regardless of hint flag', async (t) => {
  for (const retainsReadAccess of [true, false, undefined]) {
    const c = await integration();
    try {
      await c.join();
      const identity = c.identity;
      c.data.queryClient.setQueryData(
        queryKeys.members(identity, boardId),
        'private roster',
      );
      c.configure({ writable: false });
      c.socket.server('member:removed', {
        boardId,
        userId: identity.userId,
        ...(retainsReadAccess === undefined ? {} : { retainsReadAccess }),
      });
      assert.equal(
        c.data.queryClient.getQueryData(queryKeys.members(identity, boardId)),
        undefined,
      );
      assert.equal(c.realtime.getBoardSnapshot(boardId).canWrite, false);
      c.time.advance(50);
      await flush();
      assert.equal(c.realtime.getBoardSnapshot(boardId).canRead, true);
      assert.equal(c.realtime.getBoardSnapshot(boardId).canWrite, false);
    } finally {
      c.dispose();
    }
  }
  const c = await integration();
  t.after(c.dispose);
  await c.join();
  c.configure({ allowed: false });
  c.socket.server('member:removed', {
    boardId,
    userId: c.identity.userId,
    retainsReadAccess: true,
  });
  c.time.advance(50);
  await flush();
  assert.equal(c.realtime.getBoardSnapshot(boardId).status, 'unavailable');
});

test('member removal invalidates roster/assignments/guests without reading unrelated Board children', async (t) => {
  const c = await integration();
  t.after(c.dispose);
  await c.join();
  const identity = c.identity;
  const roster = c.observe(queryKeys.members(identity, boardId), 'roster');
  const card = c.observe(c.cardKey, 'card');
  const guests = c.observe(
    [
      ...queryKeys.workspace(identity, '33333333-3333-4333-8333-333333333333'),
      'guests',
    ],
    'guests',
  );
  const labels = c.observe(queryKeys.labels(identity, boardId), 'labels');
  c.socket.server('member:removed', { boardId, userId: USER_B });
  assert.equal(card.getCurrentResult().data, undefined);
  assert.equal(roster.getCurrentResult().data, undefined);
  assert.equal(guests.getCurrentResult().data, undefined);
  c.time.advance(50);
  await flush();
  assert.equal(card.getCurrentResult().data, 1);
  assert.equal(roster.getCurrentResult().data, 1);
  assert.equal(guests.getCurrentResult().data, 1);
  assert.equal(labels.getCurrentResult().data, 0);
  await refreshBoardMembership(c.data, identity, boardId, workspaceId);
});
