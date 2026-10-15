import type { RealtimeServerEvents } from '@kanban/shared';
import { Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Server } from 'socket.io';
import { BoardRoomCoordinator } from './board-room-coordinator.service';
import { RealtimeAuthService } from './realtime-auth.service';
import { boardRoom } from './realtime.types';

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
        const room = boardRoom(boardId);
        // A delayed timer must not allow even one post-expiration broadcast.
        for (const id of server.sockets.adapter.rooms.get(room) ?? []) {
          const socket = server.sockets.sockets.get(id);
          if (socket) this.auth.isActive(socket);
        }
        // The public API enforces F2's event map. Socket.IO's broadcast typings
        // additionally rewrite acknowledgement callbacks; this API is one-way.
        (server as Server).to(room).emit(event, ...args);
        return true;
      });
    } catch {
      // Never log the error object, event name, token or business payload.
      this.logger.error('Board realtime broadcast failed');
      return false;
    }
  }
}
