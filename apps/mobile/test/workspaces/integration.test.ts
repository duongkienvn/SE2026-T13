import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InfiniteQueryObserver, QueryObserver } from '@tanstack/react-query';
import { homeOptions } from '../../src/features/home/query.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { createWorkspaceApi } from '../../src/features/workspaces/api.ts';
import {
  decodeWorkspace,
  decodeWorkspaceBoard,
  decodeWorkspaceOverview,
} from '../../src/features/workspaces/decoder.ts';
import {
  workspaceBoardOptions,
  workspaceDetailOptions,
  workspaceDirectoryOptions,
  workspaceOverviewOptions,
} from '../../src/features/workspaces/queries.ts';
import { resolveWorkspace } from '../../src/features/workspaces/selection.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';
import { emptyHome, fixture as homeFixture } from '../home/fixtures.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { board, overview, page, uuid, workspace } from './fixtures.ts';

const signal = () => new AbortController().signal;
const personal = workspace(2, 'PERSONAL');
const team = workspace();
function pageAt<T>(url: string, rows: T[]) {
  const { searchParams } = new URL(url);
  return json(
    page(
      rows,
      Number(searchParams.get('page')),
      Number(searchParams.get('limit')),
    ),
  );
}
function listCall(url: string) {
  return new URL(url).pathname === '/api/workspaces';
}

test('lifecycle requests use the server methods, status codes and nullable payloads', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  env.respond((_url, init) => {
    if (init.method === 'POST' && !_url.endsWith('/leave'))
      return Promise.resolve(
        json(
          { success: true, statusCode: 201, message: 'Created', data: team },
          201,
        ),
      );
    if (init.method === 'PATCH') return Promise.resolve(ok(team));
    if (init.method === 'DELETE' || _url.endsWith('/leave'))
      return Promise.resolve(new Response(null, { status: 204 }));
    return null;
  });
  const api = createWorkspaceApi(env.data.api, env.identity);
  await api.create({ name: 'Team', icon: 'code' }, signal());
  await api.update(team.id, { description: null }, signal());
  await api.leave(team.id, signal());
  await api.remove(team.id, 'Team', signal());
  const calls = env.requests.filter(({ init }) => init.method !== 'GET');
  assert.deepEqual(
    calls.map(({ init }) => init.method),
    ['POST', 'PATCH', 'POST', 'DELETE'],
  );
  assert.deepEqual(
    calls.map(({ init }) => (init.body ? JSON.parse(String(init.body)) : null)),
    [
      { name: 'Team', icon: 'code' },
      { description: null },
      null,
      { confirmationName: 'Team' },
    ],
  );
});

for (const operation of ['create', 'update', 'leave', 'remove'] as const) {
  for (const status of [400, 401, 403, 404, 409, 429, 503]) {
    test(`${operation} propagates HTTP ${status} without replaying the mutation`, async (t) => {
      const env = await integration();
      t.after(env.dispose);
      env.respond((_url, init) =>
        init.method !== 'GET'
          ? Promise.resolve(
              json(
                {
                  success: false,
                  statusCode: status,
                  code: 'TEST_ERROR',
                  message: 'Request rejected',
                },
                status,
              ),
            )
          : null,
      );
      const api = createWorkspaceApi(env.data.api, env.identity);
      const request = () => {
        switch (operation) {
          case 'create':
            return api.create({ name: 'Team' }, signal());
          case 'update':
            return api.update(team.id, { icon: null }, signal());
          case 'leave':
            return api.leave(team.id, signal());
          case 'remove':
            return api.remove(team.id, team.name, signal());
        }
      };
      await assert.rejects(request(), (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, status);
        return true;
      });
      const mutations = env.requests.filter(
        ({ init }) => init.method !== 'GET',
      );
      assert.equal(mutations.length, 1);
      if (status === 401)
        assert.notEqual(env.manager.getSnapshot().status, 'authenticated');
      else assert.equal(env.manager.getSnapshot().status, 'authenticated');
    });
  }
}

