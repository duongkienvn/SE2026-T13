import {
  RealtimePresenceEvent,
  type BoardPresenceSnapshot,
} from '@kanban/shared';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type { RealtimeServer, RealtimeSocket } from './realtime.types';

/** Single-process registry. Call mutations and sync while holding the board queue. */
@Injectable()
export class BoardPresenceService implements OnApplicationShutdown {
  private readonly logger = new Logger(BoardPresenceService.name);
  private readonly boards = new Map<string, Map<string, Set<string>>>();
  private readonly sockets = new Map<string, Map<string, string>>();

  add(boardId: string, userId: string, socketId: string): void {
    const board = boardId.toLowerCase();
    // One socket has exactly one authenticated identity.
    this.remove(board, socketId);
    const users = this.boards.get(board) ?? new Map<string, Set<string>>();
    const connections = users.get(userId) ?? new Set<string>();
    connections.add(socketId);
    users.set(userId, connections);
    this.boards.set(board, users);
    const memberships = this.sockets.get(socketId) ?? new Map<string, string>();
    memberships.set(board, userId);
    this.sockets.set(socketId, memberships);
  }

  remove(boardId: string, socketId: string): void {
    const board = boardId.toLowerCase();
    const memberships = this.sockets.get(socketId);
    const userId = memberships?.get(board);
    if (userId === undefined) return;
    const users = this.boards.get(board)!;
    const connections = users.get(userId)!;
    connections.delete(socketId);
    if (!connections.size) users.delete(userId);
    if (!users.size) this.boards.delete(board);
    memberships!.delete(board);
    if (!memberships!.size) this.sockets.delete(socketId);
  }

  removeUser(boardId: string, userId: string): void {
    const board = boardId.toLowerCase();
    for (const socketId of [...(this.boards.get(board)?.get(userId) ?? [])]) {
      this.remove(board, socketId);
    }
  }

  boardIds(socketId: string): string[] {
    return [...(this.sockets.get(socketId)?.keys() ?? [])];
  }

  snapshot(boardId: string): BoardPresenceSnapshot {
    const board = boardId.toLowerCase();
    return {
      boardId: board,
      userIds: [...(this.boards.get(board)?.keys() ?? [])].sort(),
    };
  }

  /**
   * Scoped synchronous delivery: never acquire the coordinator here. Prune stale
   * entries before constructing a snapshot and never await an emit. Thus an older
   * async adapter callback cannot publish a snapshot after a newer transition.
   */
  sync(boardId: string, server?: RealtimeServer): void {
    if (!server) return;
    const board = boardId.toLowerCase();
    const recipients: RealtimeSocket[] = [];
    for (const [userId, connections] of this.boards.get(board) ?? []) {
      for (const socketId of connections) {
        const socket = server.sockets.sockets.get(socketId);
        if (
          socket?.connected &&
          socket.data.identity?.userId === userId &&
          socket.data.identity.expiresAt > Date.now() &&
          socket.data.authorizedBoardIds?.has(board)
        ) {
          recipients.push(socket);
        } else {
          this.remove(board, socketId);
        }
      }
    }
    const snapshot = this.snapshot(board);
    for (const socket of recipients) {
      try {
        socket.emit(RealtimePresenceEvent.SYNC, snapshot);
      } catch {
        // A failed recipient must not prevent cleanup, other deliveries or REST success.
        this.logger.error('Board presence delivery failed');
      }
    }
  }

  onApplicationShutdown(): void {
    this.boards.clear();
    this.sockets.clear();
  }
}
