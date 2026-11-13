import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthApi } from '../../src/features/auth/api.ts';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { FakeTime } from './support.ts';

test('auth errors retain status/code and Retry-After without replaying public POSTs', async () => {
  for (const [status, code] of [
    [401, 'INVALID_CREDENTIALS'],
    [403, 'EMAIL_NOT_VERIFIED'],
    [409, 'EMAIL_ALREADY_EXISTS'],
    [429, 'TOO_MANY_REQUESTS'],
    [503, 'MAIL_DELIVERY_UNAVAILABLE'],
  ] as const) {
    let calls = 0;
    const api = createAuthApi(
      createHttpClient({
        baseUrl: new URL('https://api.example.test/api'),
        fetch: async () => {
          calls++;
          return new Response(
            JSON.stringify({
              success: false,
              statusCode: status,
              code,
              message: 'safe',
            }),
            {
              status,
              headers: {
                'content-type': 'application/json',
                'retry-after': '120',
              },
            },
          );
        },
      }),
    );
    await assert.rejects(
      api.login('user@example.test', 'secret', new AbortController().signal),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === status &&
        error.code === code &&
        error.retryAfterMs === 120_000,
    );
    assert.equal(calls, 1);
  }
});
test('auth adapters enforce endpoint-specific response status and payloads', async () => {
  for (const status of [200, 201, 202, 204]) {
    const api = createAuthApi(
      createHttpClient({
        baseUrl: new URL('https://api.example.test/api'),
        fetch: async () =>
          new Response(
            status === 204
              ? null
              : JSON.stringify({
                  success: true,
                  statusCode: status,
                  message: 'OK',
                  data: null,
                }),
            { status, headers: { 'content-type': 'application/json' } },
          ),
      }),
    );
    await assert.rejects(
      api.register(
        'User',
        'user@example.test',
        'Password1!',
        new AbortController().signal,
      ),
      { kind: 'invalid-response' },
    );
    if (status !== 202)
      await assert.rejects(
        api.forgot('user@example.test', new AbortController().signal),
        { kind: 'invalid-response' },
      );
    if (status !== 204)
      await assert.rejects(
        api.verify('a'.repeat(43), new AbortController().signal),
        { kind: 'invalid-response' },
      );
    await assert.rejects(
      api.login('user@example.test', 'secret', new AbortController().signal),
      { kind: 'invalid-response' },
    );
  }
});
test('offline, timeout and abort settle public auth without leaking native errors', async () => {
  const time = new FakeTime();
  const api = createAuthApi(
    createHttpClient({
      baseUrl: new URL('https://api.example.test/api'),
      timers: time,
      fetch: () => new Promise(() => {}),
    }),
  );
  const controller = new AbortController();
  const aborted = api.reset('a'.repeat(43), 'Password1!', controller.signal);
  const rejection = assert.rejects(aborted, { kind: 'aborted' });
  controller.abort();
  await rejection;
  const timeout = api.forgot('user@example.test', new AbortController().signal);
  const expired = assert.rejects(timeout, { kind: 'timeout' });
  time.advance(45_000);
  await expired;
  const offline = createAuthApi(
    createHttpClient({
      baseUrl: new URL('https://api.example.test/api'),
      fetch: () => {
        throw new Error('raw secret');
      },
      isOnline: () => false,
    }),
  );
  await assert.rejects(
    offline.login('user@example.test', 'secret', new AbortController().signal),
    { kind: 'offline' },
  );
  const native = createAuthApi(
    createHttpClient({
      baseUrl: new URL('https://api.example.test/api'),
      fetch: () => {
        throw new Error('raw secret');
      },
    }),
  );
  await assert.rejects(
    native.login('user@example.test', 'secret', new AbortController().signal),
    (error: unknown) =>
      error instanceof ApiError &&
      error.kind === 'network' &&
      !JSON.stringify(error).includes('raw secret'),
  );
});
