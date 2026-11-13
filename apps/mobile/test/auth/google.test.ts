import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { createAuthApi } from '../../src/features/auth/api.ts';
import { parseGoogleConfig } from '../../src/features/auth/google-config.ts';
import {
  hasIntendedAudience,
  signInWithGoogle,
  type GoogleIdentityProvider,
  type GoogleProviderResult,
} from '../../src/features/auth/google-identity.ts';
import type {
  EstablishResult,
  LoginResponseLike,
} from '../../src/infrastructure/auth/session-manager.ts';
import { deferred, loginResponse, USER_A, user } from './support.ts';

const WEB = '123456789012-webclient.apps.googleusercontent.com';
const IOS = '123456789012-iosclient.apps.googleusercontent.com';
const ANDROID = '123456789012-androidclient.apps.googleusercontent.com';

function b64(value: string) {
  return Buffer.from(value).toString('base64url');
}
/** Unsigned stand-in for a Google ID token: only the claims shape matters here. */
function idToken(claims: Record<string, unknown>) {
  return [
    b64(JSON.stringify({ alg: 'RS256', kid: 'k' })),
    b64(JSON.stringify(claims)),
    b64('signature'),
  ].join('.');
}
const GOOD = idToken({
  aud: WEB,
  azp: ANDROID,
  iss: 'https://accounts.google.com',
  sub: '1234567890',
  email: 'émile@example.test',
  name: 'Émile Zoë',
});

test('public Google config: web client is the audience, iOS needs its own client', () => {
  assert.deepEqual(parseGoogleConfig({ webClientId: ` ${WEB} ` }, 'android'), {
    webClientId: WEB,
  });
  assert.deepEqual(
    parseGoogleConfig({ webClientId: WEB, iosClientId: IOS }, 'ios'),
    { webClientId: WEB, iosClientId: IOS },
  );
  for (const [env, platform] of [
    [{}, 'android'],
    [{ webClientId: '' }, 'android'],
    [{ webClientId: 'not-a-client-id' }, 'android'],
    [{ webClientId: `${WEB}.evil.test` }, 'android'],
    [{ webClientId: 'GOCSPX-secret-looking-value' }, 'android'],
    [{ webClientId: WEB }, 'ios'],
    [{ webClientId: WEB, iosClientId: WEB }, 'ios'],
    [{ webClientId: WEB, iosClientId: 'bad' }, 'ios'],
    [{ webClientId: WEB, iosClientId: IOS }, 'web'],
  ] as const)
    assert.equal(parseGoogleConfig(env, platform), null, JSON.stringify(env));
});

test('audience pre-check accepts only the backend Web client and Google issuer', () => {
  assert.equal(hasIntendedAudience(GOOD, WEB), true);
  assert.equal(
    hasIntendedAudience(idToken({ aud: WEB, iss: 'accounts.google.com' }), WEB),
    true,
  );
  for (const token of [
    idToken({ aud: ANDROID, iss: 'https://accounts.google.com' }),
    idToken({ aud: IOS, iss: 'https://accounts.google.com' }),
    idToken({ aud: [WEB], iss: 'https://accounts.google.com' }),
    idToken({ aud: WEB, iss: 'https://evil.example' }),
    idToken({ aud: WEB }),
    `${GOOD}.extra`,
    'a.b',
    'not a token',
    'a.%%%.c',
    `${b64('{}')}.${b64('null')}.${b64('s')}`,
    `${b64('{}')}.${b64('[')}.${b64('s')}`,
    idToken({ aud: WEB, iss: 'accounts.google.com', pad: 'x'.repeat(8200) }),
  ])
    assert.equal(hasIntendedAudience(token, WEB), false, token.slice(0, 40));
});

