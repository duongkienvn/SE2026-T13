import { RealtimeServerEvent } from '@kanban/shared';
import { BoardEventPublisher } from '../../../src/realtime/board-event-publisher.service';
import { RealtimeBroadcastService } from '../../../src/realtime/realtime-broadcast.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('BoardEventPublisher', () => {
  const payload = { boardId: 'BOARD', columnId: 'column' };
  it.each([true, false, 'throw'] as const)(
    'preserves caller success when transport returns %s',
    async (outcome) => {
      const emitToBoard = jest.fn().mockImplementation(async () => {
        if (outcome === 'throw') throw new Error('private transport details');
        return outcome;
      });
      const publisher = new BoardEventPublisher({
        emitToBoard,
      } as unknown as RealtimeBroadcastService);
      const warn = jest.spyOn(publisher['logger'], 'warn').mockImplementation();
      const error = jest
        .spyOn(publisher['logger'], 'error')
        .mockImplementation();
      try {
        await expect(
          publisher.publish(RealtimeServerEvent.COLUMN_CREATED, payload),
        ).resolves.toBeUndefined();
        expect(emitToBoard).toHaveBeenCalledTimes(1);
        expect(emitToBoard).toHaveBeenCalledWith(
          'board',
          'column:created',
          payload,
        );
        expect(warn.mock.calls).toEqual(
          outcome === false ? [['Board event delivery unavailable']] : [],
        );
        expect(error.mock.calls).toEqual(
          outcome === 'throw' ? [['Board event delivery failed']] : [],
        );
      } finally {
        warn.mockRestore();
        error.mockRestore();
      }
    },
  );
});
