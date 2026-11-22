import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKanbanApi } from '../../src/features/boards/kanban-api.ts';
import { integration, ok } from '../realtime/integration-support.ts';

test('account date preferences have no Board grant dependency and require complete authoritative week start and theme', async () => {
  const env = await integration();
  try {
    let value: unknown = {
      timeZone: 'Pacific/Kiritimati',
      dateFormat: 'DD/MM/YYYY',
      weekStartsOn: 'sunday',
      theme: 'dark',
    };
    env.respond((url) =>
      url.endsWith('/users/me/preferences') ? Promise.resolve(ok(value)) : null,
    );
    const read = () =>
      createKanbanApi(env.data.api, env.identity, '').datePreferences(
        new AbortController().signal,
      );
    const result = await read();
    assert.deepEqual(result, value);
    value = {};
    await assert.rejects(read());
    value = {
      timeZone: 'UTC',
      dateFormat: 'YYYY-MM-DD',
      weekStartsOn: 'monday',
      theme: 'system',
    };
    assert.deepEqual(await read(), value);
    value = { timeZone: 'Not/AZone' };
    await assert.rejects(
      createKanbanApi(env.data.api, env.identity, '').datePreferences(
        new AbortController().signal,
      ),
    );
    value = { weekStartsOn: 'saturday' };
    await assert.rejects(
      createKanbanApi(env.data.api, env.identity, '').datePreferences(
        new AbortController().signal,
      ),
    );
    assert.equal(
      env.requests.some(({ url }) => url.includes('/boards/')),
      false,
    );
  } finally {
    env.dispose();
  }
});