class FakeProvider implements GoogleIdentityProvider {
  readonly webClientId = WEB;
  requests = 0;
  resets = 0;
  next = deferred<GoogleProviderResult>();
  requestIdToken() {
    this.requests++;
    return this.next.promise;
  }
  async reset() {
    this.resets++;
  }
}
function harness() {
  const provider = new FakeProvider();
  const exchanged: string[] = [];
  const established: LoginResponseLike[] = [];
  let exchangeResult: () => Promise<LoginResponseLike> = async () =>
    loginResponse(USER_A);
  let establishResult: () => Promise<EstablishResult> = async () => ({
    ok: true,
    user: user(USER_A),
    persisted: true,
  });
  const controller = new AbortController();
  let generation = 1;
  const current = () => !controller.signal.aborted && generation === 1;
  const run = () =>
    signInWithGoogle(
      {
        provider,
        exchange: (credential, signal) => {
          assert.equal(signal, controller.signal);
          exchanged.push(credential);
          return exchangeResult();
        },
        establish: (response, signal) => {
          assert.equal(signal, controller.signal);
          established.push(response);
          return establishResult();
        },
      },
      controller.signal,
      current,
    );
  return {
    provider,
    exchanged,
    established,
    controller,
    run,
    bump: () => generation++,
    setExchange: (fn: typeof exchangeResult) => (exchangeResult = fn),
    setEstablish: (fn: typeof establishResult) => (establishResult = fn),
  };
}

test('success sends exactly the Google ID token and hands the Kanvexa login to MOB-05', async () => {
  const h = harness();
  const pending = h.run();
  h.provider.next.resolve({ kind: 'token', idToken: GOOD });
  assert.deepEqual(await pending, { kind: 'signed-in' });
  assert.deepEqual(h.exchanged, [GOOD]);
  assert.equal(h.established.length, 1);
  assert.equal(
    h.established[0]!.accessToken,
    loginResponse(USER_A).accessToken,
  );
  assert.notEqual(h.established[0]!.accessToken, GOOD);
  assert.equal(h.provider.resets, 1, 'SDK sign-in is forgotten afterwards');
});

test('cancel, busy, Play services and SDK failure never call the backend', async () => {
  for (const [result, expected] of [
    [{ kind: 'cancelled' }, { kind: 'cancelled' }],
    [{ kind: 'busy' }, { kind: 'provider', reason: 'busy' }],
    [{ kind: 'play-services' }, { kind: 'provider', reason: 'play-services' }],
    [{ kind: 'failed' }, { kind: 'provider', reason: 'failed' }],
  ] as const) {
    const h = harness();
    const pending = h.run();
    h.provider.next.resolve(result);
    assert.deepEqual(await pending, expected);
    assert.deepEqual(h.exchanged, []);
    assert.equal(h.provider.resets, 1);
  }
});

test('a token minted for a native client audience is not sent to the backend', async () => {
  const h = harness();
  const pending = h.run();
  h.provider.next.resolve({
    kind: 'token',
    idToken: idToken({ aud: ANDROID, iss: 'https://accounts.google.com' }),
  });
  assert.deepEqual(await pending, { kind: 'provider', reason: 'audience' });
  assert.deepEqual(h.exchanged, []);
});

test('provider exceptions still reset the SDK and propagate', async () => {
  const h = harness();
  h.provider.requestIdToken = async () => {
    throw new Error('native crash');
  };
  const pending = h.run();
  await assert.rejects(pending, /native crash/);
  assert.equal(h.provider.resets, 1);
});

test('late Google result after cancel or account change is discarded unsent', async () => {
  for (const interrupt of ['abort', 'generation'] as const) {
    const h = harness();
    const pending = h.run();
    if (interrupt === 'abort') h.controller.abort();
    else h.bump();
    h.provider.next.resolve({ kind: 'token', idToken: GOOD });
    assert.deepEqual(await pending, { kind: 'stale' });
    assert.deepEqual(h.exchanged, []);
    assert.deepEqual(h.established, []);
  }
});

test('an already stale attempt never opens the Google prompt', async () => {
  const h = harness();
  h.controller.abort();
  assert.deepEqual(await h.run(), { kind: 'stale' });
  assert.equal(h.provider.requests, 0);
});

