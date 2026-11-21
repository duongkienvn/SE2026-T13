import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeProfile,
  displayNamePatch,
  privateAvatarPath,
} from '../../src/features/profile/model.ts';
import { createProfileApi } from '../../src/features/profile/api.ts';
import { integration, ok } from '../realtime/integration-support.ts';
import { USER_A, USER_B } from '../auth/support.ts';
import {
  parsePath,
  parseLink,
  destinationPath,
} from '../../src/navigation/routes.ts';

export const profile = (patch = {}) => ({
  id: USER_A,
  email: 'a@example.com',
  displayName: 'Alex',
  avatarUrl: null,
  avatarRevision: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});
test('profile routes are allowlisted internal screens and email confirmation tokens have no mobile handler', () => {
  for (const screen of ['profile', 'change-email']) {
    const target = parsePath(`/${screen}`);
    assert.deepEqual(target, { kind: 'screen', screen });
    assert.equal(destinationPath(target!), `/${screen}`);
  }
  assert.equal(
    parseLink('https://kanvexa.tech/confirm-email-change?token=private'),
    null,
  );
  assert.equal(parsePath('/profile?token=private'), null);
});
test('profile decoder requires revision, dates, identity and allowlisted public fields', () => {
  assert.deepEqual(decodeProfile(profile()), profile());
  for (const patch of [
    { avatarRevision: -1 },
    { avatarRevision: undefined },
    { id: 'bad' },
    { createdAt: 'yesterday' },
    { email: null },
    { displayName: '' },
    { passwordHash: 'private' },
  ])
    assert.throws(() => decodeProfile(profile(patch)));
});
test('only a trimmed 2–80 character display name can be patched', () => {
  assert.deepEqual(displayNamePatch('  Jo  '), { displayName: 'Jo' });
  assert.deepEqual(displayNamePatch('a'.repeat(80)), {
    displayName: 'a'.repeat(80),
  });
  assert.deepEqual(displayNamePatch('😀'.repeat(80)), {
    displayName: '😀'.repeat(80),
  });
  for (const value of [
    '',
    '  ',
    'a',
    'a'.repeat(81),
    null,
    { displayName: 'Jo', email: 'other@example.com' },
  ])
    assert.throws(() => displayNamePatch(value));
});
test('private avatar paths require an exact relative own-user path, never legacy URLs', () => {
  const path = `/users/${USER_A}/avatar/${USER_B}`;
  assert.equal(privateAvatarPath(path, USER_A), path);
  for (const input of [
    path + '?token=secret',
    path + '/..',
    path.replace(USER_A, USER_B),
    'https://example.com/a.png',
    '//example.com',
    '/users/%2e/avatar/x',
    path + '\n',
  ])
    assert.equal(privateAvatarPath(input, USER_A), null);
});
test('profile requests use authenticated session and exact PATCH body; reject another user', async () => {
  const env = await integration();
  try {
    env.respond(async (_url, init) => {
      if (init.method === 'PATCH')
        assert.deepEqual(JSON.parse(init.body as string), {
          displayName: 'Jo',
        });
      return ok(profile());
    });
    const api = createProfileApi(env.data.api, env.identity);
    await api.get(new AbortController().signal);
    await api.patch(' Jo ', new AbortController().signal);
    env.respond(async () => ok(profile({ id: USER_B })));
    await assert.rejects(() => api.get(new AbortController().signal));
  } finally {
    env.dispose();
  }
});