test('walks all 100+ memberships, deduplicates and keeps Personal first and Teams in server order', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const rows = Array.from({ length: 120 }, (_, index) => workspace(index + 10));
  rows.splice(20, 0, personal, rows[2]!);
  env.respond((url) =>
    listCall(url) ? Promise.resolve(pageAt(url, rows)) : null,
  );
  const result = await createWorkspaceApi(env.data.api, env.identity).directory(
    signal(),
  );
  assert.deepEqual(result, [
    personal,
    ...rows.filter(
      (row, i) =>
        row.type === 'TEAM' &&
        rows.findIndex((item) => item.id === row.id) === i,
    ),
  ]);
  const calls = env.requests.filter((entry) => listCall(entry.url));
  assert.equal(calls.length, 7);
  assert.deepEqual(
    calls.map(({ url }) => new URL(url).searchParams.get('page')),
    ['1', '2', '3', '4', '5', '6', '7'],
  );
  assert.equal(
    env.requests.filter((entry) => entry.url.includes('/overview')).length,
    0,
  );
  assert.equal(resolveWorkspace(result, null, () => true)?.id, personal.id);
  assert.equal(resolveWorkspace(result, team.id, () => true)?.id, personal.id);
  assert.equal(resolveWorkspace([team], null, () => true)?.id, team.id);
  assert.equal(
    resolveWorkspace([team], team.id, () => false),
    null,
  );
  assert.equal(
    resolveWorkspace([], null, () => true),
    null,
  );
});

test('empty discovery uses one authenticated Personal recovery, cached within the query', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  env.respond((url) =>
    listCall(url)
      ? Promise.resolve(pageAt(url, []))
      : url.endsWith('/workspaces/personal')
        ? Promise.resolve(ok(personal))
        : null,
  );
  const options = workspaceDirectoryOptions(env.data, env.identity);
  assert.deepEqual(await env.data.queryClient.fetchQuery(options), [personal]);
  assert.deepEqual(await env.data.queryClient.fetchQuery(options), [personal]);
  assert.equal(
    env.requests.filter(({ url }) => url.endsWith('/workspaces/personal'))
      .length,
    1,
  );
});

for (const change of ['decrease', 'increase'] as const) {
  test(`directory restarts after a total ${change} shifts the offset boundary`, async (t) => {
    const env = await integration();
    t.after(env.dispose);
    const original = [
      team,
      ...Array.from({ length: 39 }, (_, i) => workspace(i + 10)),
      personal,
    ];
    const latest =
      change === 'decrease' ? original.slice(1) : [workspace(999), ...original];
    // Preserve an overlapping ID in the server result after the restart.
    latest[25] = latest[3]!;
    const calls: string[] = [];
    env.respond((url) => {
      if (!listCall(url)) return null;
      calls.push(new URL(url).searchParams.get('page')!);
      return Promise.resolve(
        pageAt(url, calls.length === 1 ? original : latest),
      );
    });
    const result = await createWorkspaceApi(
      env.data.api,
      env.identity,
    ).directory(signal());
    assert.deepEqual(calls, [
      '1',
      '2',
      '1',
      '2',
      ...(change === 'increase' ? ['3'] : []),
    ]);
    assert.deepEqual(result, [
      personal,
      ...new Map(
        latest
          .filter((row) => row.id !== personal.id)
          .map((row) => [row.id, row]),
      ).values(),
    ]);
  });
}

test('repeated total changes fail closed and preserve the last complete authorized directory', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const rows = [
    team,
    personal,
    ...Array.from({ length: 20 }, (_, i) => workspace(i + 10)),
  ];
  const options = workspaceDirectoryOptions(env.data, env.identity);
  const key = queryKeys.workspace(env.identity, team.id);
  env.data.queryClient.setQueryData(options.queryKey, [personal, team]);
  env.data.queryClient.setQueryData(key, team);
  const calls: string[] = [];
  env.respond((url) => {
    if (!listCall(url)) return null;
    const number = new URL(url).searchParams.get('page')!;
    calls.push(number);
    return Promise.resolve(pageAt(url, number === '1' ? rows : rows.slice(1)));
  });
  await assert.rejects(
    env.data.queryClient.fetchQuery({ ...options, staleTime: 0 }),
    {
      kind: 'invalid-response',
      code: 'WORKSPACE_DIRECTORY_CHANGED',
    },
  );
  assert.deepEqual(calls, ['1', '2', '1', '2']);
  assert.deepEqual(env.data.queryClient.getQueryData(options.queryKey), [
    personal,
    team,
  ]);
  assert.equal(env.data.queryClient.getQueryData(key), team);
  assert.equal(env.data.resources.readable(key), true);
});

