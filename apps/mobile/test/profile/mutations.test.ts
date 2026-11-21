import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileCommands } from '../../src/features/profile/mutations.ts';
import { profileKey } from '../../src/features/profile/api.ts';
import {
  receiveProfile,
  beginProfile,
} from '../../src/features/profile/model.ts';
import { integration, ok } from '../realtime/integration-support.ts';
import { flush, USER_A, USER_B, loginResponse } from '../auth/support.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';

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
      env.data.queryClient.getQueryData(profileKey(env.identity))?.displayName,
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
