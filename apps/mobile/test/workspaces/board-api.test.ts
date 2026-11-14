import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBoardApi,
  decodeBoard,
  decodeBackgroundCatalog,
  decodeBoardUserState,
} from '../../src/features/boards/api.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { board, page, uuid } from './fixtures.ts';

test('Board mutations use the source-verified methods, bodies and response statuses', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const item = { ...board(), currentUserRole: 'OWNER', createdById: uuid(2) };
  env.respond((_url, init) =>
    Promise.resolve(
      init.method === 'POST' && _url.endsWith('/boards')
        ? json(
            { success: true, statusCode: 201, message: 'Created', data: item },
            201,
          )
        : ok(
            _url.endsWith('/star')
              ? { isStarred: init.method === 'PUT', lastViewedAt: null }
              : item,
          ),
    ),
  );
  const api = createBoardApi(env.data.api, env.identity);
  const signal = new AbortController().signal;
  await api.create({ name: 'Test', workspaceId: item.workspaceId }, signal);
  await api.update(item.id, { description: null }, signal);
  await api.background(item.id, 'forest', 1, signal);
  assert.equal((await api.star(item.id, true, signal)).isStarred, true);
  assert.equal((await api.star(item.id, false, signal)).isStarred, false);
  const calls = env.requests.filter(({ init }) => init.method !== 'GET');
  assert.deepEqual(
    calls.map(({ init }) => init.method),
    ['POST', 'PATCH', 'PATCH', 'PUT', 'DELETE'],
  );
  assert.deepEqual(JSON.parse(String(calls[2]!.init.body)), {
    preset: 'forest',
    expectedVersion: 1,
  });
});

test('user state rejects malformed values and catalog ignores unknown presets', () => {
  assert.equal(
    decodeBoard({
      ...board(),
      createdById: uuid(2),
      backgroundPreset: 'future-preset',
    }).backgroundPreset,
    'future-preset',
  );
  assert.throws(() =>
    decodeBoardUserState({ isStarred: true, lastViewedAt: 'yesterday' }),
  );
  assert.deepEqual(
    decodeBackgroundCatalog([
      {
        id: 'external',
        kind: 'photo',
        value: 'https://example.test',
        foreground: 'light',
      },
    ]),
    [],
  );
  assert.throws(() =>
    decodeBackgroundCatalog([
      { id: 'blue', kind: 'color', value: '#fff', foreground: 'light' },
      { id: 'blue', kind: 'color', value: '#fff', foreground: 'light' },
    ]),
  );
});

test('global Board list sends page and archived status and validates the response', async (t) => {
  const env = await integration();
  t.after(env.dispose);
  const rows = Array.from({ length: 21 }, (_, i) => ({
    ...board(uuid(1), i + 1),
    isArchived: true,
    archivedAt: '2026-11-13T09:00:00.000Z',
    currentUserRole: 'MEMBER',
    createdById: uuid(2),
  }));
  env.respond((url) =>
    Promise.resolve(
      json(page(rows, Number(new URL(url).searchParams.get('page')), 20)),
    ),
  );
  const result = await createBoardApi(env.data.api, env.identity).list(
    2,
    'archived',
    new AbortController().signal,
  );
  assert.equal(result.data.length, 1);
  const url = new URL(env.requests.at(-1)!.url);
  assert.equal(url.searchParams.get('status'), 'archived');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('limit'), '20');
});
