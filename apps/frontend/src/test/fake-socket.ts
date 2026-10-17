import type { BoardRoomAck } from '@kanban/shared';
import { vi } from 'vitest';
import type { RealtimeSocket } from '../features/realtime/socket-client';

type Listener = (...args: unknown[]) => void;
type Ack = (error: Error | null, ack?: BoardRoomAck) => void;

export interface SentRequest {
  event: string;
  boardId: string;
  timeoutMs: number;
  /** Answers like the server; `timeOut()` answers like Socket.IO's timeout. */
  reply: (ack: BoardRoomAck) => void;
  timeOut: () => void;
}

/**
 * Stands in for a Socket.IO client socket. Tests drive the "server" side:
 * `open`, `drop`, `serverDisconnect`, `refuse`, `push` and the replies to
 * `sent` requests.
 */
export class FakeSocket {
  connected = false;
  active = false;
  readonly sent: SentRequest[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  readonly connect = vi.fn(() => {
    this.active = true;
    return this;
  });

  readonly disconnect = vi.fn(() => {
    const wasConnected = this.connected;
    this.connected = false;
    this.active = false;
    if (wasConnected) this.fire('disconnect', 'io client disconnect');
    return this;
  });

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  timeout(timeoutMs: number) {
    return {
      emit: (event: string, request: { boardId: string }, ack: Ack) => {
        this.sent.push({
          event,
          boardId: request.boardId,
          timeoutMs,
          reply: (result) => ack(null, result),
          timeOut: () => ack(new Error('operation has timed out')),
        });
      },
    };
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Requests of one kind, oldest first. */
  requests(event: 'board:join' | 'board:leave'): SentRequest[] {
    return this.sent.filter((request) => request.event === event);
  }

  lastJoin(): SentRequest {
    const joins = this.requests('board:join');
    if (joins.length === 0) throw new Error('No board:join was sent.');
    return joins[joins.length - 1];
  }

  open() {
    this.connected = true;
    this.active = true;
    this.fire('connect');
  }

  /** The network went away; Socket.IO keeps retrying on its own. */
  drop() {
    this.connected = false;
    this.active = true;
    this.fire('disconnect', 'transport close');
  }

  /** The server closed the connection; Socket.IO does not retry. */
  serverDisconnect() {
    this.connected = false;
    this.active = false;
    this.fire('disconnect', 'io server disconnect');
  }

  /** The handshake was refused (bad or expired token). */
  refuse() {
    this.connected = false;
    this.active = false;
    this.fire('connect_error', new Error('Unauthorized'));
  }

  /** A server → client event. */
  push(event: string, payload: unknown) {
    this.fire(event, payload);
  }

  private fire(event: string, ...args: unknown[]) {
    for (const listener of [...(this.listeners.get(event) ?? [])])
      listener(...args);
  }
}

export interface CreatedSocket {
  socket: FakeSocket;
  getAccessToken: () => Promise<string>;
}

/** Every socket the app created in the current test, oldest first. */
export const createdSockets: CreatedSocket[] = [];

/** Replaces `createRealtimeSocket` in every test (see `setup.ts`). */
export function fakeRealtimeSocket(
  getAccessToken: () => Promise<string>,
): RealtimeSocket {
  const socket = new FakeSocket();
  createdSockets.push({ socket, getAccessToken });
  return asRealtimeSocket(socket);
}

export function asRealtimeSocket(socket: FakeSocket): RealtimeSocket {
  return socket as unknown as RealtimeSocket;
}

export const joined = (boardId: string): BoardRoomAck => ({
  success: true,
  boardId: boardId.toLowerCase(),
});

export const refused = (
  code: Extract<BoardRoomAck, { success: false }>['code'],
): BoardRoomAck => ({
  success: false,
  code,
  message: code,
});
