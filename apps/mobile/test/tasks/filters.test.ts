import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  localDayStart,
  nextDay,
  taskDateFilters,
  emptyTaskSelection,
  selectWorkspace,
  selectBoard,
} from '../../src/features/tasks/filters.ts';
test('civil task range uses the next local midnight through DST and leap day', () => {
  const range = taskDateFilters(
    { ...emptyTaskSelection, dueFrom: '2026-03-08', dueThrough: '2026-03-08' },
    'America/New_York',
  );
  assert.equal(range.dueFrom, '2026-03-08T05:00:00.000Z');
  assert.equal(range.dueTo, '2026-03-09T04:00:00.000Z');
  assert.equal(
    localDayStart('2026-11-01', 'America/New_York'),
    '2026-11-01T04:00:00.000Z',
  );
  assert.equal(
    localDayStart('2026-11-02', 'America/New_York'),
    '2026-11-02T05:00:00.000Z',
  );
  assert.equal(nextDay('2028-02-29'), '2028-03-01');
  assert.equal(
    localDayStart('2028-02-29', 'Asia/Bangkok'),
    '2028-02-28T17:00:00.000Z',
  );
  assert.throws(() => nextDay('2026-02-29'));
  assert.throws(() =>
    taskDateFilters(
      {
        ...emptyTaskSelection,
        dueFrom: '2026-02-03',
        dueThrough: '2026-02-01',
      },
      'UTC',
    ),
  );
});
test('changing Workspace or Board clears dependent selections', () => {
  const selected = {
    ...emptyTaskSelection,
    workspaceId: 'one',
    boardId: 'board',
    labelIds: ['label'],
  };
  assert.deepEqual(selectWorkspace(selected, 'two'), {
    ...emptyTaskSelection,
    workspaceId: 'two',
    boardId: undefined,
  });
  assert.deepEqual(selectBoard(selected, 'new'), {
    ...selected,
    boardId: 'new',
    labelIds: [],
  });
});
