import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryObserver } from '@tanstack/react-query';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import {
  deduplicatePages,
  nextCursor,
  nextPage,
  requirePage,
} from '../../src/infrastructure/query/pagination.ts';
import {
  USER_A,
  USER_B,
  deferred,
  flush,
  loginResponse,
  user,
} from '../auth/support.ts';
import { ok, setup } from './support.ts';

test('same-key concurrent observers share one actual HTTP request', async () => {
  const gate = deferred<Response>();
  const context = await setup(() => gate.promise);
  try {
    const options = context.layer.meOptions(context.layer.getIdentity()!);
    const first = context.layer.queryClient.fetchQuery(options);
    const second = context.layer.queryClient.fetchQuery(options);
    assert.equal(context.requests.length, 1);
    gate.resolve(ok(user(USER_A)));
    assert.deepEqual(await first, await second);
    await context.layer.queryClient.fetchQuery(options);
    assert.equal(context.requests.length, 1);
  } finally {
    context.dispose();
  }
});

test('the real session verification result seeds me without an immediate duplicate HTTP request', async () => {
  const context = await setup(undefined, { keepVerifiedUser: true });
  try {
    const options = context.layer.meOptions(context.layer.getIdentity()!);
    assert.equal(
      (await context.layer.queryClient.fetchQuery(options)).id,
      USER_A,
    );
    assert.equal(context.requests.length, 0);
    await context.layer.invalidate(context.layer.getIdentity()!, [
      options.queryKey,
    ]);
    assert.equal(
      (await context.layer.queryClient.fetchQuery(options)).id,
      USER_A,
    );
    assert.equal(context.requests.length, 1);
  } finally {
    context.dispose();
  }
});

test('current-user adapter rejects a response for a different identity', async () => {
  const context = await setup(async () => ok(user(USER_B)));
  try {
    await assert.rejects(
      context.layer.queryClient.fetchQuery(
        context.layer.meOptions(context.layer.getIdentity()!),
      ),
      { kind: 'invalid-response' },
    );
  } finally {
    context.dispose();
  }
});

test('session teardown synchronously removes queries/mutations and fences late results and old query functions', async () => {
  const gate = deferred<Response>();
  const context = await setup(() => gate.promise);
  try {
    const a = context.layer.getIdentity()!;
    const key = queryKeys.card(a, 'board', 'card');
    context.layer.queryClient.setQueryData(key, { private: 'a' });
    context.layer.queryClient
      .getMutationCache()
      .build(context.layer.queryClient, { mutationKey: key, gcTime: Infinity });
    const old = context.layer.meOptions(a);
    const pending = context.layer.queryClient.fetchQuery(old);
    const settled = pending.catch(() => null);
    const login = context.manager.establishSession(loginResponse(USER_B));
    assert.equal(context.layer.queryClient.getQueryData(key), undefined);
    assert.equal(
      context.layer.queryClient.getMutationCache().getAll().length,
      0,
    );
    await login;
    await settled;
    gate.resolve(ok(user(USER_A)));
    await flush();
    assert.equal(context.layer.getIdentity()?.userId, USER_B);
    assert.equal(
      context.layer.queryClient.getQueryData(old.queryKey),
      undefined,
    );
    await assert.rejects(context.layer.queryClient.fetchQuery(old), {
      kind: 'session-changed',
    });
    assert.equal(context.requests.length, 1);
  } finally {
    context.dispose();
  }
});

