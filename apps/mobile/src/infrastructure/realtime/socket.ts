import { io } from 'socket.io-client';
import type { BoardRoomRequest } from '@kanban/shared';
import { SOCKET_PATH } from './contracts.ts';

export interface NativeSocket {
  readonly connected: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(
    event: 'board:join' | 'board:leave',
    request: BoardRoomRequest,
    ack: (value: unknown) => void,
  ): void;
  connect(): void;
  disconnect(): void;
  removeAllListeners(): void;
}
export type SocketFactory = (credential: () => string | null) => NativeSocket;

/** Separate Manager per attempt, with one reconnect owner (the native controller). */
export function nativeSocketFactory(origin: string): SocketFactory {
  return (credential) => {
    const socket = io(origin, {
      path: SOCKET_PATH,
      autoConnect: false,
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
      timeout: 10_000,
      auth: (send) => {
        const accessToken = credential();
        if (accessToken) send({ accessToken });
        else socket.disconnect();
      },
    });
    return socket;
  };
}
