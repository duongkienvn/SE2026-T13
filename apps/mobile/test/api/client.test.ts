import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { FakeTime, deferred, flush } from '../auth/support.ts';

export function json(value: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
export function ok(data: unknown, extra = {}) {
  return json({
    success: true,
    statusCode: 200,
    message: 'OK',
    data,
    ...extra,
  });
}
const identity = (value: unknown) => value;
function setup(
  respond: (url: string, init: RequestInit) => Promise<Response>,
  online = true,
) {
  const time = new FakeTime();
  const requests: { url: string; init: RequestInit }[] = [];
  const client = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    timers: time,
    clock: time,
    isOnline: () => online,
    fetch: ((url: string, init: RequestInit) => {
      requests.push({ url, init });
      return respond(url, init);
    }) as typeof fetch,
  });
  return { client, requests, time };
}
const failure = (kind: string, status?: number) => (error: unknown) =>
  error instanceof ApiError &&
  error.kind === kind &&
  (status === undefined || error.status === status);

test('wrapped JSON preserves typed data and page/cursor metadata; request headers and JSON serialization', async () => {
  const { client, requests } = setup(async () =>
    ok([1], { meta: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
  );
  const page = await client.envelope(
    '/items',
    (value) => {
      assert.ok(Array.isArray(value));
      return value as number[];
    },
    {
      method: 'PATCH',
      body: { title: 'a' },
      accessToken: 'token',
      headers: { 'Idempotency-Key': 'test-key' },
    },
  );
  assert.deepEqual(page.data, [1]);
  assert.equal(page.meta?.limit, 20);
  assert.deepEqual(requests[0]?.init.headers, {
    Accept: 'application/json',
    Authorization: 'Bearer token',
    'Content-Type': 'application/json',
    'Idempotency-Key': 'test-key',
  });
  assert.equal(requests[0]?.init.body, '{"title":"a"}');
  assert.equal(requests[0]?.init.credentials, 'omit');
  const cursor = setup(async () =>
    ok([], { meta: { limit: 20, nextCursor: 'opaque/+' } }),
  );
  assert.deepEqual((await cursor.client.envelope('/items', identity)).meta, {
    limit: 20,
    nextCursor: 'opaque/+',
  });
});

test('JSON rejects empty, malformed, HTML, wrong envelopes/status and decoder failures', async () => {
  for (const response of [
    new Response(null, { status: 204 }),
    new Response(''),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response('<html>private</html>', {
      headers: { 'content-type': 'text/html' },
    }),
    json({ success: false }),
    json({ data: {} }),
    json({ success: true, statusCode: 201, message: 'OK', data: {} }),
    ok([], { meta: { page: 0 } }),
  ]) {
    const { client } = setup(async () => response);
    await assert.rejects(
      client.json('/items', identity, { method: 'POST' }),
      failure('invalid-response'),
    );
  }
  await assert.rejects(
    setup(async () => ok({})).client.json('/items', () => {
      throw new Error('private decoder data');
    }),
    failure('invalid-response'),
  );
});

test('204 is accepted only through the empty response path', async () => {
  await setup(async () => new Response(null, { status: 204 })).client.empty(
    '/items',
    { method: 'DELETE' },
  );
  await assert.rejects(
    setup(async () => new Response('')).client.empty('/items', {
      method: 'POST',
    }),
    failure('invalid-response', 200),
  );
});

test('raw JSON, text and binary have separate validated paths', async () => {
  assert.deepEqual(
    await setup(async () => json({ status: 'ok' })).client.rawJson(
      '/health',
      identity,
    ),
    { status: 'ok' },
  );
  assert.equal(
    await setup(
      async () =>
        new Response('a,b\n1,2', {
          headers: { 'content-type': 'text/csv; charset=utf-8' },
        }),
    ).client.text('/export', ['text/csv']),
    'a,b\n1,2',
  );
  const bytes = await setup(
    async () =>
      new Response(new Uint8Array([0, 255, 4]), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
  ).client.binary('/download', ['application/octet-stream']);
  assert.deepEqual([...new Uint8Array(bytes.bytes)], [0, 255, 4]);
  const exported = await setup(async () =>
    json({ schemaVersion: 1 }, 200, {
      'content-disposition': 'attachment; filename="account.json"',
    }),
  ).client.binary('/export', ['application/json']);
  assert.ok(exported.bytes.byteLength);
  for (const response of [
    json({ success: false }, 200, {
      'content-disposition': 'attachment; filename="error.json"',
    }),
    json({ schemaVersion: 1 }),
    new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    new Response(null, { status: 204 }),
  ])
    await assert.rejects(
      setup(async () => response).client.binary('/export', [
        'application/json',
      ]),
      failure('invalid-response'),
    );
});

test('HTTP statuses normalize safe error fields and do not expose arbitrary bodies', async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 503]) {
    const { client } = setup(async () =>
      json(
        {
          success: false,
          statusCode: status,
          code: 'VERIFIED_CODE',
          message: 'Safe message',
          details: ['Field invalid'],
          requestId: 'request-1',
          stack: 'secret-stack',
          token: 'private-token',
        },
        status,
      ),
    );
    await assert.rejects(
      client.json('/items', identity, { retries: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, status);
        assert.equal(error.code, 'VERIFIED_CODE');
        assert.deepEqual(error.details, ['Field invalid']);
        assert.equal(error.requestId, 'request-1');
        assert.ok(!JSON.stringify(error).includes('private-token'));
        assert.ok(!JSON.stringify(error).includes('secret-stack'));
        return true;
      },
    );
  }
  await assert.rejects(
    setup(
      async () => new Response('<html>private</html>', { status: 413 }),
    ).client.binary('/export', ['text/csv']),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === 'PAYLOAD_TOO_LARGE' &&
      !error.message.includes('private'),
  );
});

