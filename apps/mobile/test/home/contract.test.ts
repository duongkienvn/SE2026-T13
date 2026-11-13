import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskGroup } from '@kanban/shared';
import { decodeHomeDashboard } from '../../src/features/home/decoder.ts';
import {
  boardPath,
  cardPath,
  dueLabel,
  greeting,
} from '../../src/features/home/presentation.ts';
import {
  boardPresetColor,
  isBoardPreset,
} from '../../src/features/home/presets.ts';
import { boardId, cardId, emptyHome, fixture } from './fixtures.ts';

test('decodes and allowlists the shared response, preserves server order and cross-list membership', () => {
  const valid = fixture();
  valid.upNext.unshift({
    ...valid.upNext[0]!,
    id: boardId,
    permalink: `/boards/${boardId}/cards/${boardId}`,
    title: 'First from server',
  });
  const raw = structuredClone(valid);
  Object.assign(raw, { token: 'private' });
  Object.assign(raw.upNext[0]!, { privateNotes: 'private' });
  Object.assign(raw.starredBoards[0]!, { unsafeImage: 'https://other.test' });
  assert.deepEqual(decodeHomeDashboard(raw), valid);
  assert.deepEqual(decodeHomeDashboard(emptyHome()), emptyHome());
});

test('rejects malformed counts, shapes, enums, ISO instants, limits, UUIDs and routes', () => {
  type Mutator = (value: ReturnType<typeof fixture>) => void;
  const corrupt: [string, Mutator][] = [
    [
      'negative count',
      (x) => {
        x.summary.overdueCount = -1;
      },
    ],
    [
      'fractional count',
      (x) => {
        x.summary.workspaceCount = 0.1;
      },
    ],
    [
      'unsafe count',
      (x) => {
        x.summary.assignedActiveCount = Infinity;
      },
    ],
    [
      'string count',
      (x) => Object.assign(x.summary, { dueNext7DaysCount: '5' }),
    ],
    ['missing list', (x) => Reflect.deleteProperty(x, 'recentBoards')],
    ['non-array list', (x) => Object.assign(x, { upNext: {} })],
    [
      'too many tasks',
      (x) => {
        x.upNext = Array(7).fill(x.upNext[0]);
      },
    ],
    ['duplicate task', (x) => x.upNext.push(x.upNext[0]!)],
    [
      'invalid workspace ID',
      (x) => {
        x.upNext[0]!.workspaceId = 'bad';
      },
    ],
    [
      'newline ID',
      (x) => {
        x.upNext[0]!.columnId += '\n';
      },
    ],
    [
      'invalid group',
      (x) => Object.assign(x.upNext[0]!, { group: 'COMPLETED' }),
    ],
    [
      'null due with due group',
      (x) => {
        x.upNext[0]!.dueDate = null;
      },
    ],
    [
      'normalized impossible date',
      (x) => {
        x.upNext[0]!.dueDate = '2026-02-30T09:00:00.000Z';
      },
    ],
    [
      'ambiguous date',
      (x) => {
        x.upNext[0]!.updatedAt = '2026-11-13';
      },
    ],
    [
      'label color',
      (x) => {
        x.upNext[0]!.labels[0]!.color = '#ffffff\n';
      },
    ],
    [
      'bad permalink',
      (x) => {
        x.upNext[0]!.permalink = '//another.test';
      },
    ],
    [
      'mismatched path',
      (x) => {
        x.starredBoards[0]!.path = `/boards/${cardId}`;
      },
    ],
    [
      'unknown preset',
      (x) =>
        Object.assign(x.starredBoards[0]!, { backgroundPreset: 'constructor' }),
    ],
    [
      'missing recent date',
      (x) => {
        x.recentBoards[0]!.lastViewedAt = null;
      },
    ],
    [
      'unstarred in starred list',
      (x) => {
        x.starredBoards[0]!.isStarred = false;
      },
    ],
  ];
  for (const [label, mutate] of corrupt) {
    const value = fixture();
    mutate(value);
    assert.throws(
      () => decodeHomeDashboard(value),
      /Invalid Home dashboard/,
      label,
    );
  }
  for (const bad of [null, [], 'home', {}])
    assert.throws(() => decodeHomeDashboard(bad));
});

test('route builders use only canonical IDs and never use response hyperlinks', () => {
  const data = fixture();
  data.upNext[0]!.permalink = 'https://another.test';
  data.starredBoards[0]!.path = '/settings';
  assert.equal(cardPath(data.upNext[0]!), `/boards/${boardId}/cards/${cardId}`);
  assert.equal(boardPath(data.starredBoards[0]!), `/boards/${boardId}`);
  assert.equal(cardPath({ id: '%2f', boardId }), null);
  assert.equal(boardPath({ id: 'https://another.test' }), null);
});

test('uses device calendar days for presentation without reclassifying server due groups', () => {
  const now = new Date(2026, 10, 13, 16);
  const today = new Date(2026, 10, 13, 0).toISOString();
  const tomorrow = new Date(2026, 10, 14, 0).toISOString();
  assert.equal(greeting('  Taylor Morgan ', now), 'Good afternoon, Taylor');
  assert.equal(greeting('', new Date(2026, 10, 13, 8)), 'Good morning');
  assert.equal(
    dueLabel({ dueDate: today, group: TaskGroup.NEXT_7_DAYS }, now),
    'Today',
  );
  assert.equal(
    dueLabel({ dueDate: tomorrow, group: TaskGroup.NEXT_7_DAYS }, now),
    'Tomorrow',
  );
  assert.match(
    dueLabel({ dueDate: tomorrow, group: TaskGroup.OVERDUE }, now),
    /^Overdue/,
  );
  assert.match(
    dueLabel({ dueDate: tomorrow, group: TaskGroup.LATER }, now),
    /^Later/,
  );
  assert.equal(
    dueLabel({ dueDate: null, group: TaskGroup.NO_DUE_DATE }, now),
    'No due date',
  );
  assert.equal(isBoardPreset('forest'), true);
  assert.equal(isBoardPreset('toString'), false);
  assert.equal(boardPresetColor(null, '#fff'), '#fff');
  assert.equal(boardPresetColor('indigo', '#fff'), '#4F46E5');
});
