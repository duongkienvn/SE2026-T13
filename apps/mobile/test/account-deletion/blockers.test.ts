import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integration, ok } from '../realtime/integration-support.ts';
import { blockerDestination } from '../../src/features/account-deletion/blockers.ts';
import { boardDetail } from '../workspaces/kanban-fixtures.ts';
import { workspace } from '../workspaces/fixtures.ts';
import { loginResponse, USER_B, flush } from '../auth/support.ts';
test('a fresh probe recovers restored resource access and rejects an in-flight revocation', async () => {
  const env = await integration(),
    id = boardDetail.id,
    w = workspace();
  const owner = {
    ...boardDetail,
    currentUserRole: 'OWNER',
    capabilities: { ...boardDetail.capabilities, canManageMembers: true },
  };
  env.data.resources.fenceBoard(id, true);
  env.data.resources.denyWorkspace(w.id);
  env.respond((url) =>
    Promise.resolve(
      ok(
        url.includes('/boards/')
          ? owner
          : { ...w, role: 'ADMIN', canManage: true },
      ),
    ),
  );
  try {
    assert.equal(
      await blockerDestination(
        env.data,
        env.identity,
        'BOARD_REQUIRES_ANOTHER_OWNER',
        id,
        new AbortController().signal,
      ),
      `/boards/${id}/members`,
    );
    assert.equal(
      await blockerDestination(
        env.data,
        env.identity,
        'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
        w.id,
        new AbortController().signal,
      ),
      `/workspaces/${w.id}/members`,
    );
    let release!: (response: Response) => void;
    env.respond(() => new Promise((r) => (release = r)));
    const pending = blockerDestination(
      env.data,
      env.identity,
      'BOARD_REQUIRES_ANOTHER_OWNER',
      id,
      new AbortController().signal,
    );
    await flush();
    env.data.resources.fenceBoard(id, true);
    release(ok(owner));
    await assert.rejects(pending);
  } finally {
    env.dispose();
  }
});
test('archived OWNER resolves through restore settings; revocation never grants a link', async () => {
  const env = await integration();
  let restore = true;
  env.respond(() =>
    Promise.resolve(
      ok({
        ...boardDetail,
        isArchived: true,
        archivedAt: '2026-11-13T09:00:00.000Z',
        currentUserRole: 'OWNER',
        capabilities: {
          ...boardDetail.capabilities,
          canManageBoard: false,
          canManageMembers: false,
          canRestoreBoard: restore,
        },
      }),
    ),
  );
  try {
    for (const type of [
      'PERSONAL_WORKSPACE_HAS_BOARDS',
      'BOARD_REQUIRES_ANOTHER_OWNER',
    ] as const)
      assert.equal(
        await blockerDestination(
          env.data,
          env.identity,
          type,
          boardDetail.id,
          new AbortController().signal,
        ),
        `/boards/${boardDetail.id}/settings`,
      );
    restore = false;
    assert.equal(
      await blockerDestination(
        env.data,
        env.identity,
        'BOARD_REQUIRES_ANOTHER_OWNER',
        boardDetail.id,
        new AbortController().signal,
      ),
      null,
    );
  } finally {
    env.dispose();
  }
});
test('all three blocker destinations require fresh explicit management permission, including archived boards', async () => {
  const env = await integration();
  let owner = false,
    admin = false;
  env.respond((url) =>
    Promise.resolve(
      ok(
        url.includes('/boards/')
          ? {
              ...boardDetail,
              isArchived: true,
              archivedAt: '2026-11-13T09:00:00.000Z',
              currentUserRole: owner ? 'OWNER' : null,
              capabilities: {
                ...boardDetail.capabilities,
                canManageBoard: owner,
                canManageMembers: owner,
              },
            }
          : {
              ...workspace(),
              role: admin ? 'ADMIN' : 'MEMBER',
              canManage: admin,
            },
      ),
    ),
  );
  const resolve = (
    type:
      | 'PERSONAL_WORKSPACE_HAS_BOARDS'
      | 'BOARD_REQUIRES_ANOTHER_OWNER'
      | 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
    id = boardDetail.id,
  ) =>
    blockerDestination(
      env.data,
      env.identity,
      type,
      id,
      new AbortController().signal,
    );
  try {
    assert.equal(await resolve('PERSONAL_WORKSPACE_HAS_BOARDS'), null);
    assert.equal(await resolve('BOARD_REQUIRES_ANOTHER_OWNER'), null);
    assert.equal(
      await resolve('TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN', workspace().id),
      null,
    );
    owner = true;
    admin = true;
    assert.equal(
      await resolve('PERSONAL_WORKSPACE_HAS_BOARDS'),
      `/boards/${boardDetail.id}/settings`,
    );
    assert.equal(
      await resolve('BOARD_REQUIRES_ANOTHER_OWNER'),
      `/boards/${boardDetail.id}/members`,
    );
    assert.equal(
      await resolve('TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN', workspace().id),
      `/workspaces/${workspace().id}/members`,
    );
    assert.equal(
      await resolve('BOARD_REQUIRES_ANOTHER_OWNER', '../private'),
      null,
    );
    assert.equal(env.requests.length, 6);
  } finally {
    env.dispose();
  }
});
test('permission result from A cannot provide a blocker destination to B', async () => {
  const env = await integration();
  let release!: (response: Response) => void;
  env.respond(() => new Promise((r) => (release = r)));
  const pending = blockerDestination(
    env.data,
    env.identity,
    'BOARD_REQUIRES_ANOTHER_OWNER',
    boardDetail.id,
    new AbortController().signal,
  );
  await flush();
  await env.manager.establishSession(loginResponse(USER_B));
  release(ok(boardDetail));
  await assert.rejects(pending);
  env.dispose();
});
