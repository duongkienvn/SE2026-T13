import type { BoardCapabilities } from '@kanban/shared';
import { systemTimers, type Timers } from '../auth/clock.ts';
import { isUuid } from '../auth/credential-record.ts';
import { ApiError } from '../api/errors.ts';
import { parseRoomAck } from './contracts.ts';
import type { NativeSocket } from './socket.ts';

/** Projection of BoardsController GET /boards/:boardId, not a duplicate Board DTO. */
export interface BoardAccess {
  id: string;
  workspaceId: string;
  isArchived: boolean;
  capabilities: Pick<BoardCapabilities, 'canReadBoard' | 'canWriteBoard'>;
}
export function decodeBoardAccess(value: unknown): BoardAccess {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid Board access');
  const data = value as Record<string, unknown>;
  const caps = data.capabilities as Record<string, unknown> | null;
  if (
    !isUuid(data.id) ||
    !isUuid(data.workspaceId) ||
    typeof data.isArchived !== 'boolean' ||
    !caps ||
    typeof caps.canReadBoard !== 'boolean' ||
    typeof caps.canWriteBoard !== 'boolean'
  )
    throw new Error('Invalid Board access');
  return {
    id: data.id.toLowerCase(),
    workspaceId: data.workspaceId.toLowerCase(),
    isArchived: data.isArchived,
    capabilities: {
      canReadBoard: caps.canReadBoard,
      canWriteBoard: caps.canWriteBoard,
    },
  };
}
export interface BoardRealtimeState {
  readonly status: 'paused' | 'checking' | 'joining' | 'live' | 'unavailable';
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly workspaceId?: string;
  readonly userIds: readonly string[];
}
export const EMPTY_BOARD_STATE: BoardRealtimeState = Object.freeze({
  status: 'paused',
  canRead: false,
  canWrite: false,
  userIds: [],
});
interface Room {
  id: string;
  consumers: Set<symbol>;
  attempt: number;
  state: BoardRealtimeState;
  abort?: AbortController;
  timer?: unknown;
  retries: number;
  sent: boolean;
  pendingPresence?: readonly string[];
}
export interface RoomOptions {
  socket(): NativeSocket | null;
  probe(boardId: string, signal: AbortSignal): Promise<BoardAccess>;
  fence(boardId: string, revoked: boolean, reconcileAggregates?: boolean): void;
  grant(access: BoardAccess): void;
  recovered(boardId: string): void;
  unauthorized(): void;
  restart(): void;
  timers?: Timers;
}

