import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCardDate,
  resolveWallTime,
  wallTime,
} from '../../src/features/cards/metadata/dates.ts';
import {
  formatInstantDate,
  formatTimeIn,
} from '../../../frontend/src/features/settings/format.ts';
import { groupNotifications } from '../../src/features/notifications/grouping.ts';
import { notification } from '../notifications/fixtures.ts';
import { cardsByDueDay } from '../../src/features/calendar/due-groups.ts';
import { monthDays } from '../../src/features/calendar/month-grid.ts';
import { weekDays } from '../../src/features/calendar/week.ts';
import { type KanbanCard } from '../../src/features/boards/kanban-api.ts';
import { integration, ok } from '../realtime/integration-support.ts';
import { preferencesCommands } from '../../src/features/preferences/commands.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { saved } from './fixtures.ts';
test('same-account Web and native timestamp projections agree without changing UTC source', () => {
  for (const timeZone of [
    'UTC',
    'Asia/Ho_Chi_Minh',
    'America/New_York',
    'Pacific/Kiritimati',
  ])
    for (const dateFormat of [
      'DD/MM/YYYY',
      'MM/DD/YYYY',
      'YYYY-MM-DD',
    ] as const)
      for (const instant of [
        '2024-02-29T00:30:00Z',
        '2026-03-08T06:30:00Z',
        '2026-03-08T07:30:00Z',
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
        '2026-12-31T23:30:00Z',
      ]) {
        const p = { ...saved, timeZone, dateFormat };
        assert.equal(
          describeCardDate(instant, p).short,
          `${formatInstantDate(new Date(instant), dateFormat, timeZone)} · ${formatTimeIn(new Date(instant), timeZone)}`,
        );
        assert.ok(
          resolveWallTime(wallTime(instant, timeZone), timeZone).includes(
            new Date(instant).toISOString(),
          ),
        );
      }
});
test('Inbox day grouping and Month/Week placement recompute for a new saved zone and weekday', () => {
  const instant = '2026-12-31T23:30:00Z',
    row = notification(1, { createdAt: instant });
  const cards = [{ id: row.id, dueDate: instant }] as KanbanCard[];
  for (const timeZone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York'])
    for (const weekStartsOn of ['monday', 'sunday'] as const) {
      const p = { ...saved, timeZone, weekStartsOn };
      const groups = cardsByDueDay(cards, timeZone);
      const day = [...groups.keys()][0]!;
      assert.equal(
        groupNotifications([row], p, new Date('2027-01-01T12:00:00Z'))[0]!.key,
        day,
      );
      assert.ok(monthDays(day.slice(0, 7), weekStartsOn).includes(day));
      assert.ok(weekDays(day, weekStartsOn).includes(day));
      assert.equal(groups.get(day)?.[0]?.id, row.id);
    }
  assert.equal(cards[0]!.dueDate, instant);
});
test('confirmed preference writes invalidate quiet-hours zone display without rewriting schedule', async () => {
  const env = await integration();
  const key = [...queryKeys.scope(env.identity), 'me', 'push-schedule'];
  const schedule = {
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timeZone: 'UTC',
  };
  env.data.queryClient.setQueryData(key, schedule);
  env.respond(() =>
    Promise.resolve(ok({ ...saved, timeZone: 'Asia/Ho_Chi_Minh' })),
  );
  await preferencesCommands(env.data, env.identity).save({
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  assert.equal(env.data.queryClient.getQueryState(key)?.isInvalidated, true);
  assert.deepEqual(env.data.queryClient.getQueryData(key), schedule);
  assert.equal(
    env.requests.some((r) => r.url.endsWith('push-schedule')),
    false,
  );
  env.dispose();
});
