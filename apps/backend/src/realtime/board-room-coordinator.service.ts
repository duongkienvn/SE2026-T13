import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { RealtimeServerEvent, RealtimeAccessEvent } from '@kanban/shared';
import {
  boardRoom,
  type RealtimeServer,
  type RealtimeSocket,
} from './realtime.types';
import { BoardPresenceService } from './board-presence.service';

/** Single-process ordering boundary for room access, removal and broadcast. */
@Injectable()
export class BoardRoomCoordinator implements OnApplicationShutdown {
  private readonly logger = new Logger(BoardRoomCoordinator.name);
  private readonly pending = new Map<string, Promise<void>>();
  server?: RealtimeServer;

  constructor(readonly presence: BoardPresenceService) {}

  // shortcut: serialize joins with Workspace removal snapshots; partition by Workspace if join contention grows.
  withReadGrantChanges<T>(operation: () => Promise<T>): Promise<T> {
    return this.run('workspace-read-grants', operation);
  }

  /** Caller already holds this board's queue. No nested run()/async broadcast. */
  syncPresence(boardId: string): void {
    this.presence.sync(boardId, this.server);
  }

  notifyWorkspaceRevoked(workspaceId: string, userId: string): void {
    for (const socket of this.server?.sockets.sockets.values() ?? []) {
      if (socket.data.identity?.userId !== userId) continue;
      try {
        socket.emit(RealtimeAccessEvent.WORKSPACE_REVOKED, { workspaceId });
      } catch {
        this.logger.error('Workspace access notification failed');
      }
    }
  }

  /** Hold the board queue across the ACL transaction and this reconciliation. */
  async reconcileBoard(
    boardId: string,
    canRead: (userId: string) => Promise<boolean>,
  ): Promise<void> {
    const id = boardId.toLowerCase();
    const sockets = [...(this.server?.sockets.sockets.values() ?? [])].filter(
      (socket) => socket.data.authorizedBoardIds?.has(id),
    );
    const users = new Set(
      sockets.flatMap((socket) =>
        socket.data.identity ? [socket.data.identity.userId] : [],
      ),
    );
    const denied = new Set<string>();
    for (const userId of users) {
      try {
        if (!(await canRead(userId))) denied.add(userId);
      } catch {
        // Fail closed if the database cannot establish a remaining grant.
        denied.add(userId);
        this.logger.error(
          'Board access reconciliation failed; revoking receive grant',
        );
      }
    }
    // Remove every denied recipient before producing any Presence snapshot.
    for (const socket of sockets) {
      if (!socket.data.identity || denied.has(socket.data.identity.userId)) {
        socket.data.authorizedBoardIds?.delete(id);
        this.presence.remove(id, socket.id);
      }
    }
    for (const userId of denied) await this.evictUser(id, userId, true);
    this.syncPresence(id);
  }

  /** Sorted acquisition avoids cycles when a Workspace loses read grants. */
  runMany<T>(
    boardIds: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const ids = [...new Set(boardIds.map((id) => id.toLowerCase()))].sort();
    const acquire = (index: number): Promise<T> =>
      index === ids.length
        ? operation()
        : this.run(ids[index], () => acquire(index + 1));
    return acquire(0);
  }

  async disconnect(socket: RealtimeSocket): Promise<void> {
    const boards = new Set([
      ...this.presence.boardIds(socket.id),
      ...(socket.data.authorizedBoardIds ?? []),
    ]);
    // Revoke synchronously even when a join/leave currently holds a board queue.
    socket.data.authorizedBoardIds?.clear();
    await Promise.all(
      [...boards].map((boardId) =>
        this.run(boardId, () => {
          this.presence.remove(boardId, socket.id);
          this.syncPresence(boardId);
        }),
      ),
    );
  }

  /** Called after removal commits, while still holding this board's queue. */
  async evictUser(
    boardId: string,
    userId: string,
    accessRevoked = false,
  ): Promise<void> {
    const canonicalId = boardId.toLowerCase();
    this.presence.removeUser(canonicalId, userId);
    const server = this.server;
    if (!server) return;
    const room = boardRoom(canonicalId);
    const sockets = [...server.sockets.sockets.values()].filter(
      (socket) => socket.data.identity?.userId === userId,
    );
    // Revoke all receive grants before the first asynchronous adapter operation.
    for (const socket of sockets)
      socket.data.authorizedBoardIds?.delete(canonicalId);
    this.syncPresence(canonicalId);
    for (const socket of sockets) {
      try {
        // Only the removed user's own revocation bypasses the room grant.
        if (accessRevoked)
          socket.emit(RealtimeServerEvent.BOARD_ACCESS_REVOKED, {
            boardId: canonicalId,
          });
        else
          socket.emit(RealtimeServerEvent.MEMBER_REMOVED, {
            boardId: canonicalId,
            userId,
          });
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
