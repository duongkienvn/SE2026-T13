import { NotificationKind } from '@kanban/shared';
import type { UserNotification } from './entities/user-notification.entity';

interface NotificationSource {
  recipientUserId: string;
  /** Stable backend-owned occurrence, never copied text/URLs or an HTTP input. */
  occurrenceKey: string;
  actorUserId?: string;
}
type CardKind =
  | typeof NotificationKind.CARD_ASSIGNED
  | typeof NotificationKind.COMMENT_MENTIONED
  | typeof NotificationKind.DUE_REMINDER;
export type RecordNotificationInput = NotificationSource &
  (
    | { kind: CardKind; cardId: string; boardId?: string; workspaceId?: string }
    | {
        kind: typeof NotificationKind.WORKSPACE_INVITED;
        workspaceId: string;
        boardId?: never;
        cardId?: never;
      }
    | {
        kind: typeof NotificationKind.BOARD_INVITED;
        boardId: string;
        workspaceId?: string;
        cardId?: never;
      }
    | {
        kind: typeof NotificationKind.MEMBERSHIP_CHANGED;
        workspaceId?: string;
        boardId?: string;
        cardId?: never;
      }
  );
export interface NotificationRecordResult {
  status: 'created' | 'duplicate' | 'disabled' | 'recipient-missing';
  notificationId: string | null;
  recipientUserId: string;
}
export class NotificationRecordValidationError extends Error {
  constructor() {
    super('Invalid notification occurrence, context or transaction');
    this.name = 'NotificationRecordValidationError';
  }
}
export function notificationScope(
  row: Pick<UserNotification, 'dedupeKey'>,
): 'card' | 'board' | 'workspace' | null {
  const scope = row.dedupeKey.split(':')[1];
  return scope === 'card' || scope === 'board' || scope === 'workspace'
    ? scope
    : null;
}
/** Origin invitation verifiers can recover their source ID without storing proof. */
export function notificationOccurrence(
  row: Pick<UserNotification, 'dedupeKey'>,
): string {
  return row.dedupeKey.split(':').slice(2).join(':');
}
