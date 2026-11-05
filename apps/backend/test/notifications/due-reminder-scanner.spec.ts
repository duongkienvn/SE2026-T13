import type { DataSource, EntityManager } from 'typeorm';
import { DueReminderScanner } from '../../src/api/notifications/due-reminder-scanner.service';
import type { NotificationService } from '../../src/api/notifications/notification.service';
import type { NotificationEventPublisher } from '../../src/realtime/notification-event-publisher.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

const candidate = {
  card_id: 'card',
  board_id: 'board',
  user_id: 'user',
  due_date: new Date('2026-01-02T12:00:00Z'),
  due_cursor: '2026-01-02 12:00:00+00',
  time_zone: 'UTC',
  current_time: new Date('2026-01-01T08:59:59.999Z'),
};
const setup = () => {
  const query = jest.fn().mockResolvedValue([]);
  const locked = jest.fn().mockResolvedValue([]);
  const manager = {
    query: locked,
    getRepository: () => ({ findOne: async () => ({ id: 'user' }) }),
  };
  const transaction = jest.fn(
    (work: (manager: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
  );
  const record = jest.fn();
  const afterCommit = jest.fn();
  const scanner = new DueReminderScanner(
    { query, transaction } as unknown as DataSource,
    { record } as unknown as NotificationService,
    { afterCommit } as unknown as NotificationEventPublisher,
  );
  return { scanner, query, transaction, locked, record, afterCommit };
};

describe('due reminder prefilter', () => {
  it('skips future work without any domain lock and advances/reset the cursor across pages', async () => {
    const { scanner, query, transaction } = setup();
    query
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate]);
    await scanner.scan(1);
    expect(transaction).not.toHaveBeenCalled();
    await scanner.scan(1);
    expect(query.mock.calls[1][1]).toEqual([
      candidate.due_cursor,
      'card',
      'user',
      1,
    ]);
    await scanner.scan(1);
    expect(query.mock.calls[2][1]).toEqual([null, null, null, 1]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['2026-01-01T09:00:00.000Z', '2026-01-01T09:00:00.001Z'])(
    'takes the transaction at/after the database-time boundary %s',
    async (currentTime) => {
      const { scanner, query, transaction } = setup();
      query.mockResolvedValue([
        { ...candidate, current_time: new Date(currentTime) },
      ]);
      await scanner.scan(2);
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('retains the authoritative recheck if the due date/time zone changes after the preview', async () => {
    const { scanner, query, locked, record, afterCommit } = setup();
    query.mockResolvedValue([
      { ...candidate, current_time: new Date('2026-01-01T10:00:00Z') },
    ]);
    locked.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT id FROM boards')
        ? [{ id: 'board' }]
        : sql.includes('SELECT c.id AS card_id')
          ? [
              {
                ...candidate,
                due_date: new Date('2026-01-03T12:00:00Z'),
                current_time: new Date('2026-01-01T10:00:01Z'),
              },
            ]
          : [],
    );
    await scanner.scan(2);
    expect(record).not.toHaveBeenCalled();
    expect(afterCommit).not.toHaveBeenCalled();
    expect(
      locked.mock.calls.some(([sql]) =>
        String(sql).includes('clock_timestamp() AS current_time'),
      ),
    ).toBe(true);
  });
});
