import type { RealtimeServerEvents } from '@kanban/shared';
import { Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Socket } from 'socket.io';
import { BoardRoomCoordinator } from './board-room-coordinator.service';
import { RealtimeAuthService } from './realtime-auth.service';

type EventArguments<Event extends keyof RealtimeServerEvents> =
  RealtimeServerEvents[Event] extends (...args: infer Args) => void
    ? Args
    : never;

@Injectable()
export class RealtimeBroadcastService {
  private readonly logger = new Logger(RealtimeBroadcastService.name);

  constructor(
    private readonly coordinator: BoardRoomCoordinator,
    private readonly auth: RealtimeAuthService,
  ) {}

  /** Call after commit, outside coordinator.run(). Failures never undo persistence. */
  async emitToBoard<Event extends keyof RealtimeServerEvents & string>(
    boardId: string,
    event: Event,
    ...args: EventArguments<Event>
  ): Promise<boolean> {
    try {
      if (!isUUID(boardId)) throw new Error('Invalid board identifier');
      return await this.coordinator.run(boardId, () => {
        const server = this.coordinator.server;
        if (!server) return false;
        const canonicalId = boardId.toLowerCase();
        for (const socket of server.sockets.sockets.values()) {
          if (
            socket.data.authorizedBoardIds?.has(canonicalId) &&
            this.auth.isActive(socket)
          ) {
            // Select recipients from application grants, independently of stale
            // adapter rooms after leave/disconnect failures. Recovery is disabled,
            // so this direct emit does not ask the adapter to choose recipients.
            (socket as Socket).emit(event, ...args);
          }
        }
        return true;
      });
    } catch {
      // Never log the error object, event name, token or business payload.
      this.logger.error('Board realtime broadcast failed');
      return false;
    }
  }
}
