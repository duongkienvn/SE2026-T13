import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { boardRoom, type RealtimeServer } from './realtime.types';
import { BoardPresenceService } from './board-presence.service';

/** Single-process ordering boundary for room access, removal and broadcast. */
@Injectable()
export class BoardRoomCoordinator implements OnApplicationShutdown {
  private readonly logger = new Logger(BoardRoomCoordinator.name);
  private readonly pending = new Map<string, Promise<void>>();
  server?: RealtimeServer;

  constructor(readonly presence: BoardPresenceService) {}

  /** Caller already holds this board's queue. No nested run()/async broadcast. */
  syncPresence(boardId: string): void {
    this.presence.sync(boardId, this.server);
  }

  /** Called after removal commits, while still holding this board's queue. */
  async evictUser(boardId: string, userId: string): Promise<void> {
    const server = this.server;
    if (!server) return;
    const canonicalId = boardId.toLowerCase();
    const room = boardRoom(canonicalId);
    const sockets = [...server.sockets.sockets.values()].filter(
      (socket) => socket.data.identity?.userId === userId,
    );
    // Revoke all receive grants before the first asynchronous adapter operation.
    for (const socket of sockets)
      socket.data.authorizedBoardIds?.delete(canonicalId);
    for (const socket of sockets) {
      try {
        await socket.leave(room);
      } catch {
        this.logger.error('Board room eviction failed; disconnecting socket');
        try {
          socket.disconnect(true);
        } catch {
          // The connection may remain open, but our broadcast boundary no longer
          // selects it for this board. Do not turn a committed removal into 500.
          this.logger.error(
            'Socket disconnect failed; board receive access remains revoked',
          );
        }
      }
    }
  }

  async run<T>(boardId: string, operation: () => Promise<T> | T): Promise<T> {
    const key = boardId.toLowerCase();
    const previous = this.pending.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pending.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.pending.get(key) === current) this.pending.delete(key);
    }
  }

  onApplicationShutdown(): void {
    this.server = undefined;
  }
}