test('targeted/coalesced invalidation refetches each active matching query once; inactive data is only marked stale', async () => {
  const context = await setup();
  try {
    const { layer } = context;
    const identity = layer.getIdentity()!;
    const observer = new QueryObserver(
      layer.queryClient,
      layer.meOptions(identity),
    );
    const stop = observer.subscribe(() => {});
    await flush();
    assert.equal(context.requests.length, 1);
    const board = queryKeys.board(identity, 'board');
    layer.queryClient.setQueryData(board, { title: 'Board' });
    await layer.invalidate(identity, [board]);
    assert.equal(context.requests.length, 1);
    await Promise.all([
      layer.invalidate(identity, [queryKeys.me(identity)]),
      layer.invalidate(identity, [
        queryKeys.me(identity),
        queryKeys.me(identity),
      ]),
    ]);
    assert.equal(context.requests.length, 2);
    assert.equal(layer.queryClient.getQueryState(board)?.isInvalidated, true);
    await assert.rejects(
      layer.invalidate(identity, [
        queryKeys.me({ ...identity, userId: USER_B }),
      ]),
      { kind: 'session-changed' },
    );
    await Promise.all([layer.recover(identity), layer.recover(identity)]);
    assert.equal(context.requests.length, 3);
    stop();
  } finally {
    context.dispose();
  }
});

test('optimistic failure rolls back, then reconciles through an authoritative active refetch', async () => {
  const context = await setup();
  try {
    const { layer } = context;
    const identity = layer.getIdentity()!;
    const key = queryKeys.card(identity, 'b', 'c');
    layer.queryClient.setQueryData(key, { title: 'old' });
    const gate = deferred<void>();
    const pending = layer.optimistic({
      identity,
      key,
      update: () => ({ title: 'optimistic' }),
      mutation: async () => {
        await gate.promise;
        throw new Error('conflict');
      },
    });
    const check = assert.rejects(pending, /conflict/);
    await flush();
    assert.deepEqual(layer.queryClient.getQueryData(key), {
      title: 'optimistic',
    });
    gate.resolve();
    await check;
    assert.deepEqual(layer.queryClient.getQueryData(key), { title: 'old' });
    assert.equal(layer.queryClient.getQueryState(key)?.isInvalidated, true);
    let reads = 0;
    const observer = new QueryObserver(layer.queryClient, {
      queryKey: key,
      queryFn: async () => {
        reads++;
        return { title: 'server' };
      },
    });
    const stop = observer.subscribe(() => {});
    await flush();
    assert.equal(reads, 1);
    await layer.optimistic({
      identity,
      key,
      update: () => ({ title: 'new' }),
      mutation: async () => 'committed',
    });
    await flush(); // Reconciliation completes independently of the write promise.
    assert.equal(reads, 2);
    assert.deepEqual(layer.queryClient.getQueryData(key), { title: 'server' });
    stop();
  } finally {
    context.dispose();
  }
});

test('rollback cannot overwrite a newer authoritative cache update or repopulate after logout', async () => {
  const context = await setup();
  try {
    const { layer } = context;
    const identity = layer.getIdentity()!;
    const key = queryKeys.card(identity, 'b', 'c');
    layer.queryClient.setQueryData(key, 'old');
    const gate = deferred<void>();
    const pending = layer.optimistic({
      identity,
      key,
      update: () => 'optimistic',
      mutation: async () => {
        await gate.promise;
        throw new Error('failed');
      },
    });
    const check = assert.rejects(pending, /failed/);
    await flush();
    layer.queryClient.setQueryData(key, 'authoritative');
    gate.resolve();
    await check;
    assert.equal(layer.queryClient.getQueryData(key), 'authoritative');
    const late = deferred<string>();
    const switched = layer.optimistic({
      identity,
      key,
      update: () => 'a edit',
      mutation: () => late.promise,
      reconcile: (value) => value,
    });
    const fenced = assert.rejects(switched, { kind: 'session-changed' });
    await flush();
    await context.manager.establishSession(loginResponse(USER_B));
    late.resolve('private a');
    await fenced;
    assert.equal(layer.queryClient.getQueryData(key), undefined);
  } finally {
    context.dispose();
  }
});