test('cancellation stops an in-progress directory restart', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const controller = new AbortController();
  const restart = deferred<Response>();
  const rows = [
    team,
    personal,
    ...Array.from({ length: 20 }, (_, i) => workspace(i + 10)),
  ];
  let calls = 0;
  env.respond((url) => {
    if (!listCall(url)) return null;
    calls++;
    if (calls === 3) return restart.promise;
    return Promise.resolve(pageAt(url, calls === 1 ? rows : rows.slice(1)));
  });
  const result = assert.rejects(
    createWorkspaceApi(env.data.api, env.identity).directory(controller.signal),
    { kind: 'aborted' },
  );
  await flush();
  assert.equal(calls, 3);
  controller.abort();
  restart.resolve(pageAt('https://test.invalid/?page=1&limit=20', rows));
  await result;
  assert.equal(calls, 3);
});

test('decoders keep server capabilities and withhold private roster counts', () => {
  assert.equal(decodeWorkspace({ ...team, canManage: true }).canManage, true);
  assert.equal(
    decodeWorkspace({ ...team, canCreateBoards: true }).canCreateBoards,
    true,
  );
  assert.equal(decodeWorkspaceBoard(board(), team.id).memberCount, null);
  assert.equal(decodeWorkspaceOverview(overview(), team.id).memberCount, 3);
  assert.throws(() => decodeWorkspace({ ...team, type: 'GUEST' }));
  assert.throws(() => decodeWorkspace({ ...team, canManage: 'true' }));
  assert.throws(() => decodeWorkspace({ ...team, id: team.id + '\n' }));
  assert.throws(() =>
    decodeWorkspaceBoard({ ...board(), memberCount: 0 }, team.id),
  );
  assert.throws(() =>
    decodeWorkspaceBoard({ ...board(), workspaceId: uuid(9) }, team.id),
  );
  assert.throws(() =>
    decodeWorkspaceOverview({ ...overview(), memberCount: -1 }, team.id),
  );
});

test('Board filter/page requests stay scoped and preserve null count; malformed pages and unsafe limits reject', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const api = createWorkspaceApi(env.data.api, env.identity);
  let malformed = false;
  const rows = [1, 2, 3].map((n) => ({
    ...board(team.id, n),
    isArchived: true,
  }));
  env.respond((url) =>
    url.includes('/boards?')
      ? Promise.resolve(
          malformed
            ? json({
                success: true,
                statusCode: 200,
                message: 'OK',
                data: rows,
              })
            : pageAt(url, rows),
        )
      : null,
  );
  const filters = {
    limit: 2,
    status: 'archived',
    search: 'Road & plan',
    starred: false,
    recent: true,
    sort: 'recent',
  } as const;
  const response = await api.boards(team.id, 2, filters, signal());
  assert.equal(response.meta.total, 3);
  assert.equal(response.data[0]?.memberCount, null);
  const url = new URL(env.requests.at(-1)!.url);
  assert.equal(url.pathname, `/api/workspaces/${team.id}/boards`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    ...filters,
    page: '2',
    limit: '2',
    starred: 'false',
    recent: 'true',
  });
  await assert.rejects(api.boards(team.id, 1_000_001, filters, signal()), {
    kind: 'configuration',
  });
  malformed = true;
  await assert.rejects(api.boards(team.id, 1, filters, signal()), {
    kind: 'invalid-response',
  });
});

test('A to B to A cancellation prevents late responses from overwriting the new selected snapshot', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const old = deferred<Response>();
  let aCalls = 0;
  env.respond((url) =>
    url.includes(`${team.id}/boards`)
      ? ++aCalls === 1
        ? old.promise
        : Promise.resolve(pageAt(url, [{ ...board(), name: 'Fresh A' }]))
      : url.includes(`${personal.id}/boards`)
        ? Promise.resolve(pageAt(url, [board(personal.id)]))
        : null,
  );
  const a = workspaceBoardOptions(env.data, env.identity, team.id);
  const b = workspaceBoardOptions(env.data, env.identity, personal.id);
  const pending = env.data.queryClient.fetchInfiniteQuery(a);
  const rejection = assert.rejects(pending);
  await flush();
  env.data.cancelResourceRequests(
    queryKeys.workspaceBoards(env.identity, team.id),
  );
  await env.data.queryClient.cancelQueries({
    queryKey: queryKeys.workspaceBoards(env.identity, team.id),
  });
  assert.equal(
    (await env.data.queryClient.fetchInfiniteQuery(b)).pages[0]?.data[0]
      ?.workspaceId,
    personal.id,
  );
  const fresh = await env.data.queryClient.fetchInfiniteQuery(a);
  old.resolve(pageAt('https://test.invalid/?page=1&limit=20', [board()]));
  await rejection;
  await flush();
  assert.equal(fresh.pages[0]?.data[0]?.name, 'Fresh A');
  assert.equal(env.data.queryClient.getQueryData(a.queryKey), fresh);
  assert.equal(
    env.requests.filter(({ url }) => url.includes('/boards?')).length,
    3,
  );
});

