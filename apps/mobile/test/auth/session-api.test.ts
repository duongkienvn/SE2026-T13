import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFetchSessionApi,
  parseApiBaseUrl,
} from '../../src/infrastructure/auth/session-api.ts';
import { FakeTime, USER_A } from './support.ts';

const me = {
  success: true,
  statusCode: 200,
  message: 'OK',
  data: {
    id: USER_A.toUpperCase(),
    email: 'a@example.test',
    displayName: 'Ada',
    avatarUrl: null,
    avatarRevision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(respond: (url: string, init: RequestInit) => Promise<Response>) {
  const time = new FakeTime();
  const requests: { url: string; init: RequestInit }[] = [];
  const api = createFetchSessionApi({
    baseUrl: new URL('https://api.kanvexa.test/api/'),
    timers: time,
    fetch: ((url: string, init: RequestInit) => {
      requests.push({ url, init });
      return respond(url, init);
    }) as typeof fetch,
  });
  return { api, requests, time };
}

test('verify calls GET /users/me with the bearer and keeps identity fields only', async () => {
  const { api, requests } = setup(async () => json(me));
  assert.deepEqual(await api.verify('tok'), {
    kind: 'verified',
    user: {
      id: USER_A,
      email: 'a@example.test',
      displayName: 'Ada',
      avatarUrl: null,
    },
  });
  assert.equal(requests[0]!.url, 'https://api.kanvexa.test/api/users/me');
  assert.equal(requests[0]!.init.method, 'GET');
  assert.deepEqual(requests[0]!.init.headers, {
    Accept: 'application/json',
    Authorization: 'Bearer tok',
  });
});

test('only 401 means unauthorized; other failures are unavailable', async () => {
  const cases: [Response | Error, unknown][] = [
    [json({ success: false }, 401), { kind: 'unauthorized' }],
    [json({ success: false }, 403), { kind: 'unavailable', reason: 'server' }],
    [json({ success: false }, 404), { kind: 'unavailable', reason: 'server' }],
    [json({ success: false }, 429), { kind: 'unavailable', reason: 'server' }],
    [json({ success: false }, 503), { kind: 'unavailable', reason: 'server' }],
    [
      new Response('<html>', { status: 200 }),
      { kind: 'unavailable', reason: 'server' },
    ],
    [
      new Response(null, { status: 204 }),
      { kind: 'unavailable', reason: 'server' },
    ],
    [
      json({ ...me, success: false }),
      { kind: 'unavailable', reason: 'server' },
    ],
    [
      json({ ...me, data: { ...me.data, id: 'nope' } }),
      { kind: 'unavailable', reason: 'server' },
    ],
    [
      json({ ...me, data: { ...me.data, isDeleted: true } }),
      { kind: 'unavailable', reason: 'server' },
    ],
    [
      new TypeError('Network request failed'),
      { kind: 'unavailable', reason: 'network' },
    ],
  ];
  for (const [outcome, expected] of cases) {
    const { api } = setup(async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    });
    assert.deepEqual(await api.verify('tok'), expected);
  }
});

test('verify times out through the injected timer and aborts fetch', async () => {
  let signal: AbortSignal | undefined;
  const { api, time } = setup(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const pending = api.verify('tok');
  time.advance(15_000);
  assert.deepEqual(await pending, { kind: 'unavailable', reason: 'timeout' });
  assert.equal(signal?.aborted, true);
  assert.equal(time.timerCount, 0);
});

test('logout posts once and never throws', async () => {
  const ok = setup(async () => new Response(null, { status: 204 }));
  assert.equal(await ok.api.logout('tok'), true);
  assert.equal(ok.requests[0]!.url, 'https://api.kanvexa.test/api/auth/logout');
  assert.equal(ok.requests[0]!.init.method, 'POST');

  const offline = setup(async () => {
    throw new TypeError('offline');
  });
  assert.equal(await offline.api.logout('tok'), false);
  const rejected = setup(async () => json({ success: false }, 401));
  assert.equal(await rejected.api.logout('tok'), false);
});

test('base URL requires HTTPS outside local development hosts', () => {
  assert.equal(
    parseApiBaseUrl('https://kanvexa.tech/api', false)?.href,
    'https://kanvexa.tech/api',
  );
  assert.equal(parseApiBaseUrl('http://kanvexa.tech/api', true), null);
  assert.equal(parseApiBaseUrl('http://10.0.2.2:3000/api', false), null);
  for (const local of [
    'http://10.0.2.2:3000/api',
    'http://localhost:3000/api',
    'http://192.168.1.20:3000/api',
    'http://172.20.0.5:3000/api',
  ])
    assert.ok(parseApiBaseUrl(local, true), local);
  for (const bad of [
    undefined,
    '',
    'not a url',
    'ftp://kanvexa.tech',
    'https://user:pw@kanvexa.tech/api',
    'https://kanvexa.tech/api?token=x',
    'http://172.40.0.5/api',
  ])
    assert.equal(parseApiBaseUrl(bad, true), null, String(bad));
});
