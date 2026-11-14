import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBoardApi,
  decodeBackgroundCatalog,
  decodeBoardUserState,
} from '../../src/features/boards/api.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { board, uuid } from './fixtures.ts';

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

test('user state and catalog reject malformed and unknown values', () => {
  assert.throws(() =>
    decodeBoardUserState({ isStarred: true, lastViewedAt: 'yesterday' }),
  );
  assert.throws(() =>
    decodeBackgroundCatalog([
      {
        id: 'external',
        kind: 'photo',
        value: 'https://example.test',
        foreground: 'light',
      },
    ]),
  );
  assert.throws(() =>
    decodeBackgroundCatalog([
      { id: 'blue', kind: 'color', value: '#fff', foreground: 'light' },
      { id: 'blue', kind: 'color', value: '#fff', foreground: 'light' },
    ]),
  );
});