export function createBoardRooms(options: RoomOptions) {
  const timers = options.timers ?? systemTimers;
  const rooms = new Map<string, Room>();
  const listeners = new Set<() => void>();
  const leaves = new Set<unknown>();
  let epoch = 0;
  function notify() {
    for (const listener of [...listeners]) listener();
  }
  function state(room: Room, next: BoardRealtimeState) {
    room.state = next;
    notify();
  }
  function cancel(room: Room) {
    room.attempt++;
    room.abort?.abort();
    room.abort = undefined;
    if (room.timer !== undefined) timers.clearTimeout(room.timer);
    room.timer = undefined;
    room.pendingPresence = undefined;
  }
  function leave(room: Room) {
    const socket = options.socket();
    if (!room.sent || !socket?.connected) {
      room.sent = false;
      return;
    }
    room.sent = false;
    const ticket = epoch;
    const timer = timers.setTimeout(() => {
      leaves.delete(timer);
      if (ticket === epoch) options.restart();
    }, 5000);
    leaves.add(timer);
    socket.emit('board:leave', { boardId: room.id }, (value) => {
      if (ticket !== epoch || !leaves.delete(timer)) return;
      timers.clearTimeout(timer);
      const ack = parseRoomAck(value, room.id);
      if (!ack?.success) {
        if (ack?.code === 'UNAUTHORIZED') options.unauthorized();
        else options.restart();
      }
    });
  }
  function unavailable(room: Room, reconcileAggregates = true) {
    cancel(room);
    leave(room);
    options.fence(room.id, true, reconcileAggregates);
    state(room, { ...EMPTY_BOARD_STATE, status: 'unavailable' });
  }
  function join(room: Room) {
    const socket = options.socket();
    if (!socket?.connected || rooms.get(room.id) !== room) return;
    const attempt = ++room.attempt;
    const ticket = epoch;
    room.sent = true;
    room.pendingPresence = undefined;
    state(room, { ...room.state, status: 'joining', userIds: [] });
    const valid = () =>
      ticket === epoch &&
      room.attempt === attempt &&
      rooms.get(room.id) === room &&
      socket === options.socket() &&
      socket.connected;
    function retry() {
      if (!valid()) return;
      room.timer = undefined;
      room.pendingPresence = undefined;
      if (room.retries >= 3) {
        state(room, { ...room.state, status: 'paused', userIds: [] });
        return;
      }
      room.timer = timers.setTimeout(
        () => {
          room.timer = undefined;
          join(room);
        },
        250 * 2 ** room.retries++,
      );
    }
    let settled = false;
    room.timer = timers.setTimeout(() => {
      if (settled) return;
      settled = true;
      retry();
    }, 5000);
    socket.emit('board:join', { boardId: room.id }, (value) => {
      if (!valid() || settled || room.timer === undefined) return;
      settled = true;
      timers.clearTimeout(room.timer);
      room.timer = undefined;
      const ack = parseRoomAck(value, room.id);
      if (ack?.success) {
        room.retries = 0;
        state(room, {
          ...room.state,
          status: 'live',
          userIds: room.pendingPresence ?? [],
        });
        room.pendingPresence = undefined;
        options.recovered(room.id);
      } else if (ack?.code === 'UNAUTHORIZED') options.unauthorized();
      else if (ack?.code === 'NOT_FOUND' || ack?.code === 'VALIDATION_FAILED')
        unavailable(room);
      else retry();
    });
  }
  function resume(room: Room, access: BoardAccess) {
    state(room, {
      status: options.socket()?.connected ? 'joining' : 'paused',
      canRead: true,
      canWrite: !access.isArchived && access.capabilities.canWriteBoard,
      workspaceId: access.workspaceId,
      userIds: [],
    });
    join(room);
  }
  async function check(room: Room, retry = 0) {
    cancel(room);
    leave(room);
    room.retries = 0;
    options.fence(room.id, false);
    state(room, { ...EMPTY_BOARD_STATE, status: 'checking' });
    if (!options.socket()?.connected) {
      state(room, EMPTY_BOARD_STATE);
      return;
    }
    const attempt = room.attempt;
    const ticket = epoch;
    const controller = new AbortController();
    room.abort = controller;
    try {
      const access = await options.probe(room.id, controller.signal);
      if (
        ticket !== epoch ||
        attempt !== room.attempt ||
        rooms.get(room.id) !== room ||
        controller.signal.aborted
      )
        return;
      if (access.id !== room.id || !access.capabilities.canReadBoard) {
        unavailable(room);
        return;
      }
      options.grant(access);
      resume(room, access);
    } catch (error) {
      if (
        ticket !== epoch ||
        attempt !== room.attempt ||
        rooms.get(room.id) !== room ||
        controller.signal.aborted
      )
        return;
      if (error instanceof ApiError && [403, 404].includes(error.status))
        unavailable(room);
      else {
        state(room, EMPTY_BOARD_STATE);
        if (retry < 3)
          room.timer = timers.setTimeout(
            () => {
              room.timer = undefined;
              void check(room, retry + 1);
            },
            250 * 2 ** retry,
          );
      }
    }
  }
  function lost() {
    epoch++;
    for (const timer of leaves) timers.clearTimeout(timer);
    leaves.clear();
    for (const room of rooms.values()) {
      cancel(room);
      room.sent = false;
      options.fence(room.id, false);
      state(room, EMPTY_BOARD_STATE);
    }
  }
  return {
    confirmAccess(access: BoardAccess, suspended = false) {
      const room = rooms.get(access.id);
      if (!room) return;
      if (suspended && !room.state.canRead) resume(room, access);
      else if (room.state.canRead)
        state(room, {
          ...room.state,
          canWrite: !access.isArchived && access.capabilities.canWriteBoard,
          workspaceId: access.workspaceId,
        });
    },
    getSnapshot(boardId: string) {
      return rooms.get(boardId.toLowerCase())?.state ?? EMPTY_BOARD_STATE;
    },
    watchedIds: () => rooms.keys(),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watch(boardId: string) {
      if (!isUuid(boardId)) throw new Error('A Board UUID is required');
      const id = boardId.toLowerCase();
      let room = rooms.get(id);
      if (!room) {
        room = {
          id,
          consumers: new Set(),
          attempt: 0,
          state: EMPTY_BOARD_STATE,
          retries: 0,
          sent: false,
        };
        rooms.set(id, room);
      }
      const target = room;
      const consumer = Symbol();
      target.consumers.add(consumer);
      if (target.consumers.size === 1) void check(target);
      return () => {
        if (
          rooms.get(id) !== target ||
          !target.consumers.delete(consumer) ||
          target.consumers.size
        )
          return;
        cancel(target);
        leave(target);
        rooms.delete(id);
        notify();
      };
    },
    connected(alreadyChecking?: ReadonlySet<string>) {
      for (const room of rooms.values())
        if (!alreadyChecking?.has(room.id)) void check(room);
    },
    suspend(boardId?: string) {
      // Access hints can arrive after the last room consumer released its grant.
      // Cached data and queued work must still be fenced for that Board.
      if (boardId && !rooms.has(boardId)) options.fence(boardId, false);
      for (const room of rooms.values())
        if (
          (!boardId && room.state.status !== 'unavailable') ||
          room.id === boardId
        ) {
          cancel(room);
          leave(room);
          options.fence(room.id, false);
          state(room, { ...EMPTY_BOARD_STATE, status: 'checking' });
        }
    },
    recheck(boardId?: string, alreadyChecking?: ReadonlySet<string>) {
      return Promise.all(
        [...rooms.values()]
          .filter(
            (room) =>
              !alreadyChecking?.has(room.id) &&
              ((!boardId && room.state.status !== 'unavailable') ||
                room.id === boardId),
          )
          .map((room) => check(room)),
      );
    },
    revoke(boardId: string, reconcileAggregates = true) {
      const room = rooms.get(boardId);
      if (room) unavailable(room, reconcileAggregates);
      else options.fence(boardId, true, reconcileAggregates);
    },
    presence(boardId: string, userIds: readonly string[]) {
      const room = rooms.get(boardId);
      if (!room) return;
      if (room.state.status === 'joining' && room.sent)
        room.pendingPresence = userIds;
      else if (room.state.status === 'live') {
        if (
          room.state.userIds.length === userIds.length &&
          room.state.userIds.every((id, i) => id === userIds[i])
        )
          return;
        state(room, { ...room.state, userIds });
      }
    },
    isLive(boardId: string) {
      return rooms.get(boardId)?.state.status === 'live';
    },
    lost,
    reset() {
      lost();
      rooms.clear();
      notify();
    },
    dispose() {
      lost();
      rooms.clear();
      listeners.clear();
    },
  };
}
export type BoardRooms = ReturnType<typeof createBoardRooms>;
