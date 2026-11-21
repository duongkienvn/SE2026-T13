import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileCommands } from '../../src/features/profile/mutations.ts';
import { profileKey } from '../../src/features/profile/api.ts';
import {
  receiveProfile,
  beginProfile,
  type Profile,
} from '../../src/features/profile/model.ts';
import { integration, ok, json } from '../realtime/integration-support.ts';
import { flush, USER_A, USER_B, loginResponse } from '../auth/support.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';

test('uncertain avatar completion retries only its own receipt and unlocks on full ACK', async () => {
  const env = await integration();
  try {
    const commands = profileCommands(env.data, env.identity);
    await assert.rejects(() =>
      commands.run('photo', async () => {
        commands.rememberAvatar({
          kind: 'complete',
          uploadId: USER_B,
          baseRevision: 0,
        });
        throw new ApiError('timeout', { requestStarted: true });
      }),
    );
    env.respond(async (url) => {
      assert.ok(url.endsWith(`/avatar/uploads/${USER_B}/complete`));
      return ok(
        profile({
          avatarRevision: 1,
          avatarUrl: `/users/${USER_A}/avatar/${USER_B}`,
        }),
      );
    });
    await commands.retryAvatar();
    assert.equal(commands.getSnapshot().uncertain, false);
    assert.equal(commands.getSnapshot().recovery, null);
  } finally {
    env.dispose();
  }
});

