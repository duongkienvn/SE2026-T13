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
  BOARD_ACCESS_CHANGED: 'board:access-changed',
  BOARD_ACCESS_REVOKED: 'board:access-revoked',
  BOARD_ARCHIVED: 'board:archived',
  BOARD_RESTORED: 'board:restored',
  COLUMN_CREATED: 'column:created',
  COLUMN_UPDATED: 'column:updated',
  COLUMN_MOVED: 'column:moved',
  COLUMN_DELETED: 'column:deleted',
  CARD_CREATED: 'card:created',
  CARD_UPDATED: 'card:updated',
  CARD_MOVED: 'card:moved',
  CARD_ARCHIVED: 'card:archived',
  CARD_RESTORED: 'card:restored',
  CARD_ASSIGNEES_CHANGED: 'card:assignees-changed',
  MEMBER_ADDED: 'member:added',
  MEMBER_ROLE_CHANGED: 'member:role-changed',
  MEMBER_REMOVED: 'member:removed',
  COMMENT_CREATED: 'comment:created',
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',
} as const;

export const RealtimePresenceEvent = {
  SYNC: 'presence:sync',
} as const;

export const RealtimeAccessEvent = {
  WORKSPACE_REVOKED: 'workspace:access-revoked',
} as const;

/** Ephemeral full snapshot; IDs are unique and sorted, boardId is lowercase. */
export interface BoardPresenceSnapshot {
  boardId: string;
  userIds: string[];
}

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
  /** Membership removed, but an independent Workspace read grant remains. */
  retainsReadAccess?: boolean;
}

export interface CommentChangedEvent {
  boardId: string;
  cardId: string;
  commentId: string;
}

/** Business events are invalidation hints; presence is an ephemeral full snapshot. */
export interface RealtimeServerEvents {
  'workspace:access-revoked': (payload: { workspaceId: string }) => void;
  'board:access-changed': (payload: BoardRoomRequest) => void;
  'board:access-revoked': (payload: BoardRoomRequest) => void;
  'board:archived': (payload: BoardRoomRequest) => void;
  'board:restored': (payload: BoardRoomRequest) => void;
  'presence:sync': (payload: BoardPresenceSnapshot) => void;
  'column:created': (payload: ColumnChangedEvent) => void;
  'column:updated': (payload: ColumnChangedEvent) => void;
  'column:moved': (payload: ColumnChangedEvent) => void;
  'column:deleted': (payload: ColumnChangedEvent) => void;
  'card:created': (payload: CardChangedEvent) => void;
  'card:updated': (payload: CardChangedEvent) => void;
  'card:moved': (payload: CardMovedEvent) => void;
  'card:archived': (payload: CardChangedEvent) => void;
  'card:restored': (payload: CardChangedEvent) => void;
  'card:assignees-changed': (payload: CardChangedEvent) => void;
  'member:added': (payload: MemberChangedEvent) => void;
  'member:role-changed': (payload: MemberChangedEvent) => void;
  'member:removed': (payload: MemberChangedEvent) => void;
  'comment:created': (payload: CommentChangedEvent) => void;
  'comment:updated': (payload: CommentChangedEvent) => void;
  'comment:deleted': (payload: CommentChangedEvent) => void;
}
