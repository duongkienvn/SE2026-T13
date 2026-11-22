import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  changePasswordBody,
  changePasswordError,
  createSecurityApi,
  googleLinkBody,
  googleLinkError,
  isAmbiguous,
  linkedProvidersKey,
  passwordDraftErrors,
} from '../../src/features/security/api.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { USER_A, USER_B, flush, loginResponse } from '../auth/support.ts';
import {
  destinationPath,
  parseLink,
  parsePath,
} from '../../src/navigation/routes.ts';

const signal = () => new AbortController().signal;
type Handler = (url: string, init: RequestInit) => Promise<Response> | null;
const route =
  (path: string, make: () => Response | Promise<Response>): Handler =>
  (url) =>
    url.endsWith(path) ? Promise.resolve(make()) : null;
const noContent = () => new Response(null, { status: 204 });
const failure = (status: number, code: string) =>
  json(
    { success: false, statusCode: status, code, message: 'Private failure' },
    status,
  );
const draft = (newPassword: string, currentPassword = 'Current#1') => ({
  currentPassword,
  newPassword,
  confirmation: newPassword,
});

test('new password policy matches NewPasswordField: 8–128 code points, A–Z, 0–9, punctuation/symbol', () => {
  const valid = ['AAAAAA1!', 'A1!' + 'x'.repeat(125), 'NOLOWER1€', 'Aa1 😀xyz'];
  for (const value of valid)
    assert.deepEqual(passwordDraftErrors(draft(value)), {}, value);
  const invalid = [
    'AAAAA1!', // 7
    'A1!' + 'x'.repeat(126), // 129
    'aaaaaa1!', // no ASCII uppercase
    'ÄAAAAAA!', // no digit
    'AAAAAA12', // no symbol
    'AAAAA1  ', // whitespace is not special
    'ÀÀÀÀÀ1!x', // non-ASCII uppercase only
  ];
  for (const value of invalid)
    assert.ok(passwordDraftErrors(draft(value)).newPassword, value);
  // Code points, like class-validator: 8 emoji-bearing characters pass length.
  assert.deepEqual(passwordDraftErrors(draft('A1😀😀😀😀😀😀')), {});
});

test('confirmation, current password and reuse are validated before any request', () => {
  assert.equal(
    passwordDraftErrors({
      currentPassword: 'Current#1',
      newPassword: 'Newpass#1',
      confirmation: 'Newpass#2',
    }).confirmation,
    'Passwords must match.',
  );
  assert.ok(passwordDraftErrors(draft('Newpass#1', '')).currentPassword);
  assert.ok(
    passwordDraftErrors(draft('Newpass#1', 'x'.repeat(129))).currentPassword,
  );
  assert.ok(passwordDraftErrors(draft('Same#Pass1', 'Same#Pass1')).newPassword);
});

test('request body is exact: no confirmation, no trimming, rejects invalid drafts locally', () => {
  assert.deepEqual(
    changePasswordBody({
      currentPassword: '  spaced current ',
      newPassword: ' New#pass1 ',
      confirmation: ' New#pass1 ',
    }),
    { currentPassword: '  spaced current ', newPassword: ' New#pass1 ' },
  );
  assert.throws(
    () => changePasswordBody(draft('weak')),
    (error) =>
      error instanceof ApiError &&
      error.status === 400 &&
      error.requestStarted === false,
  );
  assert.deepEqual(googleLinkBody('id.token.sig', 'pw'), {
    credential: 'id.token.sig',
    password: 'pw',
  });
  for (const [credential, password] of [
    ['', 'pw'],
    ['x'.repeat(8193), 'pw'],
    ['token', ''],
    ['token', 'x'.repeat(129)],
  ])
    assert.throws(() => googleLinkBody(credential, password));
});