test('realtime Workspace loss fences selected Boards and metadata immediately; joined-list recovery stays bounded', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  env.socket.server('connect');
  let revoked = false;
  const late = deferred<Response>();
  let delayed = false;
  env.respond((url) =>
    listCall(url)
      ? Promise.resolve(pageAt(url, revoked ? [personal] : [personal, team]))
      : url.includes(`${team.id}/boards`)
        ? delayed
          ? late.promise
          : Promise.resolve(pageAt(url, [board()]))
        : url.endsWith(`${team.id}/overview`)
          ? Promise.resolve(ok(overview()))
          : null,
  );
  const directory = new QueryObserver(
    env.data.queryClient,
    workspaceDirectoryOptions(env.data, env.identity),
  );
  const boards = new InfiniteQueryObserver(
    env.data.queryClient,
    workspaceBoardOptions(env.data, env.identity, team.id),
  );
  const meta = new QueryObserver(
    env.data.queryClient,
    workspaceOverviewOptions(env.data, env.identity, team.id),
  );
  for (const observer of [directory, boards, meta])
    t.after(observer.subscribe(() => {}));
  await flush();
  assert.equal(directory.getCurrentResult().data?.length, 2);
  assert.equal(
    boards.getCurrentResult().data?.pages[0]?.data[0]?.name,
    'Board 1',
  );
  assert.equal(meta.getCurrentResult().data?.memberCount, 3);
  delayed = true;
  void boards.refetch();
  await flush();
  revoked = true;
  for (let i = 0; i < 4; i++)
    env.socket.server('workspace:access-revoked', { workspaceId: team.id });
  assert.equal(boards.getCurrentResult().data, undefined);
  assert.equal(meta.getCurrentResult().data, undefined);
  assert.equal(directory.getCurrentResult().data, undefined);
  late.resolve(pageAt('https://test.invalid/?page=1&limit=20', [board()]));
  env.time.advance(50);
  await flush();
  assert.deepEqual(directory.getCurrentResult().data, [personal]);
  assert.equal(boards.getCurrentResult().data, undefined);
  assert.equal(
    env.requests.filter(({ url }) => url.endsWith('/overview')).length,
    1,
  );
  assert.equal(env.requests.filter(({ url }) => listCall(url)).length, 2);
  assert.equal(
    env.requests.filter(({ url }) => url.includes('/boards?')).length,
    2,
  );
});

test('membership 404 fences the old cache, 401 ends session, and account replacement aborts a late directory', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  let status = 200;
  const late = deferred<Response>();
  env.respond((url) =>
    listCall(url)
      ? late.promise
      : url.endsWith(`/workspaces/${team.id}`)
        ? Promise.resolve(status === 200 ? ok(team) : json({}, status))
        : null,
  );
  const id = env.identity;
  const options = workspaceDetailOptions(env.data, id, team.id);
  assert.deepEqual(await env.data.queryClient.fetchQuery(options), team);
  status = 404;
  const observer = new QueryObserver(env.data.queryClient, options);
  t.after(observer.subscribe(() => {}));
  await observer.refetch();
  assert.equal(observer.getCurrentResult().isError, true);
  assert.equal(env.data.queryClient.getQueryData(options.queryKey), undefined);
  assert.equal(env.data.resources.readable(options.queryKey), false);
  const old = workspaceDirectoryOptions(env.data, id);
  const pending = assert.rejects(env.data.queryClient.fetchQuery(old));
  await flush();
  await env.manager.establishSession(loginResponse(USER_B));
  late.resolve(pageAt('https://test.invalid/?page=1&limit=20', [team]));
  await pending;
  assert.equal(env.data.queryClient.getQueryData(old.queryKey), undefined);
  status = 401;
  await assert.rejects(
    env.data.queryClient.fetchQuery(
      workspaceDetailOptions(env.data, env.identity, team.id),
    ),
  );
  assert.equal(env.data.getIdentity(), null);
});
test('a Board revoke also purges authorized Workspace overview previews without a Board room', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  env.socket.server('connect');
  let revoked = false;
  env.respond((url) =>
    url.endsWith('/overview')
      ? Promise.resolve(
          ok(
            revoked
              ? {
                  ...overview(),
                  visibleBoardCount: 0,
                  activeBoardCount: 0,
                  recentBoards: [],
                }
              : overview(),
          ),
        )
      : null,
  );
  const options = workspaceOverviewOptions(env.data, env.identity, team.id);
  const observer = new QueryObserver(env.data.queryClient, options);
  t.after(observer.subscribe(() => {}));
  await flush();
  assert.equal(observer.getCurrentResult().data?.recentBoards.length, 1);
  revoked = true;
  env.socket.server('board:access-revoked', { boardId: board().id });
  assert.equal(observer.getCurrentResult().data, undefined);
  env.time.advance(50);
  await flush();
  assert.equal(observer.getCurrentResult().data?.recentBoards.length, 0);
  assert.equal(
    env.requests.filter(({ url }) => url.endsWith('/overview')).length,
    2,
  );
});

