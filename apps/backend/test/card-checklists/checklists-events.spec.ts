import { Repository } from 'typeorm';
import { Board } from '../../src/api/boards/entities/board.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import { CardChecklist } from '../../src/api/cards/entities/card-checklist.entity';
import { CardChecklistsService } from '../../src/api/cards/card-checklists.service';
import { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';
import { RealtimeBroadcastService } from '../../src/realtime/realtime-broadcast.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('Checklist post-commit invalidation', () => {
  function harness(failCommit = false, failTransport = false) {
    let committed = false;
    const row = Object.assign(new CardChecklist(), {
      id: 'checklist',
      cardId: 'card',
      title: 'Before',
      position: '100.0000000000',
      items: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const checklists = {
      findOne: jest.fn(async () => row),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === Card
          ? {
              findOne: async () => ({
                id: 'card',
                boardId: 'board',
                columnId: 'column',
                isArchived: false,
              }),
            }
          : checklists,
    };
    const transaction = jest.fn(async (callback) => {
      const result = await callback(manager);
      if (failCommit) throw new Error('rollback');
      committed = true;
      return result;
    });
    const emitToBoard = jest.fn(async () => {
      expect(committed).toBe(true);
      if (failTransport) throw new Error('private transport');
      return true;
    });
    const publisher = new BoardEventPublisher({
      emitToBoard,
    } as unknown as RealtimeBroadcastService);
    const service = new CardChecklistsService(
      { manager: { transaction } } as unknown as Repository<Board>,
      { requireMember: jest.fn() } as unknown as BoardAuthorizationService,
      publisher,
    );
    return { service, emitToBoard, checklists };
  }
  it('emits minimal IDs only after successful commit', async () => {
    const h = harness();
    await h.service.rename('user', 'board', 'card', 'checklist', {
      title: 'After',
    });
    expect(h.emitToBoard.mock.calls).toEqual([
      [
        'board',
        'card:updated',
        { boardId: 'board', cardId: 'card', columnId: 'column' },
      ],
    ]);
  });
  it('does not publish or save for an effective no-op', async () => {
    const h = harness();
    await h.service.rename('user', 'board', 'card', 'checklist', {
      title: 'Before',
    });
    expect(h.emitToBoard).not.toHaveBeenCalled();
    expect(h.checklists.save).not.toHaveBeenCalled();
  });
  it('does not publish if the transaction fails at commit', async () => {
    const h = harness(true);
    await expect(
      h.service.rename('user', 'board', 'card', 'checklist', {
        title: 'After',
      }),
    ).rejects.toThrow('rollback');
    expect(h.emitToBoard).not.toHaveBeenCalled();
  });
  it('preserves the committed result when transport throws', async () => {
    const h = harness(false, true);
    await expect(
      h.service.rename('user', 'board', 'card', 'checklist', {
        title: 'After',
      }),
    ).resolves.toMatchObject({ title: 'After' });
  });
});