test('native uploads leave multipart boundary ownership to native fetch', async () => {
  const form = new FormData();
  form.append('name', 'file');
  const { client, requests } = setup(async () => ok({}));
  await client.json('/upload', identity, {
    method: 'POST',
    upload: { kind: 'native-upload', createBody: () => form },
  });
  assert.equal(requests[0]?.init.body, form);
  assert.equal(
    (requests[0]?.init.headers as Record<string, string>)['Content-Type'],
    undefined,
  );
});

test('offline and native failures normalize without leaking native messages', async () => {
  const offline = setup(async () => {
    throw new Error('should not run');
  }, false);
  await assert.rejects(
    offline.client.json('/items', identity),
    failure('offline'),
  );
  assert.equal(offline.requests.length, 0);
  await assert.rejects(
    setup(async () => {
      throw new TypeError('private url/token');
    }).client.json('/items', identity, { retries: 0 }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.kind === 'network' &&
      !error.message.includes('token'),
  );
});

test('an interrupted JSON body is a network failure while malformed completed JSON is invalid-response', async () => {
  const response = ok({});
  response.text = async () => {
    throw new TypeError('private interrupted URL');
  };
  await assert.rejects(
    setup(async () => response).client.json('/items', identity, { retries: 0 }),
    failure('network'),
  );
});

test('timeouts include body consumption and settle even when fetch ignores cancellation', async () => {
  const pending = deferred<Response>();
  const { client, time } = setup(() => pending.promise);
  const promise = client.json('/items', identity);
  const assertion = assert.rejects(promise, failure('timeout'));
  await flush();
  time.advance(15_000);
  await assertion;
  pending.resolve(ok({ private: true }));
  await flush();
  assert.equal(time.timerCount, 0);
  const bodyGate = deferred<string>();
  const response = ok({});
  response.text = () => bodyGate.promise;
  const stalled = setup(async () => response);
  const read = stalled.client.json('/items', identity);
  const bodyAssertion = assert.rejects(read, failure('timeout'));
  await flush();
  stalled.time.advance(15_000);
  await bodyAssertion;
  bodyGate.resolve('{}');
});

test('external abort before send and during retry cancels all work', async () => {
  const controller = new AbortController();
  controller.abort();
  const first = setup(async () => ok({}));
  await assert.rejects(
    first.client.json('/items', identity, { signal: controller.signal }),
    failure('aborted'),
  );
  assert.equal(first.requests.length, 0);
  const later = new AbortController();
  const retry = setup(async () => json({}, 503));
  const pending = retry.client.json('/items', identity, {
    signal: later.signal,
  });
  const assertion = assert.rejects(pending, failure('aborted'));
  await flush();
  later.abort();
  await assertion;
  assert.equal(retry.requests.length, 1);
  assert.equal(retry.time.timerCount, 0);
});

test('bounded GET retry honors Retry-After, while unsafe methods never replay', async () => {
  let count = 0;
  const retry = setup(async () =>
    ++count === 1 ? json({}, 429, { 'retry-after': '1' }) : ok('done'),
  );
  const pending = retry.client.json('/items', identity);
  await flush();
  retry.time.advance(999);
  await flush();
  assert.equal(count, 1);
  retry.time.advance(1);
  assert.equal(await pending, 'done');
  assert.equal(count, 2);
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
    const unsafe = setup(async () => json({}, 503));
    await assert.rejects(
      unsafe.client.json('/items', identity, { method, retries: 2 }),
      failure('http', 503),
    );
    assert.equal(unsafe.requests.length, 1);
  }
  for (const policy of ['90', 'invalid-policy']) {
    const limited = setup(async () => json({}, 429, { 'retry-after': policy }));
    await assert.rejects(
      limited.client.json('/items', identity),
      failure('http', 429),
    );
    assert.equal(limited.requests.length, 1);
  }
});

