import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import {
  QueryClient,
  QueryObserver,
  onlineManager,
} from '@tanstack/react-query';
import { createHttpClient } from '../src/infrastructure/api/client.ts';
import { ApiError } from '../src/infrastructure/api/errors.ts';
import { createResourceAccess } from '../src/infrastructure/query/resource-access.ts';
import { createQueryCoordinator } from '../src/infrastructure/query/coordinator.ts';
import { queryKeys } from '../src/infrastructure/query/keys.ts';
import {
  createChecklistApi,
  textError,
} from '../src/features/cards/checklists/api.ts';
import {
  checklistOptions,
  isUncertainCreate,
  runChecklistWrite,
} from '../src/features/cards/checklists/queries.ts';
import { moveAnchor } from '../src/features/cards/ordering.ts';
import {
  checklist,
  checklistId,
  checklists,
  itemCounts,
} from './fixtures/checklists.ts';
import { deferred } from './auth/support.ts';

const boardId = checklistId(800);
const { AbortController, Response } = globalThis;
const cardId = checklistId(801);
const identity = { userId: checklistId(802), generation: 1 };
const scope = { identity, boardId, cardId };
const signal = new AbortController().signal;
const base = `/boards/${boardId}/cards/${cardId}/checklists`;
const first = checklist(cardId, 1, [true, false, false]);
const second = checklist(cardId, 2, [true]);
const firstItem = first.items[0].id;
const item = `${base}/${first.id}/items/${firstItem}`;
const key = queryKeys.checklists(identity, boardId, cardId);
const dto = (data, status = 200) =>
  Response.json(
    { success: true, statusCode: status, message: 'OK', data },
    { status },
  );

test('all checklist endpoints use exact paths, body and status; a 204 never parses JSON', async () => {
  const requests = [];
  const expected = [
    ['GET', base, 200, undefined, checklists(cardId, [first, second])],
    [
      'GET',
      base + '/summary',
      200,
      undefined,
      { ...checklists(cardId, [first, second]), checklists: undefined },
    ],
    ['POST', base, 201, { title: first.title }, first],
    ['PATCH', base + '/' + first.id, 200, { title: first.title }, first],
    [
      'PATCH',
      base + '/' + first.id + '/move',
      200,
      { beforeChecklistId: null },
      first,
    ],
    [
      'POST',
      base + '/' + first.id + '/items',
      201,
      { text: 'Item text' },
      first,
    ],
    ['PATCH', item, 200, { text: 'Changed' }, first],
    ['PATCH', item, 200, { isChecked: false }, first],
    ['PATCH', item + '/move', 200, { beforeItemId: first.items[1].id }, first],
    ['DELETE', item, 204],
    ['DELETE', base + '/' + first.id, 204],
  ];
  const http = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    fetch: async (url, init) => {
      const n = requests.length;
      requests.push([
        init.method,
        new URL(url).pathname.slice(4) + new URL(url).search,
        init.body ? JSON.parse(init.body) : undefined,
      ]);
      const [, , status, , payload] = expected[n];
      if (status !== 204) return dto(payload, status);
      const empty = new Response(null, { status: 204 });
      empty.text = () => assert.fail('Attempted to parse a 204');
      return empty;
    },
  });
  const api = createChecklistApi(http, identity, boardId, cardId);
  const full = await api.list(signal);
  const summary = await api.summary(signal);
  assert.equal(full.checklists[0].position, '100.0000000000');
  assert.deepEqual(
    full.checklists.map(({ completionPercentage }) => completionPercentage),
    [33.33, 100],
  );
  assert.deepEqual(summary, {
    cardId,
    completionPercentage: 50,
    checkedItems: 2,
    totalItems: 4,
  });
  await api.write({ kind: 'create', title: '  ' + first.title + ' ' }, signal);
  await api.write(
    { kind: 'rename', checklistId: first.id, title: first.title },
    signal,
  );
  await api.write(
    { kind: 'move', checklistId: first.id, beforeChecklistId: null },
    signal,
  );
  await api.write(
    { kind: 'addItem', checklistId: first.id, text: ' Item text ' },
    signal,
  );
  await api.write(
    {
      kind: 'editItem',
      checklistId: first.id,
      itemId: firstItem,
      text: ' Changed ',
    },
    signal,
  );
  await api.write(
    {
      kind: 'toggle',
      checklistId: first.id,
      itemId: firstItem,
      isChecked: false,
    },
    signal,
  );
  await api.write(
    {
      kind: 'moveItem',
      checklistId: first.id,
      itemId: firstItem,
      beforeItemId: first.items[1].id,
    },
    signal,
  );
  assert.equal(
    await api.write(
      { kind: 'deleteItem', checklistId: first.id, itemId: firstItem },
      signal,
    ),
    undefined,
  );
  assert.equal(
    await api.write({ kind: 'delete', checklistId: first.id }, signal),
    undefined,
  );
  assert.deepEqual(
    requests,
    expected.map(([method, path, , body]) => [method, path, body]),
  );
});

