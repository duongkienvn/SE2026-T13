import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  SubscribeMessage,
} from '@nestjs/websockets';
import { RealtimeEvent, type BoardRoomAck } from '@kanban/shared';
import { BoardRoomService } from './board-room.service';
import { BoardRoomCoordinator } from './board-room-coordinator.service';
import { RealtimeAuthService } from './realtime-auth.service';
import type { RealtimeServer, RealtimeSocket } from './realtime.types';

@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly coordinator: BoardRoomCoordinator,
    private readonly rooms: BoardRoomService,
  ) {}

  afterInit(server: RealtimeServer): void {
    this.coordinator.server = server;
    server.use((socket, next) => {
      void this.auth.authenticate(socket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });
  }

  handleConnection(socket: RealtimeSocket): void {
    this.auth.connected(socket);
    // Business commands use REST; no forged server event can become a mutation.
    socket.onAny((event: string, ...args: unknown[]) => {
      if (
        event === RealtimeEvent.BOARD_JOIN ||
        event === RealtimeEvent.BOARD_LEAVE
      )
        return;
      const acknowledge = args.at(-1);
      if (typeof acknowledge === 'function')
        acknowledge({
          success: false,
          code: this.auth.isActive(socket)
            ? 'VALIDATION_FAILED'
            : 'UNAUTHORIZED',
          message: 'Unsupported client event',
        });
    });
  }

  async handleDisconnect(socket: RealtimeSocket): Promise<void> {
    this.auth.cleanup(socket);
    await this.coordinator.disconnect(socket);
  }

  @SubscribeMessage(RealtimeEvent.BOARD_JOIN)
  join(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() request: unknown,
  ): Promise<BoardRoomAck> {
    return this.rooms.join(socket, request);
  }

  @SubscribeMessage(RealtimeEvent.BOARD_LEAVE)
  leave(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() request: unknown,
  ): Promise<BoardRoomAck> {
    return this.rooms.leave(socket, request);
  }
}
