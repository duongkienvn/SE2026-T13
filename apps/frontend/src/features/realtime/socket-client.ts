import type {
  RealtimeClientEvents,
  RealtimeServerEvents,
} from '@kanban/shared';
import { io, type Socket } from 'socket.io-client';
import { env } from '../../lib/env';

export type RealtimeSocket = Socket<RealtimeServerEvents, RealtimeClientEvents>;

/** The backend serves Socket.IO at its root, not under the REST `/api` prefix. */
export const SOCKET_PATH = '/socket.io';

/**
 * Origin of the backend that serves the REST API, e.g.
 * `http://localhost:3000/api` → `http://localhost:3000`. A relative base URL
 * means the API shares the page's origin.
 */
export function socketOrigin(
  apiBaseUrl = env.apiBaseUrl,
  pageOrigin = window.location.origin,
): string {
  return new URL(apiBaseUrl, pageOrigin).origin;
}

/**
 * A socket that waits for `connect()`. `getAccessToken` runs before every
 * (re)connection, so the handshake never reuses a token from an ended
 * session; if it rejects, the socket stops instead of retrying.
 */
export function createRealtimeSocket(
  getAccessToken: () => Promise<string>,
): RealtimeSocket {
  const socket: RealtimeSocket = io(socketOrigin(), {
    path: SOCKET_PATH,
    autoConnect: false,
    auth: (send) => {
      getAccessToken().then(
        (accessToken) => send({ accessToken }),
        () => socket.disconnect(),
      );
    },
  });
  return socket;
}
