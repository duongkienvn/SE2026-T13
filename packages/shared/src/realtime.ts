export const RealtimeEvent = {
  BOARD_JOIN: 'board:join',
  BOARD_LEAVE: 'board:leave',
} as const;

export interface BoardRoomRequest {
  boardId: string;
}

export type RealtimeErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'INTERNAL_ERROR';

export type BoardRoomAck =
  | { success: true; boardId: string }
  | { success: false; code: RealtimeErrorCode; message: string };

export interface RealtimeClientEvents {
  'board:join': (
    request: BoardRoomRequest,
    acknowledge: (result: BoardRoomAck) => void,
  ) => void;
  'board:leave': (
    request: BoardRoomRequest,
    acknowledge: (result: BoardRoomAck) => void,
  ) => void;
}

// F2/G1 add reviewed event signatures here; F1 publishes no business events.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RealtimeServerEvents {}