test('transport validates the base URL even if a caller bypasses environment parsing', async () => {
  let calls = 0;
  const client = createHttpClient({
    baseUrl: new URL('http://public.example/api'),
    allowInsecureLocal: true,
    fetch: (async () => {
      calls++;
      return ok({});
    }) as typeof fetch,
  });
  await assert.rejects(
    client.json('/items', identity),
    failure('configuration'),
  );
  assert.equal(calls, 0);
});

test('retry exhaustion is bounded; HTTP-date Retry-After is respected and client errors are not retried', async () => {
  const exhausted = setup(async () => json({}, 503));
  const failed = exhausted.client.json('/items', identity, { retries: 2 });
  const check = assert.rejects(failed, failure('http', 503));
  await flush();
  exhausted.time.advance(250);
  await flush();
  exhausted.time.advance(500);
  await check;
  assert.equal(exhausted.requests.length, 3);
  for (const status of [400, 401, 403, 404, 409, 413]) {
    const context = setup(async () => json({}, status));
    await assert.rejects(
      context.client.json('/items', identity, { retries: 2 }),
      failure('http', status),
    );
    assert.equal(context.requests.length, 1);
  }
  let count = 0;
  const dated = setup(async () =>
    ++count === 1
      ? json({}, 429, {
          'retry-after': new Date(dated.time.now() + 2000).toUTCString(),
        })
      : ok('done'),
  );
  const pending = dated.client.json('/items', identity);
  await flush();
  dated.time.advance(1999);
  await flush();
  assert.equal(count, 1);
  dated.time.advance(1);
  assert.equal(await pending, 'done');
});

test('credentials and private request/response payloads never reach a logger', async () => {
  const captures: unknown[][] = [];
  const spies = (['log', 'info', 'debug', 'warn', 'error'] as const).map(
    (method) =>
      mock.method(console, method, (...args: unknown[]) => {
        captures.push(args);
      }),
  );
  try {
    const context = setup(async () => {
      throw new Error('private-native-body bearer-secret');
    });
    await assert.rejects(
      context.client.json('/items', identity, {
        method: 'POST',
        body: { password: 'private-password' },
        accessToken: 'bearer-secret',
      }),
    );
    const rejected = setup(
      async () => new Response('private-response-body', { status: 500 }),
    );
    await assert.rejects(
      rejected.client.json('/items', identity, { retries: 0 }),
    );
    assert.deepEqual(captures, []);
  } finally {
    for (const spy of spies) spy.mock.restore();
  }
});