test('conflicting optimistic edits serialize without blocking unrelated keys', async () => {
  const context = await setup();
  try {
    const { layer } = context;
    const identity = layer.getIdentity()!;
    const key = queryKeys.card(identity, 'b', 'c');
    layer.queryClient.setQueryData(key, 0);
    const gate = deferred<number>();
    const calls: string[] = [];
    const first = layer.optimistic({
      identity,
      key,
      update: () => 1,
      mutation: () => {
        calls.push('first');
        return gate.promise;
      },
    });
    const second = layer.optimistic({
      identity,
      key,
      update: (value: number | undefined) => (value ?? 0) + 1,
      mutation: async () => {
        calls.push('second');
        return 2;
      },
    });
    await flush();
    assert.deepEqual(calls, ['first']);
    await layer.optimistic({
      identity,
      key: queryKeys.card(identity, 'b', 'other'),
      update: () => 3,
      mutation: async () => {
        calls.push('other');
      },
    });
    gate.resolve(1);
    await Promise.all([first, second]);
    assert.deepEqual(calls, ['first', 'other', 'second']);
    assert.equal(layer.queryClient.getQueryData(key), 2);
  } finally {
    context.dispose();
  }
});

test('committed same-key edits release their locks before slow refetches, cancel old reads and refresh again', async () => {
  const reads: {
    gate: ReturnType<typeof deferred<Response>>;
    signal: AbortSignal;
  }[] = [];
  let writes = 0;
  const context = await setup(async (init) => {
    if (init.method === 'PATCH') return ok({ value: ++writes });
    const gate = deferred<Response>();
    reads.push({ gate, signal: init.signal! });
    return gate.promise;
  });
  const { layer } = context;
  const identity = layer.getIdentity()!;
  const key = queryKeys.card(identity, 'b', 'c');
  layer.queryClient.setQueryData(key, { value: 0 });
  const decode = (value: unknown) => {
    assert.ok(
      value &&
        typeof value === 'object' &&
        'value' in value &&
        typeof value.value === 'number',
    );
    return { value: value.value };
  };
  const observer = new QueryObserver(layer.queryClient, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      layer.api.json('/cards/c', decode, { identity, signal, retries: 0 }),
  });
  const stop = observer.subscribe(() => {});
  const edit = () =>
    layer.optimistic({
      identity,
      key,
      update: (previous: { value: number } | undefined) => ({
        value: (previous?.value ?? 0) + 1,
      }),
      mutation: () =>
        layer.api.json('/cards/c', decode, {
          identity,
          method: 'PATCH',
          body: { value: writes + 1 },
        }),
      reconcile: (result) => result,
    });
  try {
    let firstSettled = false;
    const first = edit().then((result) => {
      firstSettled = true;
      return result;
    });
    await flush();
    assert.equal(
      firstSettled,
      true,
      'a committed write must not wait for its slow GET',
    );
    assert.deepEqual(await first, { value: 1 });
    assert.equal(reads.length, 1);
    assert.equal(layer.queryClient.getQueryState(key)?.fetchStatus, 'fetching');
    let secondSettled = false;
    const second = edit().then((result) => {
      secondSettled = true;
      return result;
    });
    await flush();
    assert.equal(
      secondSettled,
      true,
      'the next same-key edit must acquire the released lock',
    );
    assert.deepEqual(await second, { value: 2 });
    assert.equal(reads[0]!.signal.aborted, true);
    assert.equal(
      reads.length,
      2,
      'the second edit must trigger its own authoritative read',
    );
    assert.deepEqual(
      context.requests.map((request) => request.method),
      ['PATCH', 'GET', 'PATCH', 'GET'],
    );
    reads[0]!.gate.resolve(ok({ value: -1 }));
    await flush();
    assert.deepEqual(
      layer.queryClient.getQueryData(key),
      { value: 2 },
      'cancelled read cannot overwrite the newer edit',
    );
    reads[1]!.gate.resolve(ok({ value: 20 }));
    await flush();
    assert.deepEqual(layer.queryClient.getQueryData(key), { value: 20 });
    assert.equal(layer.queryClient.getQueryState(key)?.fetchStatus, 'idle');
    assert.equal(context.requests.length, 4);
  } finally {
    for (const read of reads) read.gate.resolve(ok({ value: writes }));
    stop();
    context.dispose();
  }
});