test('change password sends exact authenticated POST and decodes only 204 as success', async () => {
  const env = await integration();
  try {
    const seen: { url: string; init: RequestInit }[] = [];
    env.respond((url, init) => {
      if (!url.endsWith('/auth/change-password')) return null;
      seen.push({ url, init });
      return Promise.resolve(noContent());
    });
    const api = createSecurityApi(env.data.api, env.identity);
    await api.changePassword(
      {
        currentPassword: 'Old#pass1',
        newPassword: 'New#pass1',
        confirmation: 'New#pass1',
      },
      signal(),
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.init.method, 'POST');
    assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), {
      currentPassword: 'Old#pass1',
      newPassword: 'New#pass1',
    });
    assert.match(
      String(new Headers(seen[0]!.init.headers).get('authorization')),
      /^Bearer /,
    );
    assert.ok(!/Old#|New#|pass1/.test(seen[0]!.url));
    // A JSON body where 204 is required is not a credential rotation.
    env.respond(route('/auth/change-password', () => ok(null)));
    await assert.rejects(
      () => api.changePassword(draft('New#pass1', 'Old#pass1'), signal()),
      (error) => error instanceof ApiError && isAmbiguous(error),
    );
    // The transport does not end the session; the 204 handler does.
    assert.equal(env.manager.getSnapshot().status, 'authenticated');
  } finally {
    env.dispose();
  }
});

test('403 wrong current password and recovery-required keep the session; JWT 401 ends it', async () => {
  const env = await integration();
  try {
    const api = createSecurityApi(env.data.api, env.identity);
    for (const code of [
      'CURRENT_PASSWORD_INCORRECT',
      'PASSWORD_RECOVERY_REQUIRED',
    ]) {
      env.respond(route('/auth/change-password', () => failure(403, code)));
      await assert.rejects(
        () => api.changePassword(draft('New#pass1'), signal()),
        (error) => error instanceof ApiError && error.code === code,
      );
      assert.equal(env.manager.getSnapshot().status, 'authenticated');
    }
    env.respond(
      route('/auth/change-password', () => failure(401, 'UNAUTHORIZED')),
    );
    await assert.rejects(() =>
      api.changePassword(draft('New#pass1'), signal()),
    );
    await flush();
    assert.equal(env.manager.getSnapshot().status, 'unauthenticated');
  } finally {
    env.dispose();
  }
});

test('Google link: proof-specific 401 keeps the session, ordinary 401 ends it, 204 never rotates', async () => {
  const env = await integration();
  try {
    let body: unknown;
    env.respond((url, init) => {
      if (!url.endsWith('/auth/google/link')) return null;
      body = JSON.parse(String(init.body));
      return Promise.resolve(noContent());
    });
    const api = createSecurityApi(env.data.api, env.identity);
    const before = env.manager.getSnapshot();
    await api.linkGoogle('fresh.id.token', 'Current#1', signal());
    assert.deepEqual(body, {
      credential: 'fresh.id.token',
      password: 'Current#1',
    });
    const after = env.manager.getSnapshot();
    assert.equal(after.status, 'authenticated');
    assert.equal(after.generation, before.generation);
    env.respond(
      route('/auth/google/link', () =>
        failure(401, 'INVALID_GOOGLE_CREDENTIAL'),
      ),
    );
    await assert.rejects(() =>
      api.linkGoogle('bad.proof', 'Current#1', signal()),
    );
    await flush();
    assert.equal(env.manager.getSnapshot().status, 'authenticated');
    // The exemption is path-specific: a Google-proof code elsewhere still signs out.
    env.respond(
      route('/auth/change-password', () =>
        failure(401, 'INVALID_GOOGLE_CREDENTIAL'),
      ),
    );
    await assert.rejects(() =>
      api.changePassword(draft('New#pass1'), signal()),
    );
    await flush();
    assert.equal(env.manager.getSnapshot().status, 'unauthenticated');
  } finally {
    env.dispose();
  }
});

test('Google link: ordinary JWT 401 ends the session', async () => {
  const env = await integration();
  try {
    env.respond(route('/auth/google/link', () => failure(401, 'UNAUTHORIZED')));
    await assert.rejects(() =>
      createSecurityApi(env.data.api, env.identity).linkGoogle(
        't',
        'p',
        signal(),
      ),
    );
    await flush();
    assert.equal(env.manager.getSnapshot().status, 'unauthenticated');
  } finally {
    env.dispose();
  }
});