test('decoders preserve server order/decimal precision and reject inconsistent or foreign data and overflow', async () => {
  let server;
  const api = createChecklistApi(
    { json: async (_path, decode) => decode(server) },
    identity,
    boardId,
    cardId,
  );
  server = checklists(cardId);
  assert.deepEqual(await api.list(signal), server);
  const full = Array.from({ length: 50 }, (_, i) =>
    checklist(cardId, i + 1, Array(200).fill(false)),
  );
  server = checklists(cardId, full);
  assert.equal((await api.list(signal)).totalItems, 10000);
  server = checklists(cardId, [
    { ...second, position: '2.00000000000000000001', unknownField: 'ignored' },
    { ...first, position: '2.00000000000000000002' },
  ]);
  const rows = (await api.list(signal)).checklists;
  assert.deepEqual(
    rows.map(({ id }) => id),
    [second.id, first.id],
  );
  assert.ok(!('unknownField' in rows[0]));
  const wrongItem = { ...first.items[0], checklistId: second.id };
  for (const payload of [
    null,
    [],
    { ...server, cardId: 'bad' },
    { ...server, completionPercentage: 100 },
    checklists(cardId, [first, first]),
    checklists(cardId, [{ ...first, title: ' ' }]),
    checklists(cardId, [{ ...first, position: 100 }]),
    checklists(cardId, [
      { ...first, items: [wrongItem, ...first.items.slice(1)] },
    ]),
    checklists(cardId, [...full, checklist(cardId, 51)]),
    checklists(cardId, [checklist(cardId, 1, Array(201).fill(true))]),
  ]) {
    server = payload;
    await assert.rejects(api.list(signal), { kind: 'invalid-response' });
  }
  assert.equal(textError(' ' + 'a'.repeat(120) + ' ', 120), undefined);
  assert.equal(textError('💡'.repeat(255), 255), undefined);
  assert.ok(textError('a'.repeat(121), 120));
  assert.ok(textError('a'.repeat(256), 255));
  assert.ok(textError('   ', 120));
  await assert.rejects(
    api.write(
      { kind: 'move', checklistId: first.id, beforeChecklistId: first.id },
      signal,
    ),
    { status: 400 },
  );
  await assert.rejects(
    api.write(
      {
        kind: 'moveItem',
        checklistId: first.id,
        itemId: firstItem,
        beforeItemId: undefined,
      },
      signal,
    ),
    { status: 400 },
  );
  await assert.rejects(
    api.write({ kind: 'delete', checklistId: 'bad/id' }, signal),
    { status: 400 },
  );
});

test('unexpected statuses and failed writes are never automatically retried', async () => {
  let calls = 0;
  let status = 200;
  const api = createChecklistApi(
    createHttpClient({
      baseUrl: new URL('https://example.test/api'),
      fetch: async () => {
        calls++;
        return dto(first, status);
      },
    }),
    identity,
    boardId,
    cardId,
  );
  const create = () =>
    api.write({ kind: 'create', title: 'Onboarding' }, signal);
  await assert.rejects(create(), { kind: 'invalid-response', status: 200 });
  await assert.rejects(
    api.write({ kind: 'delete', checklistId: first.id }, signal),
    { kind: 'invalid-response', status: 200 },
  );
  for (status of [400, 401, 403, 404, 409, 429, 500])
    await assert.rejects(
      create(),
      (error) =>
        error.status === status &&
        isUncertainCreate(error) === (status === 500),
    );
  assert.equal(calls, 9);
  assert.equal(
    isUncertainCreate(new ApiError('timeout', { requestStarted: true })),
    true,
  );
  assert.equal(
    isUncertainCreate(new ApiError('offline', { requestStarted: false })),
    false,
  );
});

