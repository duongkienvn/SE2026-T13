import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { WorkspaceRole } from '@kanban/shared';
import { createBoardActivityApi } from '../../src/features/activity/board/api.ts';
import {
  activityCardId,
  boardAction,
  boardActivityEntities,
  boardActivityLabels,
  decodeBoardActivity,
} from '../../src/features/activity/board/decoder.ts';
import {
  decodeWorkspaceActivity,
  workspaceAction,
  workspaceActivityLabels,
} from '../../src/features/activity/workspace/decoder.ts';
import { createWorkspaceActivityApi } from '../../src/features/activity/workspace/api.ts';
import {
  activityKeys,
  activityPageKey,
} from '../../src/features/activity/keys.ts';
import { activityTime } from '../../src/features/activity/time.ts';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { createSessionHttpClient } from '../../src/infrastructure/api/session-client.ts';
import { integration, json } from '../realtime/integration-support.ts';
import {
  boardEvent,
  boardId,
  workspaceEvent,
  workspaceId,
} from './fixtures.ts';
import { page, uuid } from '../workspaces/fixtures.ts';
import {
  destinationPath,
  parseLink,
  parsePath,
} from '../../src/navigation/routes.ts';

const signal = new AbortController().signal;

test('vetted native event/action/entity allowlists match the backend source contracts', () => {
  const enums = readFileSync(
    new URL(
      '../../../backend/src/common/enums/database-enums.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const values = (name: string) =>
    [
      ...enums
        .match(new RegExp(`enum ${name} \\{([^}]+)\\}`))![1]!
        .matchAll(/= '([^']+)'/g),
    ].map((m) => m[1]);
  assert.deepEqual(
    Object.keys(boardActivityLabels),
    values('ActivityActionType'),
  );
  assert.deepEqual([...boardActivityEntities], values('ActivityEntityType'));
  const source = readFileSync(
    new URL(
      '../../../backend/src/api/workspaces/entities/workspace-activity.entity.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const events = [
    ...source
      .match(/WORKSPACE_ACTIVITY_TYPES = \[([\s\S]+?)\]/)![1]!
      .matchAll(/'([^']+)'/g),
  ].map((m) => m[1]);
  assert.deepEqual(Object.keys(workspaceActivityLabels), events);
});

test('Workspace projection handles deleted/null people, missing Board and unknown events safely', () => {
  for (const actor of [
    null,
    {
      id: uuid(2),
      displayName: 'Historical private name',
      isDeleted: true,
      avatarUrl: '/private',
    },
  ]) {
    const row = decodeWorkspaceActivity(
      { ...workspaceEvent(), actor, eventType: 'BOARD_MOVED' },
      WorkspaceRole.ADMIN,
    );
    assert.equal(
      row.actor?.displayName ?? 'Someone',
      actor ? 'Deleted user' : 'Someone',
    );
    assert.equal(row.actor?.avatarUrl ?? null, null);
    assert.equal(row.board, null);
    assert.ok(!JSON.stringify(row).includes('Historical private'));
  }
  for (const value of ['FUTURE_EVENT', '__proto__', 'constructor'])
    assert.equal(
      workspaceAction(
        decodeWorkspaceActivity(
          { ...workspaceEvent(), eventType: value },
          WorkspaceRole.ADMIN,
        ),
      ),
      'made a change',
    );
  for (const eventType of Object.keys(workspaceActivityLabels)) {
    const row = { ...workspaceEvent(), eventType };
    assert.doesNotThrow(() =>
      decodeWorkspaceActivity(row, WorkspaceRole.ADMIN),
    );
    if (eventType.startsWith('INVITATION_'))
      assert.throws(() => decodeWorkspaceActivity(row, WorkspaceRole.MEMBER));
    else
      assert.doesNotThrow(() =>
        decodeWorkspaceActivity(row, WorkspaceRole.MEMBER),
      );
  }
  for (const patch of [
    { actor: undefined },
    { actor: [] },
    { board: { id: 'bad', name: 'Hidden' } },
    { createdAt: 'yesterday' },
    { id: 'bad' },
  ])
    assert.throws(() =>
      decodeWorkspaceActivity(
        { ...workspaceEvent(), ...patch },
        WorkspaceRole.ADMIN,
      ),
    );
});

test('Board projection never retains raw private metadata or invents live actor attribution', () => {
  for (const metadata of [
    null,
    {},
    {
      email: 'secret@example.test',
      title: 'Private title',
      cardId: uuid(4),
      body: 'Private comment',
    },
    { fromRole: {}, toRole: 'ADMIN' },
  ]) {
    const row = decodeBoardActivity(
      { ...boardEvent(), metadata, actor: { displayName: 'Invented' } },
      boardId,
      true,
    );
    assert.equal(row.actor, undefined);
    assert.equal(row.metadata, null);
    assert.ok(!JSON.stringify(row).includes('Private'));
  }
  for (const metadata of [[], 'secret', 7, true])
    assert.throws(() =>
      decodeBoardActivity({ ...boardEvent(), metadata }, boardId, true),
    );
  const role = decodeBoardActivity(
    {
      ...boardEvent(),
      actionType: 'ROLE_CHANGED',
      entityType: 'MEMBER',
      metadata: { fromRole: 'MEMBER', toRole: 'OWNER', email: 'secret' },
    },
    boardId,
    true,
  );
  assert.equal(boardAction(role), 'changed a member role (Member → Owner)');
  assert.ok(!JSON.stringify(role).includes('secret'));
  assert.throws(() => decodeBoardActivity(role, boardId, false));
  assert.throws(() => decodeBoardActivity(boardEvent(), uuid(8), true));
  const deleted = decodeBoardActivity(
    {
      ...boardEvent(),
      entityId: null,
      actor: { displayName: 'Deleted user', isDeleted: true },
    },
    boardId,
    false,
  );
  assert.equal(deleted.actor?.displayName, 'Deleted user');
  assert.equal(activityCardId(deleted, boardId), null);
  for (const actionType of ['FUTURE_ACTION', '__proto__', 'constructor']) {
    const row = decodeBoardActivity(
      { ...boardEvent(), actionType },
      boardId,
      false,
    );
    assert.equal(boardAction(row), 'made a change');
    assert.equal(activityCardId(row, boardId), null);
  }
  for (const entityType of [
    'COLUMN',
    'MEMBER',
    'COMMENT',
    'BOARD',
    'FUTURE_ENTITY',
  ])
    assert.equal(
      activityCardId(
        decodeBoardActivity({ ...boardEvent(), entityType }, boardId, true),
        boardId,
      ),
      null,
    );
});

for (const count of [0, 1, 20, 21, 100, 501])
  test(`both REST adapters request bounded server pages for ${count} rows`, async (t) => {
    const env = await integration();
    t.after(env.dispose);
    const requests: URL[] = [];
    env.respond((url) => {
      const target = new URL(url);
      requests.push(target);
      const rows = Array.from({ length: count }, (_, i) =>
        target.pathname.endsWith('/activity')
          ? workspaceEvent(i)
          : boardEvent(i),
      );
      return Promise.resolve(
        json(
          page(
            rows,
            Number(target.searchParams.get('page')),
            Number(target.searchParams.get('limit')),
          ),
        ),
      );
    });
    const board = createBoardActivityApi(env.data.api, env.identity, boardId);
    const workspace = createWorkspaceActivityApi(
      env.data.api,
      env.identity,
      workspaceId,
    );
    for (const api of [
      (p: number) => board.list(p, false, signal),
      (p: number) => workspace.list(p, WorkspaceRole.MEMBER, signal),
    ]) {
      const seen = new Set<string>();
      for (let n = 1; n <= Math.max(1, Math.ceil(count / 20)); n++) {
        const result = await api(n);
        assert.equal(result.meta.total, count);
        assert.equal(result.meta.page, n);
        assert.ok(result.data.length <= 20);
        for (const row of result.data) {
          assert.ok(!seen.has(row.id));
          seen.add(row.id);
        }
      }
      assert.equal(seen.size, count);
    }
    assert.equal(requests.length, Math.max(1, Math.ceil(count / 20)) * 2);
    assert.ok(requests.every((url) => url.searchParams.get('limit') === '20'));
  });

test('adapters reject wrong page/meta/status, duplicate IDs, drift in count and unsorted records', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  let payload = page([boardEvent()], 1, 20);
  let status = 200;
  env.respond(() => Promise.resolve(json(payload, status)));
  const api = createBoardActivityApi(env.data.api, env.identity, boardId);
  for (const malformed of [
    { ...payload, meta: { ...payload.meta, page: 2 } },
    { ...payload, meta: { ...payload.meta, limit: 10 } },
    { ...payload, meta: { ...payload.meta, total: 21, totalPages: 2 } },
    page([boardEvent(), boardEvent()], 1, 20),
    page([boardEvent(1), boardEvent(0)], 1, 20),
    page([{ ...boardEvent(), boardId: uuid(8) }], 1, 20),
  ]) {
    payload = malformed;
    await assert.rejects(api.list(1, false, signal));
  }
  payload = page([boardEvent()], 1, 20);
  status = 201;
  await assert.rejects(api.list(1, false, signal));
  for (const [number, limit] of [
    [0, 20],
    [1, 101],
    [Number.MAX_SAFE_INTEGER, 100],
  ])
    await assert.rejects(api.list(number!, false, signal, limit));
});

