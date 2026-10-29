import { RealtimePresenceEvent, type BoardRoomAck } from '@kanban/shared';
import {
  EMPTY_PRESENCE,
  livePresence,
  parsePresenceSnapshot,
  type BoardPresenceState,
} from './board-presence-state';
import { boardKeys } from '../boards/query-keys';
import {
  BOARD_EVENTS,
  boardResyncTargets,
  invalidationTargets,
  type BoardEventName,
  type BoardEventPayload,
  type InvalidationTarget,
} from './event-invalidation';
import type { RealtimeSocket } from './socket-client';

/**
 * - `connecting`: not live yet on this page.
 * - `live`: joined and caught up; changes arrive as they happen.
 * - `reconnecting`: was live, lost the connection, retrying.
 * - `paused`: retries gave up; resumes when the tab is back online or visible.
 * - `unavailable`: the server refused the board; the page re-checks it by REST.
 */
export type BoardRealtimeStatus =
  'connecting' | 'live' | 'reconnecting' | 'paused' | 'unavailable';

export interface BoardRealtimeOptions {
  createSocket: () => RealtimeSocket;
  invalidate: (targets: InvalidationTarget[]) => void;
  /** Re-checks the session by REST; a 401 there ends it (and this client). */
  verifySession: () => void;
  accessRevoked?: (boardId: string) => void;
  /** Keep a session-scoped connection even without an open Board. */
  keepAlive?: boolean;
  connectionLost?: () => void;
  reconnected?: () => void;
  ackTimeoutMs?: number;
  /** First retry delay; each further retry doubles it, up to 30 s. */
  retryBaseMs?: number;
  maxRetries?: number;
  /** How long the socket stays open after the last board page closes. */
  idleDisconnectMs?: number;
}

interface Room {
  boardId: string;
  status: BoardRealtimeStatus;
  /** Bumped by every join and disconnect so late ACKs are recognized. */
  attempt: number;
  retries: number;
  joinSent: boolean;
  joinPending: boolean;
  pendingPresence?: readonly string[];
  presence: BoardPresenceState;
  retryTimer?: ReturnType<typeof setTimeout>;
}

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * One Socket.IO connection for the signed-in session, shared by every board
 * page that `watch`es a board. It joins the watched board rooms, turns their
 * events into query invalidations, and after every (re)join refetches the
 * whole board, because events missed while away are never replayed.
 */
export class BoardRealtimeClient {
  private readonly ackTimeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly maxRetries: number;
  private readonly idleDisconnectMs: number;

  private socket: RealtimeSocket | null = null;
  private readonly watchers = new Map<string, number>();
  private readonly rooms = new Map<string, Room>();
  private readonly listeners = new Set<() => void>();
  private reconnectRetries = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private reconcileQueued = false;
  private disposed = false;
  private connectionEpoch = 0;
  private presenceListener?: (payload: unknown) => void;