test('a complete directory fences previously read Workspace data even without a cached directory', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const identity = env.identity;
  const detail = workspaceDetailOptions(env.data, identity, team.id);
  const directory = workspaceDirectoryOptions(env.data, identity);
  const home = queryKeys.home(identity);
  env.respond((url) =>
    listCall(url)
      ? Promise.resolve(pageAt(url, [personal]))
      : Promise.resolve(ok(team)),
  );
  await env.data.queryClient.fetchQuery(detail);
  env.data.queryClient.setQueryData(home, homeFixture());
  assert.deepEqual(await env.data.queryClient.fetchQuery(directory), [
    personal,
  ]);
  assert.equal(env.data.queryClient.getQueryData(detail.queryKey), undefined);
  assert.equal(env.data.queryClient.getQueryData(home), undefined);
  assert.equal(env.data.resources.readable(detail.queryKey), false);
});

test('REST Workspace denial fences Home and pending Board reads before independent permissions are rechecked without a socket', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const identity = env.identity;
  const otherIdentity = { userId: USER_B, generation: identity.generation };
  const denied = board(team.id, 1);
  const member = board(team.id, 2);
  const guest = board(team.id, 3);
  const unrelated = board(personal.id, 4);
  const cachedHome = homeFixture();
  const homeSnapshot = {
    ...cachedHome,
    upNext: [],
    recentBoards: [],
    starredBoards: [denied, member, guest, unrelated].map((item) => ({
      ...cachedHome.starredBoards[0]!,
      id: item.id,
      name: item.name,
      path: `/boards/${item.id}`,
      workspaceId: item.workspaceId,
    })),
  };
  const home = homeOptions(env.data, identity);
  const homeObserver = new QueryObserver(env.data.queryClient, home);
  const lateHome = deferred<Response>();
  const lateBoard = deferred<Response>();
  const lateUnrelated = deferred<Response>();
  const [deniedKey, memberKey, guestKey, unrelatedKey] = [
    denied,
    member,
    guest,
    unrelated,
  ].map(({ id }) => queryKeys.columns(identity, id));
  const lost = workspaceDetailOptions(env.data, identity, team.id);
  const lostObserver = new QueryObserver(env.data.queryClient, {
    ...lost,
    staleTime: Infinity,
  });
  const kept = workspaceDetailOptions(env.data, identity, personal.id);
  const keptBoards = workspaceBoardOptions(env.data, identity, personal.id);
  const directory = workspaceDirectoryOptions(env.data, identity);
  const observer = new QueryObserver(env.data.queryClient, {
    queryKey: memberKey,
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      env.data.api.json(`/boards/${member.id}/columns`, (value) => value, {
        identity,
        resourceKey: memberKey,
        signal,
        retries: 0,
      }),
  });
  const client = env.data.queryClient;
  const otherHome = queryKeys.home(otherIdentity);
  let homeCalls = 0;
  env.respond((input) => {
    const url = new URL(input);
    if (url.pathname === '/api/users/me/home') {
      homeCalls++;
      if (homeCalls === 1) return Promise.resolve(ok(homeSnapshot));
      if (homeCalls === 2) return lateHome.promise;
      return Promise.resolve(homeCalls === 3 ? json({}, 503) : ok(emptyHome()));
    }
    if (url.pathname === `/api/workspaces/${team.id}`)
      return Promise.resolve(json({}, 403));
    if (url.pathname === '/api/workspaces')
      return Promise.resolve(pageAt(input, [personal]));
    if (url.pathname === `/api/workspaces/${personal.id}/boards`)
      return Promise.resolve(pageAt(input, [unrelated]));
    if (url.pathname === `/api/boards/${denied.id}/columns`)
      return lateBoard.promise;
    if (url.pathname === `/api/boards/${unrelated.id}/columns`)
      return lateUnrelated.promise;
    if (url.pathname === `/api/boards/${member.id}/columns`)
      return Promise.resolve(ok('fresh authorized columns'));
    if (url.pathname === `/api/boards/${denied.id}`)
      return Promise.resolve(json({}, 404));
    if (url.pathname === `/api/boards/${member.id}`)
      return Promise.resolve(
        ok({
          ...member,
          currentUserRole: 'MEMBER',
          capabilities: { canReadBoard: true, canWriteBoard: true },
        }),
      );
    if (url.pathname === `/api/boards/${guest.id}`)
      return Promise.resolve(ok({ ...guest, currentUserRole: 'MEMBER' }));
    return null;
  });
  t.after(homeObserver.subscribe(() => {}));
  client.setQueryData(otherHome, emptyHome());
  client.setQueryData(lost.queryKey, team);
  t.after(lostObserver.subscribe(() => {}));
  client.setQueryData(kept.queryKey, personal);
  client.setQueryData(directory.queryKey, [personal, team]);
  const otherBoardList = await client.fetchInfiniteQuery(keptBoards);
  for (const key of [deniedKey, memberKey, guestKey, unrelatedKey])
    client.setQueryData(key, 'cached columns');
  t.after(observer.subscribe(() => {}));
  await flush();
  assert.equal(homeObserver.getCurrentResult().data?.starredBoards.length, 4);
  const refetch = homeObserver.refetch();
  const readColumns = (id: string, resourceKey: typeof deniedKey) =>
    env.data.api.json(`/boards/${id}/columns`, (value) => value, {
      identity,
      resourceKey,
      retries: 0,
    });
  const fenced = assert.rejects(readColumns(denied.id, deniedKey));
  const unrelatedRequest = readColumns(unrelated.id, unrelatedKey);
  await flush();
  await lostObserver.refetch();
  assert.equal(lostObserver.getCurrentResult().isError, true);

  assert.equal(homeObserver.getCurrentResult().data, undefined);
  for (const key of [lost.queryKey, deniedKey, memberKey, guestKey]) {
    assert.equal(client.getQueryData(key), undefined);
    assert.equal(env.data.resources.readable(key), false);
  }
  assert.deepEqual(client.getQueryData(directory.queryKey), [personal]);
  assert.equal(client.getQueryData(unrelatedKey), 'cached columns');
  assert.equal(client.getQueryData(kept.queryKey), personal);
  assert.equal(client.getQueryData(keptBoards.queryKey), otherBoardList);
  assert.deepEqual(client.getQueryData(otherHome), emptyHome());
  assert.equal(env.socket.connected, false);
  assert.equal(env.socket.commands.length, 0);

  lateHome.resolve(ok(homeSnapshot));
  lateBoard.resolve(ok('old restricted columns'));
  lateUnrelated.resolve(ok('authorized unrelated columns'));
  await Promise.all([refetch, fenced]);
  assert.equal(await unrelatedRequest, 'authorized unrelated columns');
  env.time.advance(50);
  await flush();
  const homeError = homeObserver.getCurrentResult().error;
  assert.ok(homeError instanceof ApiError);
  assert.equal(homeError.status, 503);
  assert.equal(homeObserver.getCurrentResult().data, undefined);
  assert.equal(client.getQueryData(deniedKey), undefined);
  assert.equal(env.data.resources.readable(deniedKey), false);
  assert.equal(env.data.resources.readable(memberKey), true);
  assert.doesNotThrow(() => env.data.resources.capture(memberKey, true));
  assert.equal(env.data.resources.readable(guestKey), true);
  assert.throws(() => env.data.resources.capture(guestKey, true));
  assert.equal(client.getQueryData(unrelatedKey), 'cached columns');
  assert.equal(client.getQueryData(keptBoards.queryKey), otherBoardList);
  assert.deepEqual(
    env.requests
      .filter(({ url }) => /\/api\/boards\/[^/]+$/.test(url))
      .map(({ url }) => new URL(url).pathname.split('/').at(-1)),
    [denied.id, member.id, guest.id],
  );
  env.time.advance(50);
  await flush();
  assert.equal(observer.getCurrentResult().data, 'fresh authorized columns');
  assert.equal(homeObserver.getCurrentResult().data, undefined);
  assert.deepEqual((await homeObserver.refetch()).data, emptyHome());
});
