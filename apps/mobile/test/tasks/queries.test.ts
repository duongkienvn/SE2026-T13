import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  tasksOptions,
  taskCollection,
} from '../../src/features/tasks/queries.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { integration, json } from '../realtime/integration-support.ts';

test('tasks share the realtime prefix and retain latest overlap without changing server order', async () => {
  const env = await integration();
  try {
    const options = tasksOptions(env.data, env.identity, {}, 'UTC');
    assert.deepEqual(
      options.queryKey.slice(0, 5),
      queryKeys.tasks(env.identity),
    );
    const cards = taskCollection([
      {
        data: [
          { id: 'one', title: 'old' },
          { id: 'two', title: 'second' },
        ],
      },
      {
        data: [
          { id: 'one', title: 'updated' },
          { id: 'three', title: 'last' },
        ],
      },
    ]);
    assert.deepEqual(
      cards.map(({ title }) => title),
      ['updated', 'second', 'last'],
    );
  } finally {
    env.dispose();
  }
});

test('a task aggregate denial evicts cached pages', async () => {
  const env = await integration();
  try {
    const options = tasksOptions(env.data, env.identity, {}, 'UTC');
    env.data.queryClient.setQueryData(options.queryKey, {
      pages: [],
      pageParams: [],
    });
    env.respond(() => Promise.resolve(json({}, 403)));
    await env.data.queryClient
      .fetchInfiniteQuery(options)
      .catch(() => undefined);
    assert.equal(
      env.data.queryClient.getQueryData(options.queryKey),
      undefined,
    );
  } finally {
    env.dispose();
  }
});
