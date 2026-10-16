import { RealtimeServerEvent, type RealtimeServerEvents } from '@kanban/shared';
import { Injectable, Logger } from '@nestjs/common';
import { RealtimeBroadcastService } from './realtime-broadcast.service';

type BusinessEvent =
  (typeof RealtimeServerEvent)[keyof typeof RealtimeServerEvent];

/** Business services call this only after their transaction/eviction resolves. */
@Injectable()
export class BoardEventPublisher {
  private readonly logger = new Logger(BoardEventPublisher.name);

  constructor(private readonly broadcast: RealtimeBroadcastService) {}

  async publish<Event extends BusinessEvent>(
    event: Event,
    ...args: Parameters<RealtimeServerEvents[Event]>
  ): Promise<void> {
    try {
      args[0].boardId = args[0].boardId.toLowerCase();
      const delivered = await this.broadcast.emitToBoard(
        args[0].boardId,
        event,
        ...args,
      );
      if (!delivered) this.logger.warn('Board event delivery unavailable');
    } catch {
      // Also protect committed REST results if a broadcaster implementation throws.
      this.logger.error('Board event delivery failed');
    }
  }
}
