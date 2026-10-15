import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { boardRoom, type RealtimeServer } from './realtime.types';

/** Single-process ordering boundary for room access, removal and broadcast. */
@Injectable()
export class BoardRoomCoordinator implements OnApplicationShutdown {
  private readonly logger = new Logger(BoardRoomCoordinator.name);
  private readonly pending = new Map<string, Promise<void>>();
  server?: RealtimeServer;

  /** Called after removal commits, while still holding this board's queue. */
  async evictUser(boardId: string, userId: string): Promise<void> {
    const server = this.server;
    if (!server) return;
    const room = boardRoom(boardId);
    for (const socket of server.sockets.sockets.values()) {
      if (socket.data.identity?.userId !== userId || !socket.rooms.has(room))
        continue;
      try {
        await socket.leave(room);
      } catch {
        this.logger.error('Board room eviction failed; disconnecting socket');
        socket.disconnect(true);
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
