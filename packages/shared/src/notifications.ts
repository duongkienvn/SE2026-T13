export const NotificationKind = {
  CARD_ASSIGNED: 'CARD_ASSIGNED',
  COMMENT_MENTIONED: 'COMMENT_MENTIONED',
  WORKSPACE_INVITED: 'WORKSPACE_INVITED',
  BOARD_INVITED: 'BOARD_INVITED',
  MEMBERSHIP_CHANGED: 'MEMBERSHIP_CHANGED',
  DUE_REMINDER: 'DUE_REMINDER',
} as const;
export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];

export interface InAppNotificationPreferences {
  cardAssigned: boolean;
  commentMentioned: boolean;
  workspaceInvited: boolean;
  boardInvited: boolean;
  membershipChanged: boolean;
  dueReminder: boolean;
}
export interface NotificationEmailPreferences {
  cardAssigned: boolean;
  commentMentioned: boolean;
  dueReminder: boolean;
}
export interface NotificationPreferences {
  inApp: InAppNotificationPreferences;
  email: NotificationEmailPreferences;
}
export interface UpdateNotificationPreferences {
  inApp?: Partial<InAppNotificationPreferences>;
  email?: Partial<NotificationEmailPreferences>;
}
export interface NotificationResponse {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  readAt: string | null;
  actor: { id: string; displayName: string; isDeleted?: boolean } | null;
  summary: string;
  context: {
    workspaceId: string | null;
    boardId: string | null;
    cardId: string | null;
  } | null;
  target: {
    kind: 'workspace' | 'board' | 'card' | 'invitation';
    path: string;
  } | null;
  isUnavailable: boolean;
}
export interface NotificationsQuery {
  filter?: 'all' | 'unread';
  page?: number;
  limit?: number;
}
export interface NotificationUnreadCount {
  count: number;
}
export interface NotificationReadAllResult {
  updatedCount: number;
}

/** ID-free invalidation. Recover current inbox/count/preferences using REST. */
export type NotificationsChangedPayload = Record<string, never>;
export const RealtimeNotificationEvent = {
  CHANGED: 'notifications:changed',
} as const;