test('failed authoritative refetch cannot reject a committed write or leave an unhandled promise', async () => {
  const context = await setup(
    async () =>
      new Response('{}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const { layer } = context;
  const identity = layer.getIdentity()!;
  const key = queryKeys.card(identity, 'b', 'c');
  layer.queryClient.setQueryData(key, 'old');
  const observer = new QueryObserver(layer.queryClient, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      layer.api.json('/cards/c', (value) => value, {
        identity,
        signal,
        retries: 0,
      }),
  });
  const stop = observer.subscribe(() => {});
  try {
    assert.equal(
      await layer.optimistic({
        identity,
        key,
        update: () => 'new',
        mutation: async () => 'committed',
      }),
      'committed',
    );
    await flush();
    assert.equal(layer.queryClient.getQueryState(key)?.status, 'error');
    assert.equal(layer.queryClient.getQueryData(key), 'new');
    assert.equal(context.requests.length, 1);
  } finally {
    stop();
    context.dispose();
  }
});

test('pagination uses server metadata and deduplicates overlaps without reordering', () => {
  assert.equal(nextPage({ page: 1, limit: 20, total: 21, totalPages: 2 }), 2);
  assert.equal(
    nextPage({ page: 2, limit: 20, total: 21, totalPages: 2 }),
    undefined,
  );
  assert.equal(nextCursor({ limit: 20, nextCursor: 'opaque/+' }), 'opaque/+');
  assert.equal(nextCursor({ limit: 20, nextCursor: null }), undefined);
  assert.deepEqual(
    deduplicatePages([
      [
        { id: '1', value: 'old' },
        { id: '2', value: 'two' },
      ],
      [
        { id: '1', value: 'new' },
        { id: '3', value: 'three' },
      ],
    ]),
    [
      { id: '1', value: 'new' },
      { id: '2', value: 'two' },
      { id: '3', value: 'three' },
    ],
  );
  assert.throws(() =>
    requirePage({ success: true, statusCode: 200, message: 'OK', data: [] }),
  );
});

test('both accounts fetch their own data; signing into the same account again gets a fresh generation', async () => {
  const context = await setup();
  try {
    const { layer } = context;
    const a = layer.getIdentity()!;
    assert.equal(
      (await layer.queryClient.fetchQuery(layer.meOptions(a))).id,
      USER_A,
    );
    await context.manager.establishSession(loginResponse(USER_B));
    const b = layer.getIdentity()!;
    await layer.invalidate(b, [queryKeys.me(b)]);
    assert.equal(
      (await layer.queryClient.fetchQuery(layer.meOptions(b))).id,
      USER_B,
    );
    assert.equal(layer.queryClient.getQueryData(queryKeys.me(a)), undefined);
    await context.manager.establishSession(loginResponse(USER_A));
    const again = layer.getIdentity()!;
    assert.notEqual(again.generation, a.generation);
    await layer.invalidate(again, [queryKeys.me(again)]);
    assert.equal(
      (await layer.queryClient.fetchQuery(layer.meOptions(again))).id,
      USER_A,
    );
    assert.equal(layer.queryClient.getQueryData(queryKeys.me(b)), undefined);
    assert.equal(context.requests.length, 3);
  } finally {
    context.dispose();
  }
});

test('resource eviction cancels queries and prevents a late optimistic success from restoring revoked data', async () => {
  const context = await setup();
  try {
    const { layer } = context;
    const identity = layer.getIdentity()!;
    const key = queryKeys.card(identity, 'b', 'c');
    layer.queryClient.setQueryData(key, 'private');
    const gate = deferred<string>();
    const pending = layer.optimistic({
      identity,
      key,
      update: () => 'edit',
      mutation: () => gate.promise,
      reconcile: (value) => value,
    });
    const check = assert.rejects(pending, { kind: 'session-changed' });
    await flush();
    layer.evict(identity, [queryKeys.board(identity, 'b')]);
    gate.resolve('revoked');
    await check;
    assert.equal(layer.queryClient.getQueryData(key), undefined);
  } finally {
    context.dispose();
  }
});