function runtime(rows = [first, second]) {
  let server = checklists(cardId, rows);
  let current = identity;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const resources = createResourceAccess();
  const owner = {
    queryClient,
    resources,
    getIdentity: () => current,
    assertCurrent: (id) => {
      if (id !== current) throw new ApiError('session-changed');
    },
  };
  const commands = [];
  const api = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    fetch: async (url, init) => {
      const path = new URL(url).pathname.slice(4);
      if (init.method === 'GET') return env.read?.() ?? dto(server);
      const body = init.body && JSON.parse(init.body);
      commands.push({ path, body, method: init.method });
      return env.write?.(body) ?? dto(first);
    },
  });
  const data = { ...owner, ...createQueryCoordinator(owner), api };
  const cardKey = queryKeys.card(identity, boardId, cardId);
  const boardKey = queryKeys.board(identity, boardId);
  queryClient.setQueryData(key, server);
  queryClient.setQueryData(boardKey, {
    capabilities: { canWriteBoard: true },
    isArchived: false,
  });
  queryClient.setQueryData(cardKey, {
    isArchived: false,
    description: 'keep draft source',
  });
  const env = {
    commands,
    data,
    queryClient,
    resources,
    boardKey,
    cardKey,
    setServer: (value) => {
      server = checklists(cardId, value);
    },
    switchIdentity: () => {
      current = { ...identity, generation: 2 };
      queryClient.clear();
    },
    run: (command, onSettling) =>
      runChecklistWrite(data, scope, command, () => true, signal, onSettling),
  };
  return env;
}

test('placement anchors cover no-op, moving up/down, top and append without persisted ranks', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.equal(moveAnchor([], 'a', 'up'), undefined);
  assert.equal(moveAnchor(['a'], 'a', 'top'), undefined);
  for (const [source, direction, before] of [
    ['a', 'up', undefined],
    ['a', 'down', 'c'],
    ['b', 'up', 'a'],
    ['b', 'down', 'd'],
    ['c', 'down', null],
    ['d', 'down', undefined],
    ['d', 'top', 'a'],
    ['a', 'bottom', null],
  ])
    assert.equal(moveAnchor(ids, source, direction), before);
});

test('reorder rechecks displayed order, accepts server rank rebalance and blocks concurrent double moves', async () => {
  const env = runtime();
  const move = {
    kind: 'place',
    checklistId: first.id,
    placement: 'bottom',
    shown: [first.id, second.id],
  };
  env.setServer([second, first]);
  await assert.rejects(env.run(move), { code: 'CHECKLIST_CHANGED' });
  assert.deepEqual(env.commands, []);
  env.setServer([
    { ...first, position: '1000.000' },
    { ...second, position: '2000.000' },
  ]);
  const held = deferred();
  env.write = () => held.promise;
  const pending = env.run(move);
  await assert.rejects(env.run(move), { code: 'CHECKLIST_PENDING' });
  held.resolve(dto(first));
  await pending;
  assert.deepEqual(env.commands, [
    {
      method: 'PATCH',
      path: `${base}/${first.id}/move`,
      body: { beforeChecklistId: null },
    },
  ]);
  await assert.rejects(
    env.run({
      kind: 'place',
      checklistId: second.id,
      itemId: firstItem,
      placement: 'top',
      shown: [firstItem],
    }),
    { code: 'CHECKLIST_CHANGED' },
  );
  env.queryClient.clear();
});

