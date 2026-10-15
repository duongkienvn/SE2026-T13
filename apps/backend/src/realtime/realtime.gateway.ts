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
  }

  handleDisconnect(socket: RealtimeSocket): void {
    socket.data.authorizedBoardIds?.clear();
    this.auth.cleanup(socket);
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
