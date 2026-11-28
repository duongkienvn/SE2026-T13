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

const bangkok = { timeZone: 'Asia/Bangkok', dateFormat: 'DD/MM/YYYY' } as const;
const losAngeles = {
  timeZone: 'America/Los_Angeles',
  dateFormat: 'MM/DD/YYYY',
} as const;
const upcoming = (dueDate: string) => ({
  dueDate,
  group: TaskGroup.NEXT_7_DAYS,
});

test('F01: relative and absolute due labels use the saved account timezone, never the device', () => {
  // Device America/Los_Angeles sees Nov 27 vs Nov 28; both are Nov 28 in Bangkok.
  const now = new Date('2026-11-27T17:30:00.000Z');
  const due = '2026-11-28T08:00:00.000Z';
  assert.equal(dueLabel(upcoming(due), now, bangkok), 'Today');
  assert.equal(dueLabel(upcoming(due), now, losAngeles), 'Tomorrow');
  assert.equal(
    dueLabel(upcoming('2026-11-28T17:00:00.000Z'), now, bangkok),
    'Tomorrow',
  );
  assert.equal(
    dueLabel(upcoming('2026-12-01T08:00:00.000Z'), now, bangkok),
    'Next 7 days · 01/12/2026',
  );
  assert.equal(
    dueLabel(upcoming('2026-12-01T08:00:00.000Z'), now, losAngeles),
    'Next 7 days · 12/01/2026',
  );
  assert.equal(
    dueLabel(upcoming('2026-12-01T08:00:00.000Z'), now, {
      timeZone: 'UTC',
      dateFormat: 'YYYY-MM-DD',
    }),
    'Next 7 days · 2026-12-01',
  );
});

test('account midnight and DST transitions move Today/Tomorrow on the account calendar', () => {
  const due = '2026-11-28T08:00:00.000Z';
  // 23:59:59 and 00:00 Bangkok (UTC+7) straddle the account midnight.
  assert.equal(
    dueLabel(upcoming(due), new Date('2026-11-27T16:59:59.000Z'), bangkok),
    'Tomorrow',
  );
  assert.equal(
    dueLabel(upcoming(due), new Date('2026-11-27T17:00:00.000Z'), bangkok),
    'Today',
  );
  // US DST ends 2026-11-01: the 25-hour day still yields exactly one "Tomorrow".
  const dstNow = new Date('2026-11-01T06:30:00.000Z'); // 23:30 PDT Oct 31
  assert.equal(
    dueLabel(upcoming('2026-11-02T07:30:00.000Z'), dstNow, losAngeles),
    'Tomorrow', // 23:30 PST Nov 1
  );
  assert.equal(
    dueLabel(upcoming('2026-11-02T08:30:00.000Z'), dstNow, losAngeles),
    'Next 7 days · 11/02/2026',
  );
});

test('server groups are never reclassified and the greeting uses the account hour', () => {
  const now = new Date('2026-11-27T17:30:00.000Z');
  const due = '2026-11-28T08:00:00.000Z';
  assert.match(
    dueLabel({ dueDate: due, group: TaskGroup.OVERDUE }, now, bangkok),
    /^Overdue · 28\/11\/2026$/,
  );
  assert.match(
    dueLabel({ dueDate: due, group: TaskGroup.LATER }, now, bangkok),
    /^Later/,
  );
  assert.equal(
    dueLabel({ dueDate: null, group: TaskGroup.NO_DUE_DATE }, now, bangkok),
    'No due date',
  );
  // 00:30 in Bangkok, 09:30 the previous day in Los Angeles.
  assert.equal(
    greeting('  Taylor Morgan ', now, bangkok),
    'Good evening, Taylor',
  );
  assert.equal(greeting('Taylor', now, losAngeles), 'Good morning, Taylor');
  assert.equal(
    greeting('', new Date('2026-11-27T08:00:00.000Z'), bangkok),
    'Good afternoon',
  );
  assert.equal(greeting('Taylor', now, undefined), 'Welcome, Taylor');
  assert.equal(greeting('', now, undefined), 'Welcome');
});

test('route and preset helpers', () => {
  assert.equal(isBoardPreset('forest'), true);
  assert.equal(isBoardPreset('toString'), false);
  assert.equal(boardPresetColor(null, '#fff'), '#fff');
  assert.equal(boardPresetColor('indigo', '#fff'), '#4F46E5');
});