test('rapid toggles drain intent before authoritative previews and stale reads cannot win', async () => {
  const env = runtime();
  let desired = false;
  const firstPatch = deferred();
  const started = deferred();
  const oldRead = deferred();
  const readStarted = deferred();
  let previewReads = 0;
  let reads = 0;
  let server = [first, second];
  const options = checklistOptions(env.data, scope);
  const observer = new QueryObserver(env.queryClient, {
    ...options,
    refetchOnMount: false,
  });
  const remove = observer.subscribe(() => {});
  const previews = queryKeys.previewBatch(identity, boardId, [
    cardId,
    second.id,
  ]);
  const unrelated = queryKeys.previewBatch(identity, boardId, [second.id]);
  const previewFetch = () => {
    previewReads++;
    return { checked: server[0].checkedItems };
  };
  const previewObserver = new QueryObserver(env.queryClient, {
    queryKey: previews,
    queryFn: previewFetch,
  });
  const stopPreviews = previewObserver.subscribe(() => {});
  await previewObserver.refetch();
  env.queryClient.setQueryData(unrelated, 'unchanged');
  const previewBaseline = previewReads;
  env.read = () => {
    reads++;
    if (reads === 1) {
      readStarted.resolve();
      return oldRead.promise;
    }
    return dto(checklists(cardId, server));
  };
  const stale = observer.refetch();
  await readStarted.promise;
  env.write = ({ isChecked }) => {
    const items = first.items.map((item, index) =>
      index === 0 ? { ...item, isChecked } : item,
    );
    server = [{ ...first, items, ...itemCounts(items) }, second];
    if (env.commands.length === 1) {
      started.resolve();
      return firstPatch.promise;
    }
    return dto(server[0]);
  };
  const pending = env.run({
    kind: 'toggle',
    checklistId: first.id,
    itemId: firstItem,
    intent: () => desired,
  });
  await started.promise;
  const toggledOff = server[0];
  desired = true;
  firstPatch.resolve(dto(toggledOff));
  await pending;
  oldRead.resolve(dto(checklists(cardId, [toggledOff, second])));
  await stale;
  assert.deepEqual(
    env.commands.map(({ body }) => body),
    [{ isChecked: false }, { isChecked: true }],
  );
  assert.equal(env.queryClient.getQueryData(key).completionPercentage, 50);
  assert.equal(previewReads - previewBaseline, 1);
  assert.equal(env.queryClient.getQueryData(previews).checked, 1);
  assert.equal(env.queryClient.getQueryData(unrelated), 'unchanged');
  assert.equal(
    env.queryClient.getQueryData(env.cardKey).description,
    'keep draft source',
  );
  stopPreviews();
  remove();
  env.queryClient.clear();
});

test('limits, archive, read-only, offline and an old session do not write or reseed private data', async () => {
  const full = Array.from({ length: 50 }, (_, i) =>
    checklist(cardId, i + 1, i === 0 ? Array(200).fill(false) : []),
  );
  const env = runtime(full);
  await assert.rejects(env.run({ kind: 'create', title: 'Overflow' }), {
    code: 'CHECKLIST_LIMIT',
  });
  await assert.rejects(
    env.run({ kind: 'addItem', checklistId: first.id, text: 'Overflow' }),
    { code: 'CHECKLIST_ITEM_LIMIT' },
  );
  env.queryClient.setQueryData(env.boardKey, {
    capabilities: { canWriteBoard: false },
  });
  await assert.rejects(env.run({ kind: 'delete', checklistId: first.id }), {
    status: 403,
  });
  env.queryClient.setQueryData(env.boardKey, {
    capabilities: { canWriteBoard: true },
    isArchived: true,
  });
  await assert.rejects(env.run({ kind: 'delete', checklistId: first.id }), {
    status: 403,
  });
  env.queryClient.setQueryData(env.boardKey, {
    capabilities: { canWriteBoard: true },
  });
  env.queryClient.setQueryData(env.cardKey, { isArchived: true });
  await assert.rejects(env.run({ kind: 'delete', checklistId: first.id }), {
    status: 403,
  });
  env.queryClient.setQueryData(env.cardKey, { isArchived: false });
  onlineManager.setOnline(false);
  try {
    await assert.rejects(env.run({ kind: 'delete', checklistId: first.id }), {
      kind: 'offline',
    });
  } finally {
    onlineManager.setOnline(true);
  }
  assert.deepEqual(env.commands, []);
  const held = deferred();
  const started = deferred();
  env.write = () => {
    started.resolve();
    return held.promise;
  };
  const pending = env.run({
    kind: 'rename',
    checklistId: first.id,
    title: 'Late',
  });
  await started.promise;
  env.switchIdentity();
  held.resolve(dto(first));
  await assert.rejects(pending, { kind: 'session-changed' });
  assert.equal(env.queryClient.getQueryData(key), undefined);
});
