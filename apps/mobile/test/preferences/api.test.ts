import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integration, ok, json } from '../realtime/integration-support.ts';
import { preferencesApi } from '../../src/features/preferences/api.ts';
import { preferencesCommands } from '../../src/features/preferences/commands.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { saved } from './fixtures.ts';
import { flush } from '../auth/support.ts';
test('all preference adapters share Retry-After and cannot bypass a read cooldown with PATCH', async () => {
  const env = await integration();
  let limited = true;
  env.respond(() =>
    Promise.resolve(
      limited
        ? new Response(JSON.stringify({ message: 'slow down' }), {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'retry-after': '60',
            },
          })
        : ok(saved),
    ),
  );
  const api = preferencesApi(env.data.api, env.identity),
    signal = () => new AbortController().signal;
  await assert.rejects(
    api.get(signal()),
    (e) => e instanceof ApiError && e.status === 429,
  );
  const before = env.requests.length;
  limited = false;
  await assert.rejects(
    api.patch({ theme: 'light' }, signal()),
    (e) =>
      e instanceof ApiError && e.status === 429 && e.requestStarted === false,
  );
  assert.equal(env.requests.length, before);
  env.dispose();
});
test('full authoritative response and exact sparse body; unavailable and invalid responses never succeed', async () => {
  const env = await integration(),
    api = preferencesApi(env.data.api, env.identity),
    signal = () => new AbortController().signal;
  env.respond(() =>
    Promise.resolve(
      ok({ ...saved, theme: 'dark', timeZone: 'Asia/Ho_Chi_Minh' }),
    ),
  );
  assert.equal(
    (await api.patch({ theme: 'dark' }, signal())).timeZone,
    'Asia/Ho_Chi_Minh',
  );
  assert.deepEqual(JSON.parse(env.requests[0]!.init.body as string), {
    theme: 'dark',
  });
  for (const status of [400, 403, 404, 500]) {
    env.respond(() => Promise.resolve(json({}, status)));
    await assert.rejects(
      api.get(signal()),
      (e) => e instanceof ApiError && e.status === status,
    );
  }
  env.respond(() => Promise.resolve(ok({ ...saved, theme: null })));
  await assert.rejects(api.get(signal()));
  env.respond(() => Promise.resolve(json({}, 401)));
  await assert.rejects(api.get(signal()));
  assert.equal(env.data.getIdentity(), null);
  env.dispose();
});
test('regional pending write coalesces theme intent without full object overwrites', async () => {
  const env = await integration(),
    key = queryKeys.datePreferences(env.identity);
  env.data.queryClient.setQueryData(key, saved);
  let release!: (r: Response) => void;
  const bodies: unknown[] = [];
  env.respond((_u, init) => {
    bodies.push(JSON.parse(init.body as string));
    return bodies.length === 1
      ? new Promise((r) => (release = r))
      : Promise.resolve(
          ok({ ...saved, theme: 'dark', timeZone: 'America/New_York' }),
        );
  });
  const cmd = preferencesCommands(env.data, env.identity);
  const saving = cmd.save({ timeZone: 'America/New_York' });
  await new Promise((r) => setTimeout(r, 0));
  void cmd.chooseTheme('dark');
  release(ok({ ...saved, timeZone: 'America/New_York' }));
  await saving;
  assert.deepEqual(bodies, [
    { timeZone: 'America/New_York' },
    { theme: 'dark' },
  ]);
  assert.equal(
    env.data.queryClient.getQueryData<typeof saved>(key)?.theme,
    'dark',
  );
  env.dispose();
});

test('overlapping 429 responses preserve the longest cooldown for the same identity', async (t) => {
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  const env = await integration();
  const releases: ((r: Response) => void)[] = [];
  env.respond(() => new Promise((resolve) => releases.push(resolve)));
  const api = preferencesApi(env.data.api, env.identity),
    signal = () => new AbortController().signal;
  const first = api.get(signal()).catch((error) => error),
    second = api.get(signal()).catch((error) => error);
  await flush();
  const limited = (seconds: number) =>
    new Response('{}', {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(seconds),
      },
    });
  try {
    releases[0]!(limited(60));
    const long = await first;
    assert.ok(long instanceof ApiError);
    now += 1000;
    releases[1]!(limited(1));
    const short = await second;
    assert.ok(short instanceof ApiError);
    assert.equal(short.retryAfterMs, 59000);
    now += 1000;
    const count = env.requests.length;
    await assert.rejects(
      api.get(signal()),
      (error) =>
        error instanceof ApiError &&
        error.status === 429 &&
        error.retryAfterMs === 58000 &&
        error.requestStarted === false,
    );
    assert.equal(env.requests.length, count);
  } finally {
    env.dispose();
  }
});
