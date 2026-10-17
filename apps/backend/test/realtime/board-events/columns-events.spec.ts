import { Repository } from 'typeorm';
import { ColumnsService } from '../../../src/api/columns/columns.service';
import { BoardColumn } from '../../../src/api/columns/entities/board-column.entity';
import { Board } from '../../../src/api/boards/entities/board.entity';
import { Card } from '../../../src/api/cards/entities/card.entity';
import { BoardAuthorizationService } from '../../../src/api/board-members/board-authorization.service';
import { BoardEventPublisher } from '../../../src/realtime/board-event-publisher.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const boardId = 'board';
const columnId = 'column';

function harness() {
  const column = Object.assign(new BoardColumn(), {
    id: columnId,
    boardId,
    name: 'Todo',
    position: '100.0000000000',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const second = Object.assign(new BoardColumn(), {
    ...column,
    id: 'second',
    position: '200.0000000000',
  });
  const columns = {
    findOne: jest.fn().mockResolvedValue(column),
    find: jest.fn().mockResolvedValue([column, second]),
    create: jest.fn((input) => ({ ...column, ...input })),
    save: jest.fn(async (value) => value),
    remove: jest.fn(async (value) => {
      value.id = undefined;
    }),
  };
  const cards = { count: jest.fn().mockResolvedValue(0) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === BoardColumn ? columns : cards,
  };
  const publish = jest.fn().mockResolvedValue(undefined);
  const transaction = jest.fn(async (callback) => {
    const result = await callback(manager);
    expect(publish).not.toHaveBeenCalled(); // callback finished, commit has not resolved
    return result;
  });
  const authorization = { requireMember: jest.fn().mockResolvedValue({}) };
  const service = new ColumnsService(
    columns as unknown as Repository<BoardColumn>,
    { manager: { transaction } } as unknown as Repository<Board>,
    cards as unknown as Repository<Card>,
    authorization as unknown as BoardAuthorizationService,
    { publish } as unknown as BoardEventPublisher,
    {
      record: jest.fn(),
    } as unknown as import('../../../src/api/activities/activity-writer.service').ActivityWriterService,
  );
  return {
    service,
    column,
    columns,
    cards,
    transaction,
    manager,
    authorization,
    publish,
  };
}

describe('Column post-commit events', () => {
  it.each(['create', 'rename', 'move', 'remove'] as const)(
    'does not publish %s if transaction rejects after writes',
    async (operation) => {
      const h = harness();
      h.transaction.mockImplementation(async (callback) => {
        await callback(h.manager);
        throw new Error('commit failed');
      });
      const args = ['actor', boardId, columnId] as const;
      const mutation =
        operation === 'create'
          ? h.service.create('actor', boardId, { name: 'New' })
          : operation === 'rename'
            ? h.service.rename(...args, { name: 'New' })
            : operation === 'move'
              ? h.service.move(...args, { beforeColumnId: null })
              : h.service.remove(...args);
      await expect(mutation).rejects.toThrow('commit failed');
      expect(h.publish).not.toHaveBeenCalled();
    },
  );
  it.each(['create', 'rename', 'move', 'remove'] as const)(
    'emits once after %s commits with only authoritative IDs',
    async (operation) => {
      const h = harness();
      const args = ['actor', boardId, columnId] as const;
      if (operation === 'create')
        await h.service.create('actor', boardId, { name: 'New' });
      else if (operation === 'rename')
        await h.service.rename(...args, { name: 'New' });
      else if (operation === 'move')
        await h.service.move(...args, { beforeColumnId: null });
      else await h.service.remove(...args);
      expect(h.publish.mock.calls).toEqual([
        [
          `column:${{ create: 'created', rename: 'updated', move: 'moved', remove: 'deleted' }[operation]}`,
          { boardId, columnId },
        ],
      ]);
    },
  );

  it.each(['rename', 'move'] as const)(
    'suppresses unchanged %s',
    async (operation) => {
      const h = harness();
      if (operation === 'rename')
        await h.service.rename('actor', boardId, columnId, { name: 'Todo' });
      else
        await h.service.move('actor', boardId, columnId, {
          beforeColumnId: 'second',
        });
      expect(h.publish).not.toHaveBeenCalled();
      expect(h.columns.save).not.toHaveBeenCalled();
    },
  );

  it.each(['authorization', 'nonempty', 'rollback'] as const)(
    'suppresses %s failure',
    async (failure) => {
      const h = harness();
      if (failure === 'authorization')
        h.authorization.requireMember.mockRejectedValue(new Error('denied'));
      if (failure === 'nonempty') h.cards.count.mockResolvedValue(1);
      if (failure === 'rollback')
        h.transaction.mockImplementation(async (callback) => {
          await callback(h.manager);
          throw new Error('commit failed');
        });
      await expect(
        h.service.remove('actor', boardId, columnId),
      ).rejects.toThrow();
      expect(h.publish).not.toHaveBeenCalled();
    },
  );
});
