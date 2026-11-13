import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InfiniteQueryObserver, QueryObserver } from '@tanstack/react-query';
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
