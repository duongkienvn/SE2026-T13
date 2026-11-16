import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeBoard } from '../../src/features/boards/api.ts';
import {
  createBoardLifecycleApi,
  decodeBoardPolicy,
  decodeSamplePreview,
} from '../../src/features/boards/lifecycle-api.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { board, uuid } from './fixtures.ts';

const version = 'a'.repeat(64);
const owner = (overrides: Record<string, unknown> = {}) => ({
  ...board(),
  currentUserRole: 'OWNER',
  createdById: uuid(2),
  visibility: 'WORKSPACE_VISIBLE',
  capabilities: {
    canReadBoard: true,
    canWriteBoard: true,
    canManageBoard: true,
    canManageMembers: true,
    canRestoreBoard: false,
  },
  ...overrides,
});

test('lifecycle commands use the exact methods, paths, bodies and statuses', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const id = owner().id;
  const destination = uuid(7);
  env.respond((url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/archive'))
      return Promise.resolve(
        ok(
          owner({
            isArchived: true,
            archivedAt: '2026-11-15T09:00:00.000Z',
          }),
        ),
      );
    if (path.endsWith('/restore')) return Promise.resolve(ok(owner()));
    if (path.endsWith('/visibility'))
      return Promise.resolve(
        ok(owner({ visibility: JSON.parse(String(init.body)).visibility })),
      );
    if (path.endsWith('/move-workspace'))
      return Promise.resolve(
        ok(owner({ workspaceId: destination, visibility: 'PRIVATE' })),
      );
    if (path.endsWith('/policy-capabilities'))
      return Promise.resolve(
        ok({
          canInviteMembers: true,
          canChangeMembership: true,
          canChangeVisibility: false,
        }),
      );
    if (path.endsWith('/sample-removal') && init.method === 'GET')
      return Promise.resolve(
        ok({
          boardName: 'Welcome',
          isCustomized: false,
          version,
          confirmation: 'REMOVE SAMPLE BOARD',
        }),
      );
    if (path.endsWith('/sample-removal'))
      return Promise.resolve(new Response(null, { status: 204 }));
    return null;
  });
  const api = createBoardLifecycleApi(env.data.api, env.identity);
  const signal = new AbortController().signal;
  assert.equal((await api.archive(id, signal)).isArchived, true);
  assert.equal((await api.restore(id, signal)).isArchived, false);
  assert.equal(
    (await api.visibility(id, 'PRIVATE', signal)).visibility,
    'PRIVATE',
  );
  const moved = await api.move(id, uuid(1), destination, signal);
  assert.equal(moved.workspaceId, destination);
  assert.equal(moved.visibility, 'PRIVATE');
  assert.equal((await api.policy(id, signal)).canChangeVisibility, false);
  const review = await api.samplePreview(id, signal);
  assert.equal(await api.removeSample(id, review, signal), undefined);
  const calls = env.requests.map(({ url, init }) => [
    init.method ?? 'GET',
    new URL(url).pathname.replace(`/api/boards/${id}`, ''),
    init.body === undefined ? undefined : JSON.parse(String(init.body)),
  ]);
  assert.deepEqual(calls, [
    ['POST', '/archive', undefined],
    ['POST', '/restore', undefined],
    ['PATCH', '/visibility', { visibility: 'PRIVATE' }],
    ['POST', '/move-workspace', { destinationWorkspaceId: destination }],
    ['GET', '/policy-capabilities', undefined],
    ['GET', '/sample-removal', undefined],
    [
      'DELETE',
      '/sample-removal',
      { version, confirmation: 'REMOVE SAMPLE BOARD' },
    ],
  ]);
});

test('responses that contradict the command are rejected', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const id = owner().id;
  let reply: Record<string, unknown> = owner();
  env.respond(() => Promise.resolve(ok(reply)));
  const api = createBoardLifecycleApi(env.data.api, env.identity);
  const signal = new AbortController().signal;
  await assert.rejects(api.archive(id, signal), ApiError);
  reply = owner({ isArchived: true, archivedAt: '2026-11-15T09:00:00.000Z' });
  await assert.rejects(api.restore(id, signal), ApiError);
  reply = owner({ visibility: 'WORKSPACE_VISIBLE' });
  await assert.rejects(api.visibility(id, 'PRIVATE', signal), ApiError);
  // Moved to another Workspace but still shared there: not a real server move.
  reply = owner({ workspaceId: uuid(7), visibility: 'WORKSPACE_VISIBLE' });
  await assert.rejects(api.move(id, uuid(1), uuid(7), signal), ApiError);
  // Wrong destination.
  reply = owner({ workspaceId: uuid(8), visibility: 'PRIVATE' });
  await assert.rejects(api.move(id, uuid(1), uuid(7), signal), ApiError);
  // Same-Workspace move is a no-op that keeps visibility.
  reply = owner();
  assert.equal(
    (await api.move(id, uuid(1), uuid(1), signal)).visibility,
    'WORKSPACE_VISIBLE',
  );
  reply = { ...owner(), id: uuid(99) };
  await assert.rejects(api.restore(id, signal), ApiError);
});

test('sample removal surfaces 409 conflict families without retrying the DELETE', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const id = owner().id;
  let code = 'STARTER_BOARD_CHANGED';
  env.respond(() =>
    Promise.resolve(
      json({ success: false, statusCode: 409, code, message: 'Changed' }, 409),
    ),
  );
  const api = createBoardLifecycleApi(env.data.api, env.identity);
  const signal = new AbortController().signal;
  const review = { version, confirmation: 'REMOVE SAMPLE BOARD' } as const;
  await assert.rejects(
    api.removeSample(id, review, signal),
    (error) =>
      error instanceof ApiError &&
      error.status === 409 &&
      error.code === 'STARTER_BOARD_CHANGED',
  );
  code = 'STARTER_BOARD_REMOVAL_UNSAFE';
  await assert.rejects(
    api.samplePreview(id, signal),
    (error) =>
      error instanceof ApiError &&
      error.status === 409 &&
      error.code === 'STARTER_BOARD_REMOVAL_UNSAFE',
  );
  assert.equal(
    env.requests.filter(({ init }) => init.method === 'DELETE').length,
    1,
  );
});

test('decoders reject forged previews, malformed policy and starter hints', () => {
  const preview = {
    boardName: 'Welcome',
    isCustomized: true,
    version,
    confirmation: 'DELETE MY CUSTOMIZED BOARD',
  };
  assert.deepEqual(decodeSamplePreview(preview), preview);
  for (const forged of [
    { ...preview, confirmation: 'REMOVE SAMPLE BOARD' },
    { ...preview, isCustomized: false },
    { ...preview, version: 'A'.repeat(64) },
    { ...preview, version: 'a'.repeat(63) },
    { ...preview, boardName: '  ' },
    { ...preview, confirmation: 'delete' },
  ])
    assert.throws(() => decodeSamplePreview(forged));
  assert.throws(() =>
    decodeBoardPolicy({
      canInviteMembers: true,
      canChangeMembership: true,
      canChangeVisibility: 'yes',
    }),
  );
  const row = { ...board(), createdById: uuid(2) };
  assert.equal(decodeBoard(row).isStarterBoard, false);
  assert.equal(
    decodeBoard({ ...row, isStarterBoard: true }).isStarterBoard,
    true,
  );
  assert.throws(() => decodeBoard({ ...row, isStarterBoard: 'true' }));
});
