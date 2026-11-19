import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFullMyTasksEnvelope } from '../../src/features/tasks/decoder.ts';
import {
  createTasksApi,
  normalizeTaskFilters,
} from '../../src/features/tasks/api.ts';
import {
  integration,
  json,
  BOARD,
  WORKSPACE,
  CARD,
} from '../realtime/integration-support.ts';

export const task = {
  id: CARD,
  boardId: BOARD,
  workspaceId: WORKSPACE,
  columnId: '00000000-0000-4000-8000-000000000090',
  title: 'Assigned card',
  boardName: 'Design',
  workspaceName: 'Team',
  startDate: null,
  dueDate: null,
  updatedAt: '2026-11-19T00:00:00.000Z',
  group: 'NO_DUE_DATE',
  permalink: `/boards/${BOARD}/cards/${CARD}`,
  labels: [],
};
export const response = {
  success: true,
  statusCode: 200,
  message: 'OK',
  data: [task],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  groupCounts: { OVERDUE: 0, NEXT_7_DAYS: 0, LATER: 0, NO_DUE_DATE: 1 },
};

test('My Tasks decoder validates complete counts, page shape and canonical Card paths', () => {
  assert.deepEqual(decodeFullMyTasksEnvelope(response), response);
  for (const bad of [
    { ...response, groupCounts: undefined },
    { ...response, groupCounts: { ...response.groupCounts, OVERDUE: -1 } },
    { ...response, success: false },
    { ...response, statusCode: 201 },
    { ...response, meta: { ...response.meta, totalPages: 2 } },
    { ...response, data: [{ ...task, group: 'OVERDUE' }] },
    { ...response, data: [{ ...task, permalink: 'https://evil.test/card' }] },
    {
      ...response,
      data: [{ ...task, labels: [{ id: BOARD, name: 'Bug', color: 'red' }] }],
    },
    { ...response, data: [{ ...task, title: '' }] },
    { ...response, data: [task, task], meta: { ...response.meta, total: 2 } },
  ])
    assert.throws(() => decodeFullMyTasksEnvelope(bad));
});
test('My Tasks keeps top-level groupCounts through session rawJson and sends normalized filters', async () => {
  const env = await integration();
  env.respond((url) => {
    const query = new URL(url);
    assert.equal(query.pathname, '/api/users/me/tasks');
    assert.equal(query.searchParams.get('limit'), '20');
    assert.equal(query.searchParams.get('group'), 'ALL');
    assert.equal(query.searchParams.get('boardId'), BOARD);
    return Promise.resolve(json(response));
  });
  try {
    const result = await createTasksApi(env.data.api, env.identity).list(
      { boardId: BOARD },
      1,
      new AbortController().signal,
    );
    assert.deepEqual(result.groupCounts, response.groupCounts);
  } finally {
    env.dispose();
  }
});
test('task filters reject invalid IDs, unsupported groups, duplicate labels, and inverted instants', () => {
  for (const input of [
    { boardId: 'invalid' },
    { labelIds: [BOARD] },
    { boardId: BOARD, labelIds: [CARD, CARD] },
    { dueFrom: '2026-11-19' },
    { dueFrom: '2026-11-19T00:00:00Z', dueTo: '2026-11-18T00:00:00Z' },
  ])
    assert.throws(() => normalizeTaskFilters(input));
  assert.throws(() =>
    normalizeTaskFilters({ boardId: BOARD, labelIds: Array(51).fill(CARD) }),
  );
});
