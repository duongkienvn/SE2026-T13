import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  groupNotifications,
  notificationTime,
  compactUnread,
} from '../../src/features/notifications/grouping.ts';
import { notification } from './fixtures.ts';
const preferences = {
  timeZone: 'America/New_York',
  dateFormat: 'YYYY-MM-DD' as const,
};
test('Today/Yesterday use saved local calendar days across DST gap/fold rather than 24 hours', () => {
  const cases = [
    ['2026-03-09T04:30:00Z', '2026-03-08T05:30:00Z'],
    ['2026-11-02T05:30:00Z', '2026-11-01T04:30:00Z'],
    ['2026-11-02T04:30:00Z', '2026-11-01T03:30:00Z'],
  ];
  for (const [now, yesterday] of cases) {
    const groups = groupNotifications(
      [
        notification(2, { createdAt: now! }),
        notification(1, { createdAt: yesterday! }),
      ],
      preferences,
      new Date(now!),
    );
    assert.deepEqual(
      groups.map(({ label }) => label),
      ['Today', 'Yesterday'],
    );
  }
});
test('saved zone differs from device/UTC and pages concatenate without repeated day headings', () => {
  const now = new Date('2026-11-19T00:30:00Z');
  const rows = [
    notification(3, { createdAt: '2026-11-19T00:20:00Z' }),
    notification(2, { createdAt: '2026-11-18T23:00:00Z' }),
    notification(1, { createdAt: '2026-11-16T01:00:00Z' }),
  ];
  const groups = groupNotifications(rows, preferences, now);
  assert.deepEqual(
    groups.map(({ label }) => label),
    ['Today', '2026-11-15'],
  );
  assert.equal(groups[0]?.items.length, 2);
  assert.deepEqual(
    groups.flatMap(({ items }) => items).map(({ id }) => id),
    rows.map(({ id }) => id),
  );
  assert.ok(
    notificationTime(rows[0]!.createdAt, preferences).absolute.includes(
      'UTC−05:00',
    ),
  );
  assert.deepEqual([0, 99, 100, 101].map(compactUnread), [
    '0',
    '99',
    '99+',
    '99+',
  ]);
});