const profile = (patch = {}) => ({
  id: USER_A,
  email: 'a@example.com',
  displayName: 'Alex',
  avatarUrl: null,
  avatarRevision: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...patch,
});
test('profile ACK updates current session UI without replacing credentials; duplicate commands blocked', async () => {
  const env = await integration();
  try {
    let finish!: (value: Response) => void;
    env.respond(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const commands = profileCommands(env.data, env.identity);
    const saved = commands.run('name', (api, signal) =>
      api.patch('New name', signal),
    );
    await flush();
    await assert.rejects(() =>
      commands.run('name', (api, signal) => api.patch('Other', signal)),
    );
    finish(ok(profile({ displayName: 'Server name' })));
    await saved;
    assert.equal(env.manager.getSnapshot().status, 'authenticated');
    const snapshot = env.manager.getSnapshot();
    if (snapshot.status === 'authenticated')
      assert.equal(snapshot.user.displayName, 'Server name');
    assert.equal(
      env.data.queryClient.getQueryData<Profile>(profileKey(env.identity))
        ?.displayName,
      'Server name',
    );
  } finally {
    env.dispose();
  }
});
test('timed-out PATCH remains write-blocked after GET and screen reentry', async () => {
  const env = await integration();
  try {
    const commands = profileCommands(env.data, env.identity);
    await assert.rejects(() =>
      commands.run('name', async () => {
        throw new ApiError('timeout', { requestStarted: true });
      }),
    );
    env.respond(async () => ok(profile()));
    await commands.refresh(new AbortController().signal);
    assert.equal(
      profileCommands(env.data, env.identity).getSnapshot().uncertain,
      true,
    );
    await assert.rejects(() =>
      commands.run('name', (api, signal) => api.patch('Another', signal)),
    );
  } finally {
    env.dispose();
  }
});
test('late PATCH and 401 from A cannot modify session B', async () => {
  const env = await integration();
  try {
    let finish!: (value: Response) => void;
    env.respond(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const commands = profileCommands(env.data, env.identity);
    const pending = commands
      .run('name', (api, signal) => api.patch('Private A', signal))
      .catch(() => null);
    await flush();
    await env.manager.establishSession(loginResponse(USER_B));
    finish(ok(profile()));
    await pending;
    assert.equal(
      env.data.queryClient.getQueryData(profileKey(env.identity)),
      undefined,
    );
    const snapshot = env.manager.getSnapshot();
    assert.equal(snapshot.status, 'authenticated');
    if (snapshot.status === 'authenticated')
      assert.equal(snapshot.user.id, USER_B);
  } finally {
    env.dispose();
  }
});
test('remote name refresh retains dirty text and requires review', () => {
  const draft = { ...beginProfile(profile()), text: 'My draft' };
  const next = receiveProfile(draft, profile({ displayName: 'Web edit' }));
  assert.equal(next.text, 'My draft');
  assert.equal(next.saved.displayName, 'Web edit');
  assert.equal(next.conflict, true);
});

test('session end synchronously clears profile observations and avatar recovery', async () => {
  const env = await integration();
  try {
    const commands = profileCommands(env.data, env.identity);
    await assert.rejects(() =>
      commands.run('name', async () => {
        throw new ApiError('timeout');
      }),
    );
    env.respond(async () => ok(profile()));
    await commands.refresh(new AbortController().signal);
    assert.ok(commands.getSnapshot().observation);
    await env.manager.logout();
    assert.equal(commands.getSnapshot().observation, null);
    assert.equal(commands.getSnapshot().error, null);
    assert.equal(commands.getSnapshot().recovery, null);
  } finally {
    env.dispose();
  }
});
test('a prior avatar receipt cannot unlock a later uncertain name PATCH', async () => {
  const env = await integration();
  try {
    const commands = profileCommands(env.data, env.identity);
    await assert.rejects(() =>
      commands.run('photo', async () => {
        commands.rememberAvatar({
          kind: 'complete',
          uploadId: USER_B,
          baseRevision: 0,
        });
        throw new ApiError('http', { status: 409 });
      }),
    );
    await assert.rejects(() =>
      commands.run('name', async () => {
        throw new ApiError('timeout');
      }),
    );
    assert.equal(commands.getSnapshot().recovery, null);
    assert.throws(() => commands.retryAvatar());
    assert.equal(commands.getSnapshot().uncertain, true);
  } finally {
    env.dispose();
  }
});

for (const [status, code] of [
  [409, 'AVATAR_UPLOAD_EXPIRED'],
  [409, 'AVATAR_CHANGED'],
  [404, 'AVATAR_UPLOAD_NOT_FOUND'],
] as const) {
  test(`terminal recovery ${code} clears its receipt, refreshes the profile and permits new edits`, async () => {
    const env = await integration();
    try {
      const commands = profileCommands(env.data, env.identity);
      await assert.rejects(() =>
        commands.run('photo', async () => {
          commands.rememberAvatar({
            kind: 'complete',
            uploadId: USER_B,
            baseRevision: 0,
          });
          throw new ApiError('http', { status: 503 });
        }),
      );
      let reads = 0;
      env.respond(async (url) => {
        if (url.endsWith('/complete'))
          return json(
            {
              success: false,
              statusCode: status,
              code,
              message: 'Unavailable',
            },
            status,
          );
        reads++;
        return ok(
          profile({ displayName: 'Latest Web name', avatarRevision: 1 }),
        );
      });
      await assert.rejects(() => commands.retryAvatar());
      assert.equal(commands.getSnapshot().uncertain, false);
      assert.equal(commands.getSnapshot().recovery, null);
      assert.equal(reads, 1);
      assert.equal(
        env.data.queryClient.getQueryData<Profile>(profileKey(env.identity))
          ?.displayName,
        'Latest Web name',
      );
      // Also exercises the user-level uncertainty set, not only the screen flag.
      await commands.run('name', async () =>
        profile({ displayName: 'New edit' }),
      );
    } finally {
      env.dispose();
    }
  });
}

test('terminal recovery keeps new writes blocked during refresh and fences an account switch', async () => {
  const env = await integration();
  try {
    const commands = profileCommands(env.data, env.identity);
    await assert.rejects(() =>
      commands.run('photo', async () => {
        commands.rememberAvatar({
          kind: 'complete',
          uploadId: USER_B,
          baseRevision: 0,
        });
        throw new ApiError('timeout');
      }),
    );
    let finish!: (response: Response) => void;
    env.respond(async (url) =>
      url.endsWith('/complete')
        ? json(
            {
              success: false,
              statusCode: 409,
              code: 'AVATAR_UPLOAD_EXPIRED',
              message: 'Expired',
            },
            409,
          )
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const recovery = commands.retryAvatar().catch(() => null);
    await flush();
    assert.equal(commands.getSnapshot().uncertain, false);
    assert.equal(commands.getSnapshot().pending, 'verify photo');
    await assert.rejects(() => commands.run('name', async () => profile()));
    await env.manager.establishSession(loginResponse(USER_B));
    finish(ok(profile({ displayName: 'Stale A' })));
    await recovery;
    assert.equal(
      env.data.queryClient.getQueryData(profileKey(env.identity)),
      undefined,
    );
    const session = env.manager.getSnapshot();
    assert.equal(session.status, 'authenticated');
    if (session.status === 'authenticated')
      assert.equal(session.user.id, USER_B);
  } finally {
    env.dispose();
  }
});

test('failed terminal refresh drops the obsolete receipt and leaves the query stale for retry', async () => {
  const env = await integration();
  try {
    const commands = profileCommands(env.data, env.identity);
    env.data.queryClient.setQueryData(profileKey(env.identity), profile());
    await assert.rejects(() =>
      commands.run('photo', async () => {
        commands.rememberAvatar({
          kind: 'complete',
          uploadId: USER_B,
          baseRevision: 0,
        });
        throw new ApiError('timeout');
      }),
    );
    env.respond(async (url) =>
      url.endsWith('/complete')
        ? json(
            {
              success: false,
              statusCode: 409,
              code: 'AVATAR_UPLOAD_EXPIRED',
              message: 'Expired',
            },
            409,
          )
        : json({}, 503),
    );
    await assert.rejects(() => commands.retryAvatar());
    assert.equal(commands.getSnapshot().uncertain, false);
    assert.equal(commands.getSnapshot().recovery, null);
    assert.equal(
      env.data.queryClient.getQueryState(profileKey(env.identity))
        ?.isInvalidated,
      true,
    );
    env.respond(async () => ok(profile({ displayName: 'Current' })));
    await commands.refresh(new AbortController().signal);
    assert.equal(
      env.data.queryClient.getQueryData<Profile>(profileKey(env.identity))
        ?.displayName,
      'Current',
    );
  } finally {
    env.dispose();
  }
});
for (const [status, code] of [
  [409, 'AVATAR_UPLOAD_UNAVAILABLE'],
  [503, 'AVATAR_STORAGE_UNAVAILABLE'],
  [404, 'NOT_FOUND'],
] as const) {
  test(`recovery ${code} may still commit and remains uncertain`, async () => {
    const env = await integration();
    try {
      const commands = profileCommands(env.data, env.identity);
      await assert.rejects(() =>
        commands.run('photo', async () => {
          commands.rememberAvatar({
            kind: 'complete',
            uploadId: USER_B,
            baseRevision: 0,
          });
          throw new ApiError('timeout');
        }),
      );
      env.respond(async () =>
        json(
          { success: false, statusCode: status, code, message: 'Unavailable' },
          status,
        ),
      );
      await assert.rejects(() => commands.retryAvatar());
      assert.equal(commands.getSnapshot().uncertain, true);
      assert.ok(commands.getSnapshot().recovery);
      await assert.rejects(() => commands.run('name', async () => profile()));
    } finally {
      env.dispose();
    }
  });
}
