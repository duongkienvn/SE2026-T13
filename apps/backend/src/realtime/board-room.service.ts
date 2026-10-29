import type { BoardRoomAck, BoardRoomRequest } from '@kanban/shared';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { BoardAuthorizationService } from '../api/board-members/board-authorization.service';
import { BoardRoomCoordinator } from './board-room-coordinator.service';
import { BoardRoomRateLimiter } from './board-room-rate-limiter.service';
import { RealtimeAuthService } from './realtime-auth.service';
import { boardRoom, type RealtimeSocket } from './realtime.types';

function isRoomRequest(input: unknown): input is BoardRoomRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    'boardId' in input &&
    typeof input.boardId === 'string' &&
    isUUID(input.boardId)
  );
}

@Injectable()
export class BoardRoomService {
  private readonly logger = new Logger(BoardRoomService.name);

  constructor(
    private readonly authorization: BoardAuthorizationService,
    private readonly auth: RealtimeAuthService,
    private readonly coordinator: BoardRoomCoordinator,
    private readonly limiter: BoardRoomRateLimiter,
  ) {}

  join(socket: RealtimeSocket, request: unknown): Promise<BoardRoomAck> {
    return this.change(socket, request, true);
  }

  leave(socket: RealtimeSocket, request: unknown): Promise<BoardRoomAck> {
    return this.change(socket, request, false);
  }

  private async change(
    socket: RealtimeSocket,
    request: unknown,
    join: boolean,
  ): Promise<BoardRoomAck> {
    if (!this.auth.isActive(socket)) return this.unauthorized();
    const release = this.limiter.acquire(socket.data.identity!.userId);
    if (!release) {
      return {
        success: false,
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many board room requests',
      };
    }
    try {
      if (!isRoomRequest(request)) {
        return {
          success: false,
          code: 'VALIDATION_FAILED',
          message: 'A boardId UUID is required',
        };
      }
      const boardId = request.boardId.toLowerCase();
      const changeRoom = (): Promise<BoardRoomAck> =>
        this.coordinator.run(boardId, async (): Promise<BoardRoomAck> => {
          if (!this.auth.isActive(socket)) return this.unauthorized();
          if (join) {
            await this.authorization.requireRead(
              socket.data.identity!.userId,
              boardId,
            );
            if (!this.auth.isActive(socket)) return this.unauthorized();
            try {
              await socket.join(boardRoom(boardId));
            } catch (error) {
              socket.data.authorizedBoardIds?.delete(boardId);
              this.coordinator.presence.remove(boardId, socket.id);
              this.coordinator.syncPresence(boardId);
              throw error;
            }
            if (!this.auth.isActive(socket)) {
              socket.data.authorizedBoardIds?.delete(boardId);
              this.coordinator.presence.remove(boardId, socket.id);
              this.coordinator.syncPresence(boardId);
              await socket.leave(boardRoom(boardId));
              return this.unauthorized();
            }
            (socket.data.authorizedBoardIds ??= new Set()).add(boardId);
            this.coordinator.presence.add(
              boardId,
              socket.data.identity!.userId,
              socket.id,
            );
            // Initial snapshot precedes the unchanged join ACK.
            this.coordinator.syncPresence(boardId);
          } else {
            // Stop delivery even if the adapter fails to remove physical membership.
            socket.data.authorizedBoardIds?.delete(boardId);
            this.coordinator.presence.remove(boardId, socket.id);
            this.coordinator.syncPresence(boardId);
            await socket.leave(boardRoom(boardId));
          }
          return { success: true, boardId };
        });
      return await (join
        ? this.coordinator.withReadGrantChanges(changeRoom)
        : changeRoom());
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) {
        return {
          success: false,
          code: 'NOT_FOUND',
          message: 'Board not found',
        };
      }
      this.logger.error('Board room operation failed');
      return {
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Unable to update board room',
      };
    } finally {
      release();
    }
  }

  private unauthorized(): BoardRoomAck {
    return { success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' };
  }
}
