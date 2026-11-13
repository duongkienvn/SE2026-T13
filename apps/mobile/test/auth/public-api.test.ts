import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { createAuthApi, MAIL_TIMEOUT_MS } from '../../src/features/auth/api.ts';
import {
  confirmationError,
  emailError,
  nameError,
  passwordError,
  maskEmail,
} from '../../src/features/auth/validation.ts';
import { FakeTime, user, USER_A, makeJwt } from './support.ts';

const proof = 'a'.repeat(43);
test('public adapters send exact DTO bodies without bearer/cookies and decode 200/201/202/204', async () => {
  const calls: { path: string; body: unknown }[] = [];
  const http = createHttpClient({
    baseUrl: new URL('https://api.example.test/api'),
    fetch: async (input, init) => {
      assert.equal(
        (init!.headers as Record<string, string>).Authorization,
        undefined,
      );
      assert.equal(init!.credentials, 'omit');
      const path = new URL(String(input)).pathname;
      calls.push({ path, body: JSON.parse(init!.body as string) });
      const status = path.endsWith('register')
        ? 201
        : /resend-verification|forgot-password/.test(path)
          ? 202
          : /verify-email|reset-password/.test(path)
            ? 204
            : 200;
      const data =
        status === 201
          ? user(USER_A)
          : status === 202
            ? null
            : {
                accessToken: makeJwt(USER_A),
                tokenType: 'Bearer',
                expiresIn: 3600,
                user: user(USER_A),
              };
      return new Response(
        status === 204
          ? null
          : JSON.stringify({
              success: true,
              statusCode: status,
              message: 'OK',
              data,
            }),
        { status, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const api = createAuthApi(http),
    signal = new AbortController().signal;
  assert.equal(
    (await api.login(' user@example.test ', 'secret', signal)).tokenType,
    'Bearer',
  );
  assert.equal(
    (await api.register(' User ', ' user@example.test ', 'Secret123!', signal))
      .id,
    USER_A,
  );
  await api.resend('user@example.test', signal);
  await api.forgot('user@example.test', signal);
  await api.verify(proof, signal);
  await api.reset(proof, 'New12345!', signal);
  assert.deepEqual(
    calls.map((c) => c.body),
    [
      { email: 'user@example.test', password: 'secret' },
      {
        email: 'user@example.test',
        password: 'Secret123!',
        displayName: 'User',
      },
      { email: 'user@example.test' },
      { email: 'user@example.test' },
      { token: proof },
      { token: proof, newPassword: 'New12345!' },
    ],
  );
});

test('forgot and resend survive the deliberate 10.5s response and have a 45s deadline', async () => {
  for (const method of ['forgot', 'resend'] as const) {
    const time = new FakeTime();
    let finish!: (response: Response) => void;
    const api = createAuthApi(
      createHttpClient({
        baseUrl: new URL('https://api.example.test/api'),
        timers: time,
        clock: time,
        timeoutMs: 1000,
        fetch: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    );
    const result = api[method](
      'user@example.test',
      new AbortController().signal,
    );
    time.advance(10_500);
    finish(
      new Response(
        JSON.stringify({
          success: true,
          statusCode: 202,
          message: 'Conditional',
          data: null,
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    );
    assert.equal(await result, null);
    assert.equal(time.timerCount, 0);
    assert.equal(MAIL_TIMEOUT_MS, 45_000);
  }
});

test('validation mirrors server policy without trimming passwords, and masks safely', () => {
  for (const value of ['abc12345!', 'Abcdefgh!', 'Abc12345 ', 'A1!'])
    assert.ok(passwordError(value));
  for (const value of ['Abc12345!', ' A1😀abcd', 'A1!' + '😀'.repeat(125)])
    assert.equal(passwordError(value), undefined);
  assert.ok(passwordError('A1!' + '😀'.repeat(126)));
  assert.equal(passwordError('x', false), undefined);
  assert.ok(passwordError('', false));
  assert.ok(emailError('bad'));
  assert.ok(nameError(' x '));
  assert.equal(nameError(' User '), undefined);
  assert.ok(confirmationError('A1!abcde', 'different'));
  assert.equal(maskEmail('alice@example.test'), 'a•••@example.test');
  assert.equal(maskEmail('bad'), 'your email address');
});
