import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integration, ok, json } from '../realtime/integration-support.ts';
import { flush, loginResponse, USER_B } from '../auth/support.ts';
import { deletionCommands } from '../../src/features/account-deletion/commands.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { onlineManager } from '@tanstack/react-query';
const request = {
  confirmation: 'DELETE',
  method: 'password' as const,
  password: 'private-proof',
};
test('final deliberate submit sends one exact DELETE; only 204 clears all private data', async () => {
  const env = await integration(),
    cmd = deletionCommands(env.data, env.manager, env.identity);
  let release!: (r: Response) => void;
  env.respond((_u, init) =>
    init.method === 'DELETE'
      ? new Promise((r) => (release = r))
      : Promise.resolve(ok({ hasPassword: true, googleLinked: false })),
  );
  try {
    await cmd.refresh();
    assert.equal(
      env.requests.some((r) => r.init.method === 'DELETE'),
      false,
    );
    env.data.queryClient.setQueryData(
      [...queryKeys.scope(env.identity), 'search', 'private'],
      { secret: 'old' },
    );
    const pending = cmd.submit(request, null);
    await flush();
    void cmd.submit(request, null);
    await flush();
    assert.equal(
      env.requests.filter((r) => r.init.method === 'DELETE').length,
      1,
    );
    assert.equal(
      JSON.stringify(cmd.getSnapshot()).includes(request.password),
      false,
    );
    assert.equal(
      JSON.stringify(env.data.queryClient.getMutationCache().getAll()).includes(
        request.password,
      ),
      false,
    );
    release(new Response(null, { status: 204 }));
    await pending;
    assert.equal(env.data.getIdentity(), null);
    assert.equal(
      env.data.queryClient.getQueriesData({ queryKey: queryKeys.private })
        .length,
      0,
    );
    const snapshot = env.manager.getSnapshot();
    if (snapshot.status === 'unauthenticated')
      assert.equal(snapshot.reason, 'account-deleted');
    else assert.fail();
  } finally {
    env.dispose();
  }
});
test('timeout and false success fence the session and never replay DELETE', async () => {
  for (const result of ['timeout', '200'] as const) {
    const env = await integration(),
      cmd = deletionCommands(env.data, env.manager, env.identity);
    env.respond((_u, init) =>
      init.method === 'DELETE'
        ? result === 'timeout'
          ? new Promise(() => {})
          : Promise.resolve(ok(null))
        : Promise.resolve(ok({ hasPassword: true, googleLinked: false })),
    );
    await cmd.refresh();
    const pending = cmd.submit(request, null);
    await flush();
    if (result === 'timeout') env.time.advance(45001);
    await pending;
    const snapshot = env.manager.getSnapshot();
    if (snapshot.status === 'unauthenticated')
      assert.equal(snapshot.reason, 'deletion-uncertain');
    else assert.fail();
    assert.equal(
      env.requests.filter((r) => r.init.method === 'DELETE').length,
      1,
    );
    env.dispose();
  }
});
test('blockers and concurrent CONFLICT keep the session, clear proof, and never auto-delete on refresh', async () => {
  const env = await integration(),
    cmd = deletionCommands(env.data, env.manager, env.identity);
  let status = 409;
  env.respond((_u, init) =>
    Promise.resolve(
      init.method === 'DELETE'
        ? json(
            {
              success: false,
              statusCode: status,
              code: 'ACCOUNT_DELETION_BLOCKED',
              message: 'private error',
              blockers: [
                {
                  type: 'BOARD_REQUIRES_ANOTHER_OWNER',
                  totalCount: 2,
                  resources: [{ id: env.identity.userId, name: 'Own board' }],
                },
              ],
            },
            status,
          )
        : ok({ hasPassword: true, googleLinked: false }),
    ),
  );
  try {
    await cmd.refresh();
    await cmd.submit(request, null);
    assert.ok(env.data.getIdentity());
    assert.equal(cmd.getSnapshot().blockers[0]?.totalCount, 2);
    assert.ok(!cmd.getSnapshot().error.includes('private error'));
    await cmd.refresh();
    assert.equal(
      env.requests.filter((r) => r.init.method === 'DELETE').length,
      1,
    );
    status = 409;
    env.respond((_u, init) =>
      Promise.resolve(
        init.method === 'DELETE'
          ? json(
              {
                success: false,
                statusCode: 409,
                code: 'CONFLICT',
                message: 'raced',
              },
              409,
            )
          : ok({ hasPassword: true, googleLinked: false }),
      ),
    );
    await cmd.submit(request, null);
    assert.equal(cmd.getSnapshot().blockers.length, 0);
    assert.match(cmd.getSnapshot().error, /resources changed/);
  } finally {
    env.dispose();
  }
});
test('a late A response cannot erase or report deletion for B', async () => {
  const env = await integration(),
    cmd = deletionCommands(env.data, env.manager, env.identity);
  let release!: (r: Response) => void;
  env.respond((_u, init) =>
    init.method === 'DELETE'
      ? new Promise((r) => (release = r))
      : Promise.resolve(ok({ hasPassword: true, googleLinked: false })),
  );
  await cmd.refresh();
  const pending = cmd.submit(request, null);
  await flush();
  await env.manager.establishSession(loginResponse(USER_B));
  release(new Response(null, { status: 204 }));
  await pending;
  const snapshot = env.manager.getSnapshot();
  assert.equal(snapshot.status, 'authenticated');
  if (snapshot.status === 'authenticated')
    assert.equal(snapshot.user.id, USER_B);
  assert.equal(cmd.getSnapshot().blockers.length, 0);
  env.dispose();
});

