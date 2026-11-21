import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEmailChangeApi,
  decodePendingEmail,
  decodeProviders,
  availableProofs,
  validateEmailChange,
  freshGoogleProof,
} from '../../src/features/profile/email-change.ts';
import { integration, ok, json } from '../realtime/integration-support.ts';
import { USER_B, loginResponse, flush } from '../auth/support.ts';
const signal = () => new AbortController().signal;
const failure = (code: string) =>
  json(
    { success: false, statusCode: 401, code, message: 'Private proof failure' },
    401,
  );
test('proof methods are based on server linking and configured native Google, never login assumptions', () => {
  assert.deepEqual(
    availableProofs({ hasPassword: true, googleLinked: true }, true),
    ['password', 'google'],
  );
  assert.deepEqual(
    availableProofs({ hasPassword: false, googleLinked: true }, false),
    [],
  );
  assert.deepEqual(
    availableProofs({ hasPassword: true, googleLinked: false }, true),
    ['password'],
  );
  assert.throws(() =>
    decodeProviders({ hasPassword: 'yes', googleLinked: false }),
  );
});
test('email request accepts exactly one proof, normalizes email, rejects same-address and unsupported fields', () => {
  assert.deepEqual(
    validateEmailChange(
      { newEmail: ' New@Example.COM ', currentPassword: ' secret ' },
      'old@example.com',
    ),
    { newEmail: 'new@example.com', currentPassword: ' secret ' },
  );
  for (const input of [
    { newEmail: 'old@example.com', currentPassword: 'x' },
    { newEmail: 'bad', currentPassword: 'x' },
    { newEmail: 'new@example.com' },
    {
      newEmail: 'new@example.com',
      currentPassword: 'x',
      googleCredential: 'y',
    },
    { newEmail: 'new@example.com', currentPassword: 'x', token: 'secret' },
  ])
    assert.throws(() => validateEmailChange(input, 'old@example.com'));
});
test('pending decoder only permits server mask and exact 30 minute TTL; no clear candidate or proof', () => {
  const pending = {
    maskedNewEmail: 'n***@e***',
    issuedAt: '2026-11-21T00:00:00Z',
    expiresAt: '2026-11-21T00:30:00Z',
  };
  assert.deepEqual(decodePendingEmail(pending), pending);
  assert.equal(decodePendingEmail(null), null);
  for (const patch of [
    { maskedNewEmail: 'new@example.com' },
    { token: 'secret' },
    { newEmail: 'private@example.com' },
    { expiresAt: '2026-11-21T01:00:00Z' },
  ])
    assert.throws(() => decodePendingEmail({ ...pending, ...patch }));
});
test('202 null is generic; request waits beyond 10.5 seconds and never auto-retries', async () => {
  const env = await integration();
  try {
    let finish!: (r: Response) => void;
    env.respond(async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body as string), {
        newEmail: 'new@example.com',
        currentPassword: 'proof',
      });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const api = createEmailChangeApi(env.data.api, env.identity);
    const request = api.request(
      { newEmail: 'new@example.com', currentPassword: 'proof' },
      'old@example.com',
      signal(),
    );
    await flush();
    env.time.advance(10_500);
    await flush();
    finish(
      json(
        { success: true, statusCode: 202, message: 'generic', data: null },
        202,
      ),
    );
    assert.equal(await request, null);
    assert.equal(
      env.requests.filter(({ url }) =>
        url.endsWith('/auth/email-change/request'),
      ).length,
      1,
    );
  } finally {
    env.dispose();
  }
});
test('INVALID_GOOGLE_CREDENTIAL preserves session only on email request; JWT 401 signs out', async () => {
  const env = await integration();
  try {
    const api = createEmailChangeApi(env.data.api, env.identity);
    env.respond(async () => failure('INVALID_GOOGLE_CREDENTIAL'));
    await assert.rejects(() =>
      api.request(
        { newEmail: 'new@example.com', googleCredential: 'fresh' },
        'old@example.com',
        signal(),
      ),
    );
    assert.equal(env.manager.getSnapshot().status, 'authenticated');
    await assert.rejects(() => env.data.api.json('/users/me', (v) => v));
    assert.equal(env.manager.getSnapshot().status, 'unauthenticated');
  } finally {
    env.dispose();
  }
});
test('normal unauthorized request and stale A responses cannot retain protected cache in B', async () => {
  const env = await integration();
  try {
    let finish!: (r: Response) => void;
    env.respond(
      async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = createEmailChangeApi(env.data.api, env.identity)
      .pending(signal())
      .catch(() => null);
    await flush();
    await env.manager.establishSession(loginResponse(USER_B));
    finish(ok(null));
    await pending;
    const state = env.manager.getSnapshot();
    assert.equal(state.status, 'authenticated');
    if (state.status === 'authenticated') assert.equal(state.user.id, USER_B);
    env.respond(async () => failure('UNAUTHORIZED'));
    const identity = env.data.getIdentity()!;
    await assert.rejects(() =>
      createEmailChangeApi(env.data.api, identity).request(
        { newEmail: 'new@example.com', currentPassword: 'x' },
        'old@example.com',
        signal(),
      ),
    );
    assert.equal(env.manager.getSnapshot().status, 'unauthenticated');
  } finally {
    env.dispose();
  }
});
test('fresh Google action resets provider, obtains new proof and never performs login exchange', async () => {
  const calls: string[] = [];
  const payload = btoa(
    JSON.stringify({ aud: 'web-client', iss: 'https://accounts.google.com' }),
  ).replace(/=/g, '');
  const provider = {
    webClientId: 'web-client',
    reset: async () => {
      calls.push('reset');
    },
    requestIdToken: async () => {
      calls.push('fresh');
      return { kind: 'token' as const, idToken: `a.${payload}.b` };
    },
  };
  const token = await freshGoogleProof(provider, () => {});
  assert.match(token, /^a\./);
  assert.deepEqual(calls, ['reset', 'fresh', 'reset']);
});
