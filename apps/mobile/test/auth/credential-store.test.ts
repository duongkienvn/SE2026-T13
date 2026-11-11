import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  credentialFromLogin,
  decodeCredential,
  encodeCredential,
  readTokenSubject,
} from '../../src/infrastructure/auth/credential-record.ts';
import {
  CREDENTIAL_KEY,
  createCredentialStore,
} from '../../src/infrastructure/auth/credential-store.ts';
import { MemorySecureStore, START, USER_A, makeJwt } from './support.ts';

const token = makeJwt(USER_A);

test('login credential uses expiresIn on the device clock and the JWT subject', () => {
  assert.deepEqual(credentialFromLogin(token, 3600, START), {
    accessToken: token,
    expiresAt: START + 3_600_000,
    subject: USER_A,
  });
});

test('login credential rejects bad tokens and lifetimes', () => {
  for (const [value, expiresIn] of [
    ['not-a-jwt', 3600],
    [makeJwt('not-a-uuid'), 3600],
    [`${token}.extra`, 3600],
    [token, 0],
    [token, -5],
    [token, 3600.5],
    [token, 2 * 24 * 3600],
    [token, '3600'],
    [42, 3600],
  ] as const)
    assert.equal(
      credentialFromLogin(value, expiresIn, START),
      null,
      String(value),
    );
});

test('JWT subject needs a UUID sub and integer exp', () => {
  assert.equal(readTokenSubject(token), USER_A);
  const noExp = [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: USER_A })).toString('base64url'),
    'x',
  ].join('.');
  assert.equal(readTokenSubject(noExp), null);
  assert.equal(readTokenSubject('a.!!!.c'), null);
  assert.equal(readTokenSubject(`a.${'b'.repeat(5000)}.c`), null);
});

test('stored record round-trips and holds only version, token and expiry', () => {
  const credential = credentialFromLogin(token, 3600, START)!;
  const raw = encodeCredential(credential);
  assert.deepEqual(Object.keys(JSON.parse(raw)), [
    'v',
    'accessToken',
    'expiresAt',
  ]);
  assert.doesNotMatch(raw, /example|displayName|email/);
  assert.deepEqual(decodeCredential(raw), credential);
});

test('corrupted, foreign or future-version records do not decode', () => {
  const good = JSON.parse(
    encodeCredential(credentialFromLogin(token, 3600, START)!),
  );
  for (const raw of [
    '',
    'null',
    '[]',
    '{',
    JSON.stringify({ ...good, v: 2 }),
    JSON.stringify({ ...good, extra: true }),
    JSON.stringify({ ...good, expiresAt: '1' }),
    JSON.stringify({ ...good, expiresAt: 0 }),
    JSON.stringify({ ...good, expiresAt: 1.5 }),
    JSON.stringify({ ...good, accessToken: 'abc' }),
    'x'.repeat(10_000),
  ])
    assert.equal(decodeCredential(raw), null, raw.slice(0, 40));
});

test('read reports none, valid, and removes invalid values', async () => {
  const storage = new MemorySecureStore();
  const store = createCredentialStore(storage);
  assert.deepEqual(await store.read(), { kind: 'none' });

  const credential = credentialFromLogin(token, 3600, START)!;
  assert.equal(await store.write(credential), true);
  assert.deepEqual(await store.read(), { kind: 'valid', credential });

  storage.values.set(CREDENTIAL_KEY, '{"v":1,"accessToken":"x"');
  assert.deepEqual(await store.read(), { kind: 'invalid' });
  assert.equal(storage.values.has(CREDENTIAL_KEY), false);
});

test('read failure is reported, cleaned up and never thrown', async () => {
  const storage = new MemorySecureStore();
  storage.values.set(CREDENTIAL_KEY, 'whatever');
  storage.faults.add('get');
  const store = createCredentialStore(storage);
  assert.deepEqual(await store.read(), { kind: 'error' });
  assert.equal(storage.values.has(CREDENTIAL_KEY), false);

  storage.faults.add('delete');
  storage.values.set(CREDENTIAL_KEY, 'whatever');
  assert.deepEqual(await store.read(), { kind: 'error' });
});

test('failed or partial writes leave nothing behind', async () => {
  const credential = credentialFromLogin(token, 3600, START)!;
  for (const fault of ['set', 'set-partial'] as const) {
    const storage = new MemorySecureStore();
    storage.faults.add(fault);
    const store = createCredentialStore(storage);
    assert.equal(await store.write(credential), false, fault);
    assert.equal(storage.values.has(CREDENTIAL_KEY), false, fault);
  }
});

test('clear reports platform refusal instead of throwing', async () => {
  const storage = new MemorySecureStore();
  const store = createCredentialStore(storage);
  assert.equal(await store.clear(), true);
  storage.faults.add('delete');
  assert.equal(await store.clear(), false);
});