test('validation, offline, unavailable proof and changed providers never start DELETE', async () => {
  const env = await integration(),
    cmd = deletionCommands(env.data, env.manager, env.identity);
  env.respond(() =>
    Promise.resolve(ok({ hasPassword: false, googleLinked: true })),
  );
  try {
    await cmd.submit({ ...request, confirmation: ' DELETE' }, null);
    await cmd.submit(request, null);
    await cmd.submit({ ...request, method: 'google' }, null);
    onlineManager.setOnline(false);
    await cmd.submit(request, null);
    assert.equal(
      env.requests.filter((r) => r.init.method === 'DELETE').length,
      0,
    );
    assert.match(cmd.getSnapshot().error, /offline/);
  } finally {
    onlineManager.setOnline(true);
    env.dispose();
  }
});

test('Google cancellation and invalid audience do not exchange credentials or delete', async () => {
  for (const result of [
    { kind: 'cancelled' as const },
    { kind: 'token' as const, idToken: 'bad.token.value' },
  ]) {
    const env = await integration(),
      cmd = deletionCommands(env.data, env.manager, env.identity);
    let resets = 0;
    env.respond(() =>
      Promise.resolve(ok({ hasPassword: false, googleLinked: true })),
    );
    await cmd.submit(
      { ...request, method: 'google' },
      {
        webClientId: 'configured',
        reset: async () => {
          resets++;
        },
        requestIdToken: async () => result,
      },
    );
    assert.equal(env.requests.filter((r) => r.init.method !== 'GET').length, 0);
    assert.equal(resets, 2);
    assert.ok(env.data.getIdentity());
    env.dispose();
  }
});

test('definite proof failures remain recoverable; 429 survives screen re-entry and stops retries', async () => {
  for (const [status, code] of [
    [403, 'FORBIDDEN'],
    [401, 'INVALID_GOOGLE_CREDENTIAL'],
    [503, 'GOOGLE_AUTH_UNAVAILABLE'],
    [429, 'TOO_MANY_REQUESTS'],
  ] as const) {
    const env = await integration(),
      cmd = deletionCommands(env.data, env.manager, env.identity);
    env.respond((_u, init) =>
      Promise.resolve(
        init.method === 'DELETE'
          ? json(
              {
                success: false,
                statusCode: status,
                code,
                message: 'secret server text',
              },
              status,
            )
          : ok({ hasPassword: true, googleLinked: false }),
      ),
    );
    await cmd.submit(request, null);
    assert.ok(env.data.getIdentity());
    assert.equal(cmd.getSnapshot().error.includes('secret server text'), false);
    if (status === 429) {
      cmd.clear();
      await cmd.refresh();
      await cmd.submit(request, null);
      assert.equal(
        env.requests.filter((r) => r.init.method === 'DELETE').length,
        1,
      );
      assert.ok(cmd.getSnapshot().until > Date.now());
    }
    env.dispose();
  }
});
