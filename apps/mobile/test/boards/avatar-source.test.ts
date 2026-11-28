import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeAssigneeAvatar } from '../../src/features/boards/kanban-api.ts';
import {
  avatarDataUri,
  avatarRevision,
  externalAvatarUrl,
  managedAvatarPath,
} from '../../src/features/boards/members/avatar-source.ts';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const asset = '33333333-3333-4333-8333-333333333333';
const managed = `/users/${user}/avatar/${asset}`;

test('F03: a backend-managed avatar path no longer decodes to null', () => {
  assert.deepEqual(
    decodeAssigneeAvatar({ avatarUrl: managed, avatarRevision: 4 }, user),
    { avatarUrl: managed, avatarRevision: 4 },
  );
});

test('managed paths are accepted only for the same user and exact shape', () => {
  assert.equal(managedAvatarPath(managed, user), managed);
  for (const value of [
    `/users/${other}/avatar/${asset}`, // another user's photo
    `/users/${user}/avatar/not-a-uuid`,
    `/users/${user}/avatar/${asset}/x`,
    `/users/${user}/avatar/${asset}?token=1`,
    `/users/${user}/avatar/${asset}#x`,
    `/users/${user}/avatar/%2e%2e`,
    `/users/${user}/../avatar/${asset}`,
    `/users/${user}/avatar/${asset}\n`,
    ` /users/${user}/avatar/${asset}`,
    `https://api.example/users/${user}/avatar/${asset}`,
    `users/${user}/avatar/${asset}`,
    null,
    42,
  ])
    assert.equal(managedAvatarPath(value, user), null, String(value));
});

test('legacy external avatars stay plain HTTPS without credentials; everything else is initials', () => {
  assert.equal(
    externalAvatarUrl('https://images.example/a.png'),
    'https://images.example/a.png',
  );
  for (const value of [
    'http://images.example/a.png',
    'https://user:pass@images.example/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///private/a.png',
    `https://images.example/${'a'.repeat(2048)}`,
    '',
    null,
  ])
    assert.equal(externalAvatarUrl(value), null, String(value));
  assert.deepEqual(
    decodeAssigneeAvatar(
      { avatarUrl: `/users/${other}/avatar/${asset}` },
      user,
    ),
    { avatarUrl: null, avatarRevision: 0 },
  );
  assert.deepEqual(
    decodeAssigneeAvatar(
      { avatarUrl: 'https://images.example/a.png', avatarRevision: -1 },
      user,
    ),
    { avatarUrl: 'https://images.example/a.png', avatarRevision: 0 },
  );
});

test('revision is a non-negative safe integer and bytes encode as WebP data', () => {
  assert.equal(avatarRevision(7), 7);
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '3', null])
    assert.equal(avatarRevision(value), 0);
  assert.equal(
    avatarDataUri(new Uint8Array([1, 2, 3, 4])),
    'data:image/webp;base64,AQIDBA==',
  );
});
