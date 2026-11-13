import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  QueryObserver,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { homeOptions } from '../../src/features/home/query.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { USER_B, flush, loginResponse } from '../auth/support.ts';
import {
  BOARD,
  integration,
  json,
  ok,
  payload,
} from '../realtime/integration-support.ts';
import { emptyHome, fixture } from './fixtures.ts';

const suffix = '/users/me/home';

test('the verified bearer owns the Home read, and a late response cannot repopulate a new account', async (t) => {
  const env = await integration();
  t.after(() => env.dispose());
  let release!: (result: Response) => void;
  const late = new Promise<Response>((resolve) => {
    release = resolve;
  });
  env.respond((url) => (url.endsWith(suffix) ? late : null));
  const options = homeOptions(env.data, env.identity);
  const inFlight = env.data.queryClient.fetchQuery(options);
  const rejected = assert.rejects(inFlight);
  await flush();
  const [first] = env.requests.filter((request) =>
    request.url.endsWith(suffix),
  );
  assert.equal(
    new Headers(first!.init.headers).get('authorization'),
    `Bearer ${loginResponse(BOARD).accessToken}`,
  );
  assert.equal(new URL(first!.url).search, '');
  await env.manager.establishSession(loginResponse(USER_B));
  env.respond((url) =>
    url.endsWith(suffix) ? Promise.resolve(ok(emptyHome())) : null,
  );
  const next = homeOptions(env.data, env.identity);
  assert.notDeepEqual(options.queryKey, next.queryKey);
  assert.deepEqual(await env.data.queryClient.fetchQuery(next), emptyHome());
  release(ok(fixture()));
  await rejected;
  await flush();
  assert.equal(env.data.queryClient.getQueryData(options.queryKey), undefined);
  assert.deepEqual(
    env.data.queryClient.getQueryData(next.queryKey),
    emptyHome(),
  );
  await assert.rejects(
    options.queryFn!({ signal: new AbortController().signal } as never),
    { kind: 'session-changed' },
  );
  assert.equal(
    env.requests.filter((request) => request.url.endsWith(suffix)).length,
    2,
  );
});

test('coalesced existing room hints update Home and revoke fences the old HTTP response immediately', async (t) => {
  const env = await integration();
  t.after(() => env.dispose());
  await env.join();
  let snapshot = fixture();
  let deferred: Promise<Response> | null = null;
  env.respond((url) =>
    url.endsWith(suffix) ? (deferred ?? Promise.resolve(ok(snapshot))) : null,
  );
  const options = homeOptions(env.data, env.identity);
  const observer = new QueryObserver(env.data.queryClient, options);
  const stop = observer.subscribe(() => {});
  t.after(stop);
  const calls = () =>
    env.requests.filter((request) => request.url.endsWith(suffix)).length;
  await flush();
  assert.equal(calls(), 1);
  assert.deepEqual(observer.getCurrentResult().data, snapshot);
  snapshot = fixture();
  snapshot.upNext[0]!.title = 'Authoritative edit';
  for (let i = 0; i < 4; i++) env.socket.server('card:updated', payload);
  env.time.advance(50);
  await flush();
  assert.equal(calls(), 2);
  assert.equal(
    observer.getCurrentResult().data?.upNext[0]?.title,
    'Authoritative edit',
  );
  let release!: (value: Response) => void;
  deferred = new Promise<Response>((resolve) => {
    release = resolve;
  });
  void observer.refetch();
  await flush();
  assert.equal(calls(), 3);
  env.socket.server('board:access-revoked', { boardId: BOARD });
  assert.equal(observer.getCurrentResult().data, undefined);
  assert.equal(env.data.queryClient.getQueryData(options.queryKey), undefined);
  const revoked = snapshot;
  deferred = null;
  snapshot = emptyHome();
  release(ok(revoked));
  env.time.advance(50);
  await flush();
  assert.equal(calls(), 4);
  assert.deepEqual(observer.getCurrentResult().data, emptyHome());
  assert.equal(env.sockets.length, 1);
});

test('connection loss evicts Home and focus/network/socket recovery issue bounded reads', async (t) => {
  const env = await integration();
  env.data.queryClient.mount();
  t.after(() => {
    env.data.queryClient.unmount();
    env.dispose();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });
  env.socket.server('connect');
  env.respond((url) =>
    url.endsWith(suffix) ? Promise.resolve(ok(fixture())) : null,
  );
  const observer = new QueryObserver(
    env.data.queryClient,
    homeOptions(env.data, env.identity),
  );
  const stop = observer.subscribe(() => {});
  t.after(stop);
  const calls = () =>
    env.requests.filter((request) => request.url.endsWith(suffix)).length;
  await flush();
  assert.equal(calls(), 1);
  focusManager.setFocused(false);
  onlineManager.setOnline(false);
  env.environment(false, false);
  assert.equal(observer.getCurrentResult().data, undefined);
  env.respond((url) =>
    url.endsWith(suffix) ? Promise.resolve(ok(emptyHome())) : null,
  );
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  env.environment(true, true);
  await flush();
  env.socket.server('connect');
  await flush();
  // Focus/network share one read. A later socket handshake checks the missed-event window.
  assert.equal(calls(), 3);
  assert.equal(env.sockets.length, 2);
  assert.deepEqual(observer.getCurrentResult().data, emptyHome());
});

test('an authenticated Home 403/404 purges cached data and 401 ends the matching session', async (t) => {
  const env = await integration();
  t.after(() => env.dispose());
  let status = 200;
  env.respond((url) =>
    url.endsWith(suffix)
      ? Promise.resolve(status === 200 ? ok(fixture()) : json({}, status))
      : null,
  );
  const options = homeOptions(env.data, env.identity);
  const observer = new QueryObserver(env.data.queryClient, options);
  const stop = observer.subscribe(() => {});
  t.after(stop);
  await flush();
  for (const denied of [403, 404]) {
    status = denied;
    await observer.refetch();
    assert.equal(
      env.data.queryClient.getQueryData(options.queryKey),
      undefined,
    );
    status = 200;
    await observer.refetch();
    assert.equal(
      observer.getCurrentResult().data?.summary.assignedActiveCount,
      18,
    );
  }
  status = 401;
  await observer.refetch();
  assert.notEqual(env.manager.getSnapshot().status, 'authenticated');
  assert.equal(env.data.queryClient.getQueryData(options.queryKey), undefined);
});

test('unexpected Home response becomes a safe invalid-response error', async (t) => {
  const env = await integration();
  t.after(() => env.dispose());
  env.respond((url) =>
    url.endsWith(suffix)
      ? Promise.resolve(ok({ unknown: 'private-body' }))
      : null,
  );
  await assert.rejects(
    env.data.queryClient.fetchQuery(homeOptions(env.data, env.identity)),
    (error) =>
      error instanceof ApiError &&
      error.kind === 'invalid-response' &&
      !JSON.stringify(error).includes('private-body'),
  );
});