test('pagination and session/scope cache identities never overlap', async () => {
  const a = { userId: uuid(1), generation: 1 };
  const b = { ...a, generation: 2 };
  const keys = [
    activityKeys.board(a, boardId),
    activityKeys.workspace(a, boardId),
    activityKeys.board(b, boardId),
    activityPageKey(activityKeys.board(a, boardId), 1, 20),
    activityPageKey(activityKeys.board(a, boardId), 2, 20),
  ];
  assert.equal(
    new Set(keys.map((key) => JSON.stringify(key))).size,
    keys.length,
  );
  for (const kind of ['workspaceActivity', 'boardActivity'] as const) {
    const destination =
      kind === 'workspaceActivity'
        ? { kind, workspaceId: uuid(1) }
        : { kind, boardId: uuid(1) };
    const path = destinationPath(
      parsePath(
        kind === 'workspaceActivity'
          ? `/workspaces/${uuid(1)}/activity`
          : `/boards/${uuid(1)}/activity`,
      )!,
    );
    assert.deepEqual(parseLink(`https://kanvexa.tech${path}`), destination);
  }
});

test('time formatting follows saved date/timezone, midnight and DST exact offsets', () => {
  const at = '2026-11-01T05:30:00.000Z';
  const prefs = {
    timeZone: 'America/New_York',
    dateFormat: 'DD/MM/YYYY' as const,
  };
  const first = activityTime(at, prefs, Date.parse(at) + 60_000, 'en');
  assert.equal(first.relative, '1 minute ago');
  assert.match(first.exact, /UTC−04:00/);
  const second = activityTime(
    '2026-11-01T06:30:00.000Z',
    prefs,
    Date.parse('2026-11-01T06:31:00Z'),
    'en',
  );
  assert.match(second.exact, /UTC−05:00/);
  const midnight = activityTime(
    '2026-11-17T17:01:00.000Z',
    { timeZone: 'Asia/Bangkok', dateFormat: 'DD/MM/YYYY' },
    Date.parse('2026-11-19T00:00:00Z'),
    'en',
  );
  assert.match(midnight.relative, /^18\/11\/2026/);
  assert.match(midnight.exact, /2026-11-17T17:01:00.000Z/);
});

test('AbortSignal and authenticated session adapter are required by the REST boundary', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  let captured: RequestInit | undefined;
  const transport = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    fetch: async (_url, init) => {
      captured = init;
      return json(page([], 1, 20));
    },
  });
  const network = createSessionHttpClient(transport, env.manager);
  t.after(network.dispose);
  await createBoardActivityApi(network.client, env.identity, boardId).list(
    1,
    false,
    signal,
  );
  assert.ok(captured?.signal);
  assert.match(
    String((captured!.headers as Record<string, string>).Authorization),
    /^Bearer /,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createBoardActivityApi(network.client, env.identity, boardId).list(
      1,
      false,
      controller.signal,
    ),
  );
});
