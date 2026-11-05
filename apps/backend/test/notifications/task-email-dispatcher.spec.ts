import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { TaskEmailDispatcher } from '../../src/api/notifications/task-email-dispatcher.service';

describe('task email kind dispatch boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup(kind: unknown) {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      recipient_user_id: '00000000-0000-4000-8000-000000000002',
      board_id: '00000000-0000-4000-8000-000000000003',
      card_id: '00000000-0000-4000-8000-000000000004',
      kind,
      attempts: 0,
    };
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM users'))
        return [{ id: row.recipient_user_id }];
      if (sql.includes('SELECT u.email'))
        return [{ email: 'synthetic@example.test' }];
      if (sql.includes('SELECT count(*)')) return [{ count: '0' }];
      if (sql.includes('RETURNING id')) return [[{ id: row.id }], 1];
      return [];
    });
    const transaction = jest
      .fn()
      .mockResolvedValueOnce([[row], 1])
      .mockImplementation(
        async (work: (manager: { query: typeof query }) => unknown) =>
          work({ query }),
      );
    const dbQuery = jest.fn().mockResolvedValue([]);
    const mailer = { send: jest.fn().mockResolvedValue('SENT') };
    const dispatcher = new TaskEmailDispatcher(
      { query: dbQuery, transaction } as unknown as DataSource,
      mailer,
    );
    return { dispatcher, mailer, row, query, dbQuery };
  }

  it.each(['CARD_ASSIGNED', 'COMMENT_MENTIONED'])(
    'passes the claimed %s kind without adding private content',
    async (kind) => {
      const { dispatcher, mailer, row, dbQuery } = setup(kind);
      await dispatcher.drain(1);
      expect(mailer.send).toHaveBeenCalledWith({
        recipient: 'synthetic@example.test',
        kind,
        boardId: row.board_id,
        cardId: row.card_id,
        outboxId: row.id,
      });
      expect(dbQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('sent_at=CASE'),
        [row.id, expect.any(String), 'SENT', 1],
      );
    },
  );

  it.each(['BOARD_INVITED', 'UNKNOWN', '__proto__', null])(
    'cancels unsupported persisted kind %s without attempting provider delivery',
    async (kind) => {
      const { dispatcher, mailer, query } = setup(kind);
      await dispatcher.drain(1);
      expect(mailer.send).not.toHaveBeenCalled();
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining("SET status='CANCELLED'"),
        [expect.any(String), expect.any(String)],
      );
      expect(
        query.mock.calls.some(([sql]: [string]) =>
          sql.includes('attempts=attempts+1'),
        ),
      ).toBe(false);
    },
  );
});
