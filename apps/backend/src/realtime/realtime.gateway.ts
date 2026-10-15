import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
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
    this.auth.cleanup(socket);
  }
}
