import { Repository } from 'typeorm';
import { Board } from '../../src/api/boards/entities/board.entity';
import { LabelsService } from '../../src/api/labels/labels.service';
import { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';
import { RealtimeBroadcastService } from '../../src/realtime/realtime-broadcast.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('Label catalog invalidation', () => {
  function harness(failCommit = false, failTransport = false) {
    let committed = false;
    const row = {
      id: 'label',
      boardId: 'board',
      name: 'Bug',
      color: '#ABCDEF',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const repository = {
      findOneBy: jest.fn(async () => row),
      save: jest.fn(async (value) => value),
    };
    const manager = { getRepository: () => repository };
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
    const events = new BoardEventPublisher({
      emitToBoard,
    } as unknown as RealtimeBroadcastService);
    const service = new LabelsService(
      { manager: { transaction } } as unknown as Repository<Board>,
      {
        requireMember: async () => ({ board: { id: 'board' } }),
      } as unknown as BoardAuthorizationService,
      events,
    );
    return { service, emitToBoard, repository };
  }
  it('publishes one ID-only Board event after commit without per-Card fanout', async () => {
    const h = harness();
    await h.service.update('user', 'board', 'label', { color: '#FFFFFF' });
    expect(h.emitToBoard.mock.calls).toEqual([
      ['board', 'labels:changed', { boardId: 'board', labelId: 'label' }],
    ]);
  });
  it('suppresses normalized no-ops and commit failures', async () => {
    const h = harness();
    await h.service.update('user', 'board', 'label', { color: ' #abcdef ' });
    expect(h.repository.save).not.toHaveBeenCalled();
    expect(h.emitToBoard).not.toHaveBeenCalled();
    const rollback = harness(true);
    await expect(
      rollback.service.update('user', 'board', 'label', { color: '#FFFFFF' }),
    ).rejects.toThrow('rollback');
    expect(rollback.emitToBoard).not.toHaveBeenCalled();
  });
  it('preserves success after transport failure', async () => {
    const h = harness(false, true);
    await expect(
      h.service.update('user', 'board', 'label', { color: '#FFFFFF' }),
    ).resolves.toMatchObject({ color: '#FFFFFF' });
  });
});