test('late backend response after sign-out/account switch does not establish a session', async () => {
  const h = harness();
  const exchange = deferred<LoginResponseLike>();
  h.setExchange(() => exchange.promise);
  const pending = h.run();
  h.provider.next.resolve({ kind: 'token', idToken: GOOD });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.exchanged.length, 1);
  h.bump();
  exchange.resolve(loginResponse(USER_A));
  assert.deepEqual(await pending, { kind: 'stale' });
  assert.deepEqual(h.established, []);
});

test('backend errors propagate as ApiError; session failures are reported', async () => {
  const h = harness();
  h.setExchange(async () => {
    throw new ApiError('http', { status: 409, code: 'ACCOUNT_LINK_REQUIRED' });
  });
  const pending = h.run();
  h.provider.next.resolve({ kind: 'token', idToken: GOOD });
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'ACCOUNT_LINK_REQUIRED');
    return true;
  });
  assert.deepEqual(h.established, []);

  for (const [reason, expected] of [
    ['unavailable', { kind: 'session', reason: 'unavailable' }],
    ['rejected', { kind: 'session', reason: 'rejected' }],
    ['invalid-response', { kind: 'session', reason: 'invalid-response' }],
    ['superseded', { kind: 'stale' }],
  ] as const) {
    const next = harness();
    next.setEstablish(async () => ({ ok: false, reason }));
    const run = next.run();
    next.provider.next.resolve({ kind: 'token', idToken: GOOD });
    assert.deepEqual(await run, expected);
  }
});

function googleHttp(
  respond: (body: unknown) => { status: number; payload: unknown },
) {
  const calls: { path: string; body: unknown; auth?: string }[] = [];
  const http = createHttpClient({
    baseUrl: new URL('https://api.example.test/api'),
    fetch: async (input, init) => {
      const body = JSON.parse(init!.body as string);
      calls.push({
        path: new URL(String(input)).pathname,
        body,
        auth: (init!.headers as Record<string, string>).Authorization,
      });
      const { status, payload } = respond(body);
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { api: createAuthApi(http), calls };
}

test('POST /auth/google sends {credential} without bearer and decodes the 200 envelope', async () => {
  const { api, calls } = googleHttp(() => ({
    status: 200,
    payload: {
      success: true,
      statusCode: 200,
      message: 'Logged in',
      data: { ...loginResponse(USER_A), user: user(USER_A) },
    },
  }));
  const response = await api.google(GOOD, new AbortController().signal);
  assert.deepEqual(calls, [
    { path: '/api/auth/google', body: { credential: GOOD }, auth: undefined },
  ]);
  assert.equal(response.tokenType, 'Bearer');
  assert.equal((response.user as { id: string }).id, USER_A);
});

test('POST /auth/google rejects malformed logins and maps backend error families', async () => {
  for (const data of [
    { ...loginResponse(USER_A), tokenType: 'Google', user: user(USER_A) },
    { ...loginResponse(USER_A), expiresIn: 0, user: user(USER_A) },
    { ...loginResponse(USER_A), accessToken: '', user: user(USER_A) },
    { ...loginResponse(USER_A), user: { id: 'nope' } },
    null,
  ]) {
    const { api } = googleHttp(() => ({
      status: 200,
      payload: { success: true, statusCode: 200, message: 'OK', data },
    }));
    await assert.rejects(api.google(GOOD, new AbortController().signal), {
      kind: 'invalid-response',
    });
  }
  for (const [status, code] of [
    [401, 'INVALID_GOOGLE_CREDENTIAL'],
    [403, 'EMAIL_NOT_VERIFIED'],
    [409, 'ACCOUNT_LINK_REQUIRED'],
    [429, 'TOO_MANY_REQUESTS'],
    [503, 'GOOGLE_AUTH_UNAVAILABLE'],
  ] as const) {
    const { api, calls } = googleHttp(() => ({
      status,
      payload: {
        success: false,
        statusCode: status,
        code,
        message: 'Server says no',
      },
    }));
    await assert.rejects(
      api.google(GOOD, new AbortController().signal),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === status &&
        error.code === code,
    );
    assert.equal(calls.length, 1, `${status} is never retried`);
  }
});