test('a late 204 for User A is rejected as session-changed after switching to User B', async () => {
  const env = await integration();
  try {
    let finish!: (response: Response) => void;
    env.respond(
      route(
        '/auth/change-password',
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const identityA = env.identity;
    const pending = createSecurityApi(env.data.api, identityA)
      .changePassword(draft('New#pass1'), signal())
      .then(
        () => 'ok',
        (error: ApiError) => error.kind,
      );
    await flush();
    await env.manager.establishSession(loginResponse(USER_B));
    finish(noContent());
    assert.notEqual(await pending, 'ok');
    // The generation fence: A's invalidation cannot end B's session.
    assert.equal(
      env.manager.handleSecurityInvalidation(identityA.generation),
      false,
    );
    const state = env.manager.getSnapshot();
    assert.equal(state.status, 'authenticated');
    if (state.status === 'authenticated') assert.equal(state.user.id, USER_B);
  } finally {
    env.dispose();
  }
});

test('providers decode strictly and key holds no secrets', async () => {
  const env = await integration();
  try {
    env.respond(
      route('/auth/linked-providers', () =>
        ok({ googleLinked: true, hasPassword: false }),
      ),
    );
    const api = createSecurityApi(env.data.api, env.identity);
    assert.deepEqual(await api.providers(signal()), {
      googleLinked: true,
      hasPassword: false,
    });
    env.respond(
      route('/auth/linked-providers', () =>
        ok({ googleLinked: true, hasPassword: false, sub: 'google-sub' }),
      ),
    );
    await assert.rejects(() => api.providers(signal()));
    const key = JSON.stringify(linkedProvidersKey(env.identity));
    assert.ok(key.includes(USER_A) && !/token|pass/i.test(key));
  } finally {
    env.dispose();
  }
});

test('error copy is distinct, generic and never echoes server text', () => {
  const http = (status: number, code?: string) =>
    new ApiError('http', { status, code, message: 'SECRET server text' });
  const change = [
    http(403, 'CURRENT_PASSWORD_INCORRECT'),
    http(403, 'PASSWORD_RECOVERY_REQUIRED'),
    http(400, 'PASSWORD_REUSED'),
    http(400),
    http(429),
    new ApiError('offline'),
    new ApiError('timeout', { requestStarted: true }),
  ].map(changePasswordError);
  assert.equal(new Set(change).size, change.length);
  assert.match(change[0]!, /incorrect.*still active/);
  assert.match(change[6]!, /could not confirm/i);
  const link = [
    new ApiError('http', { code: 'GOOGLE_CANCELLED', requestStarted: false }),
    new ApiError('http', { code: 'GOOGLE_BUSY', requestStarted: false }),
    new ApiError('http', {
      code: 'GOOGLE_PLAY_SERVICES',
      requestStarted: false,
    }),
    new ApiError('http', { code: 'INVALID_GOOGLE_CREDENTIAL', status: 401 }),
    http(409, 'GOOGLE_ACCOUNT_CONFLICT'),
    http(403, 'INVALID_CREDENTIALS'),
    http(429),
    http(503, 'GOOGLE_AUTH_UNAVAILABLE'),
    new ApiError('offline'),
  ].map(googleLinkError);
  assert.equal(new Set(link).size, link.length);
  for (const message of [...change, ...link])
    assert.ok(!message.includes('SECRET'));
  // A canceled Google sheet was never sent: not ambiguous.
  assert.equal(
    isAmbiguous(
      new ApiError('http', { code: 'GOOGLE_CANCELLED', requestStarted: false }),
    ),
    false,
  );
  assert.equal(
    isAmbiguous(new ApiError('timeout', { requestStarted: false })),
    false,
  );
});

test('security routes are exact private screens; no token or provider deep-link handler', () => {
  for (const screen of ['security', 'connected-accounts'] as const) {
    const target = parsePath(`/${screen}`);
    assert.deepEqual(target, { kind: 'screen', screen });
    assert.equal(destinationPath(target!), `/${screen}`);
    assert.equal(parsePath(`/${screen}/google`), null);
    assert.equal(parsePath(`/${screen}?credential=x`), null);
  }
  for (const path of ['/two-factor', '/sessions', '/login-activity', '/unlink'])
    assert.equal(parsePath(path), null);
  assert.equal(
    parseLink('https://kanvexa.tech/connected-accounts?credential=token'),
    null,
  );
});
