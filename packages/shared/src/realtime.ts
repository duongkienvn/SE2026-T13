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
  | 'TOO_MANY_REQUESTS'
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

export const RealtimeServerEvent = {
  COLUMN_CREATED: 'column:created',
  COLUMN_UPDATED: 'column:updated',
  COLUMN_MOVED: 'column:moved',
  COLUMN_DELETED: 'column:deleted',
  CARD_CREATED: 'card:created',
  CARD_UPDATED: 'card:updated',
  CARD_MOVED: 'card:moved',
  CARD_ARCHIVED: 'card:archived',
  CARD_ASSIGNEES_CHANGED: 'card:assignees-changed',
  MEMBER_ADDED: 'member:added',
  MEMBER_ROLE_CHANGED: 'member:role-changed',
  MEMBER_REMOVED: 'member:removed',
} as const;

export interface ColumnChangedEvent {
  boardId: string;
  columnId: string;
}

export interface CardChangedEvent {
  boardId: string;
  cardId: string;
  columnId: string;
}

export interface CardMovedEvent {
  boardId: string;
  cardId: string;
  fromColumnId: string;
  toColumnId: string;
}

export interface MemberChangedEvent {
  boardId: string;
  userId: string;
}

/** Invalidation hints only; refetch authoritative state through REST. */
export interface RealtimeServerEvents {
  'column:created': (payload: ColumnChangedEvent) => void;
  'column:updated': (payload: ColumnChangedEvent) => void;
  'column:moved': (payload: ColumnChangedEvent) => void;
  'column:deleted': (payload: ColumnChangedEvent) => void;
  'card:created': (payload: CardChangedEvent) => void;
  'card:updated': (payload: CardChangedEvent) => void;
  'card:moved': (payload: CardMovedEvent) => void;
  'card:archived': (payload: CardChangedEvent) => void;
  'card:assignees-changed': (payload: CardChangedEvent) => void;
  'member:added': (payload: MemberChangedEvent) => void;
  'member:role-changed': (payload: MemberChangedEvent) => void;
  'member:removed': (payload: MemberChangedEvent) => void;
}
