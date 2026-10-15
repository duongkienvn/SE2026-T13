import type {
  RealtimeClientEvents,
  RealtimeServerEvents,
} from '@kanban/shared';
import type { Server, Socket } from 'socket.io';
import type { AuthenticatedUser } from '../api/auth/constants/auth.constants';

export interface RealtimeSocketData {
  identity?: AuthenticatedUser;
  /** Application-owned receive grants; adapter room state alone is not authority. */
  authorizedBoardIds?: Set<string>;
}

export type RealtimeServer = Server<
  RealtimeClientEvents,
  RealtimeServerEvents,
  Record<string, never>,
  RealtimeSocketData
>;
export type RealtimeSocket = Socket<
  RealtimeClientEvents,
  RealtimeServerEvents,
  Record<string, never>,
  RealtimeSocketData
>;

export function boardRoom(boardId: string): string {
  return `board:${boardId.toLowerCase()}`;
}