  constructor(private readonly options: BoardRealtimeOptions) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? 10_000;
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.maxRetries = options.maxRetries ?? 5;
    this.idleDisconnectMs = options.idleDisconnectMs ?? 10_000;
  }

  start(): void {
    if (this.disposed || !this.options.keepAlive) return;
    const socket = this.ensureSocket();
    if (!socket.connected && !socket.active) socket.connect();
  }

  /** Keeps the board's room joined until the returned function is called. */
  watch(boardId: string): () => void {
    if (this.disposed) return () => undefined;
    this.watchers.set(boardId, (this.watchers.get(boardId) ?? 0) + 1);
    this.scheduleReconcile();
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      const count = (this.watchers.get(boardId) ?? 1) - 1;
      if (count > 0) this.watchers.set(boardId, count);
      else this.watchers.delete(boardId);
      this.scheduleReconcile();
    };
  }

  status(boardId: string): BoardRealtimeStatus {
    return this.rooms.get(boardId)?.status ?? 'connecting';
  }

  /** Read-only external-store snapshot; reading never creates a socket/watcher. */
  presence(boardId: string): BoardPresenceState {
    if (this.disposed) return EMPTY_PRESENCE.connecting;
    const exact = this.rooms.get(boardId);
    if (exact && this.watchers.has(boardId)) return exact.presence;
    // A page URL can use uppercase while REST returns its canonical UUID.
    for (const room of this.rooms.values()) {
      if (
        this.watchers.has(room.boardId) &&
        room.boardId.toLowerCase() === boardId.toLowerCase()
      )
        return room.presence;
    }
    return EMPTY_PRESENCE.connecting;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The browser is back online or visible: retry now instead of waiting. */
  wake(): void {
    if (
      this.disposed ||
      !this.socket ||
      (!this.options.keepAlive && this.watchers.size === 0)
    )
      return;
    this.reconnectRetries = 0;
    if (!this.socket.connected) {
      clearTimeout(this.reconnectTimer);
      if (!this.socket.active) this.socket.connect();
      return;
    }
    for (const room of this.rooms.values()) {
      if (room.status !== 'paused') continue;
      room.retries = 0;
      this.join(room);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.idleTimer);
    for (const room of this.rooms.values()) clearTimeout(room.retryTimer);
    this.rooms.clear();
    this.watchers.clear();
    this.connectionEpoch++;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.presenceListener = undefined;
    this.notify();
    this.listeners.clear();
  }

  /*
   * Watch changes are applied together once the current task ends, so React
   * StrictMode's mount → unmount → mount and fast board switches don't send
   * join/leave pairs that cancel out.
   */
  private scheduleReconcile(): void {
    if (this.reconcileQueued || this.disposed) return;
    this.reconcileQueued = true;
    queueMicrotask(() => {
      this.reconcileQueued = false;
      this.reconcile();
    });
  }

  private reconcile(): void {
    if (this.disposed) return;
    const socket = this.watchers.size > 0 ? this.ensureSocket() : this.socket;

    for (const room of [...this.rooms.values()]) {
      if (this.watchers.has(room.boardId)) continue;
      clearTimeout(room.retryTimer);
      this.rooms.delete(room.boardId);
      if (room.joinSent && socket?.connected) {
        // Best effort: events of a board no longer in `rooms` are dropped anyway.
        socket
          .timeout(this.ackTimeoutMs)
          .emit('board:leave', { boardId: room.boardId }, () => undefined);
      }
    }
    for (const boardId of this.watchers.keys()) {
      if (this.rooms.has(boardId)) continue;
      const room: Room = {
        boardId,
        status: 'connecting',
        attempt: 0,
        retries: 0,
        joinSent: false,
        joinPending: false,
        presence: EMPTY_PRESENCE.connecting,
      };
      this.rooms.set(boardId, room);
      if (socket?.connected) this.join(room);
    }

    if (this.watchers.size > 0) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
      if (socket && !socket.connected && !socket.active) socket.connect();
    } else if (
      !this.options.keepAlive &&
      socket &&
      this.idleTimer === undefined
    ) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = undefined;
        if (this.watchers.size === 0) socket.disconnect();
      }, this.idleDisconnectMs);
    }
    this.notify();
  }

  private ensureSocket(): RealtimeSocket {
    if (this.socket) return this.socket;
    const socket = this.options.createSocket();
    this.socket = socket;

    socket.on('connect', () => {
      this.options.reconnected?.();
      const epoch = ++this.connectionEpoch;
      if (this.presenceListener)
        socket.off(RealtimePresenceEvent.SYNC, this.presenceListener);
      this.presenceListener = (payload: unknown) => {
        if (epoch === this.connectionEpoch) this.receivePresence(payload);
      };
      socket.on(RealtimePresenceEvent.SYNC, this.presenceListener);
      this.reconnectRetries = 0;
      for (const room of this.rooms.values()) {
        room.retries = 0;
        this.join(room);
      }
    });
    socket.on('disconnect', (reason) => {
      this.connectionLost();
      // The server closed it (expired token, revoked access): Socket.IO won't retry.
      if (reason === 'io server disconnect') {
        this.options.verifySession();
        this.scheduleReconnect();
      }
    });
    socket.on('connect_error', () => {
      this.connectionLost();
      // `active` stays true while Socket.IO retries a network error itself;
      // a refused handshake (bad or expired token) is final for this attempt.
      if (!socket.active) {
        this.options.verifySession();
        this.scheduleReconnect();
      }
    });
    for (const event of BOARD_EVENTS) {
      socket.on(event, (payload: unknown) => this.receive(event, payload));
    }
    return socket;
  }

  private join(room: Room): void {
    const socket = this.socket;
    if (!socket?.connected) return;
    clearTimeout(room.retryTimer);
    const attempt = ++room.attempt;
    const epoch = this.connectionEpoch;
    room.joinSent = true;
    room.joinPending = true;
    room.pendingPresence = undefined;
    room.presence = EMPTY_PRESENCE.syncing;
    this.notify();
    socket
      .timeout(this.ackTimeoutMs)
      .emit(
        'board:join',
        { boardId: room.boardId },
        (error: Error | null, ack?: BoardRoomAck) => {
          if (this.disposed || this.rooms.get(room.boardId) !== room) return;
          if (
            !socket.connected ||
            epoch !== this.connectionEpoch ||
            room.attempt !== attempt ||
            !room.joinPending ||
            !this.watchers.has(room.boardId)
          )
            return;
          room.joinPending = false;
          this.joined(room, error ? undefined : ack);
        },
      );
  }

  private joined(room: Room, ack: BoardRoomAck | undefined): void {
    if (ack?.success && ack.boardId === room.boardId.toLowerCase()) {
      room.status = 'live';
      room.retries = 0;
      room.presence = room.pendingPresence
        ? livePresence(room.pendingPresence)
        : EMPTY_PRESENCE.syncing;
      room.pendingPresence = undefined;
      this.options.invalidate(boardResyncTargets(room.boardId));
      this.notify();
      return;
    }
    room.pendingPresence = undefined;
    room.presence = EMPTY_PRESENCE.syncing;
    if (ack && !ack.success) {
      if (ack.code === 'NOT_FOUND' || ack.code === 'VALIDATION_FAILED') {
        this.options.accessRevoked?.(room.boardId);
        // Not a member (any more) or no such board: let REST say so on the page.
        room.status = 'unavailable';
        room.presence = EMPTY_PRESENCE.unavailable;
        this.options.invalidate([
          { queryKey: boardKeys.detail(room.boardId), exact: true },
        ]);
        this.notify();
        return;
      }
      if (ack.code === 'UNAUTHORIZED') {
        this.notify();
        // The server also drops this socket; reconnecting reads a new token.
        this.options.verifySession();
        return;
      }
    }
    // Timeout, rate limit, server error or an ACK for another board.
    this.retryJoin(room);
  }

  private retryJoin(room: Room): void {
    if (room.retries >= this.maxRetries) {
      room.status = 'paused';
      room.presence = EMPTY_PRESENCE.paused;
      this.notify();
      return;
    }
    room.retryTimer = setTimeout(
      () => this.join(room),
      this.delay(room.retries++),
    );
  }

  private connectionLost(): void {
    this.options.connectionLost?.();
    this.connectionEpoch++;
    if (this.presenceListener)
      this.socket?.off(RealtimePresenceEvent.SYNC, this.presenceListener);
    this.presenceListener = undefined;
    for (const room of this.rooms.values()) {
      clearTimeout(room.retryTimer);
      room.attempt++;
      room.joinSent = false;
      room.joinPending = false;
      room.pendingPresence = undefined;
      if (room.status === 'live') room.status = 'reconnecting';
      room.presence =
        room.status === 'unavailable'
          ? EMPTY_PRESENCE.unavailable
          : room.status === 'reconnecting'
            ? EMPTY_PRESENCE.reconnecting
            : EMPTY_PRESENCE.connecting;
    }
    this.notify();
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    if (!this.options.keepAlive && this.watchers.size === 0) return;
    if (this.reconnectRetries >= this.maxRetries) {
      for (const room of this.rooms.values()) {
        if (room.status !== 'unavailable') {
          room.status = 'paused';
          room.presence = EMPTY_PRESENCE.paused;
        }
      }
      this.notify();
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      const socket = this.socket;
      if (
        socket &&
        !socket.connected &&
        !socket.active &&
        (this.options.keepAlive || this.watchers.size > 0)
      )
        socket.connect();
    }, this.delay(this.reconnectRetries++));
  }

  private receive(event: BoardEventName, payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return;
    const { boardId } = payload as { boardId?: unknown };
    if (typeof boardId !== 'string') return;
    const id = boardId.toLowerCase();
    for (const room of this.rooms.values()) {
      if (
        event === 'board:access-revoked' &&
        room.boardId.toLowerCase() === id
      ) {
        clearTimeout(room.retryTimer);
        room.attempt++;
        room.joinPending = false;
        room.pendingPresence = undefined;
        room.status = 'unavailable';
        room.presence = EMPTY_PRESENCE.unavailable;
        this.notify();
        continue;
      }
      // Events before the join ACK are covered by the resync that follows it.
      if (room.status !== 'live' || room.boardId.toLowerCase() !== id) continue;
      // Query keys use the board id as the page has it, which may differ in case.
      this.options.invalidate(
        invalidationTargets(event, {
          ...(payload as BoardEventPayload<typeof event>),
          boardId: room.boardId,
        }),
      );
    }
  }

  private receivePresence(payload: unknown): void {
    if (this.disposed || !this.socket?.connected) return;
    const snapshot = parsePresenceSnapshot(payload);
    if (!snapshot) return;
    for (const room of this.rooms.values()) {
      if (
        !this.watchers.has(room.boardId) ||
        room.boardId.toLowerCase() !== snapshot.boardId
      )
        continue;
      if (room.joinPending) {
        // Only the latest full snapshot of this outstanding attempt is needed.
        room.pendingPresence = snapshot.userIds;
      } else if (room.status === 'live') {
        const previous = room.presence.userIds;
        if (
          previous &&
          previous.length === snapshot.userIds.length &&
          previous.every((id, index) => id === snapshot.userIds[index])
        )
          continue;
        room.presence = livePresence(snapshot.userIds);
        this.notify();
      }
    }
  }

  private delay(retry: number): number {
    return Math.min(this.retryBaseMs * 2 ** retry, MAX_RETRY_DELAY_MS);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
