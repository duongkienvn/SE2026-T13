import {
  dueReminderOccurrence,
  dueReminderSchedule,
} from '../../src/api/notifications/due-reminder-time';

describe('due reminder local calendar schedule', () => {
  it.each([
    ['UTC', '2026-04-10T03:00:00Z', '2026-04-10', '2026-04-09T09:00:00.000Z'],
    [
      'Asia/Ho_Chi_Minh',
      '2026-04-10T03:00:00Z',
      '2026-04-10',
      '2026-04-09T02:00:00.000Z',
    ],
    [
      'America/New_York',
      '2026-03-09T12:00:00Z',
      '2026-03-09',
      '2026-03-08T13:00:00.000Z',
    ],
    [
      'America/New_York',
      '2026-11-02T12:00:00Z',
      '2026-11-02',
      '2026-11-01T14:00:00.000Z',
    ],
    [
      'Pacific/Apia',
      '2011-12-30T20:00:00Z',
      '2011-12-31',
      '2011-12-30T10:00:00.000Z',
    ],
  ])(
    '%s uses the preceding local calendar day',
    (zone, due, localDate, eligibleAt) => {
      const result = dueReminderSchedule(new Date(due), zone);
      expect(result.localDueDate).toBe(localDate);
      expect(result.eligibleAt.toISOString()).toBe(eligibleAt);
    },
  );

  it('deduplicates by recipient, card and local date', () => {
    const first = dueReminderOccurrence('a', 'b', '2026-04-10');
    expect(dueReminderOccurrence('A', 'B', '2026-04-10')).toBe(first);
    expect(dueReminderOccurrence('a', 'b', '2026-04-11')).not.toBe(first);
  });
});
