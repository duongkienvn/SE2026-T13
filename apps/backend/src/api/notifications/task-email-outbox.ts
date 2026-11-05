import { NotificationKind } from '@kanban/shared';
import type { EntityManager } from 'typeorm';

export type TaskEmailKind =
  | typeof NotificationKind.CARD_ASSIGNED
  | typeof NotificationKind.COMMENT_MENTIONED
  | typeof NotificationKind.DUE_REMINDER;

export function isTaskEmailKind(value: unknown): value is TaskEmailKind {
  return (
    value === NotificationKind.CARD_ASSIGNED ||
    value === NotificationKind.COMMENT_MENTIONED ||
    value === NotificationKind.DUE_REMINDER
  );
}

const preferenceColumn: Record<TaskEmailKind, string> = {
  [NotificationKind.CARD_ASSIGNED]: 'email_card_assigned',
  [NotificationKind.COMMENT_MENTIONED]: 'email_comment_mentioned',
  [NotificationKind.DUE_REMINDER]: 'email_due_reminder',
};

/** Called after the notification producer has locked the recipient, inside its
 * domain transaction. No recipient address or content is copied to the queue. */
export async function enqueueTaskEmail(
  manager: EntityManager,
  input: {
    recipientUserId: string;
    kind: TaskEmailKind;
    occurrenceKey: string;
    boardId: string;
    cardId: string;
  },
): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('Task email enqueue requires a transaction');
  }
  const column = preferenceColumn[input.kind];
  await manager.query(
    `INSERT INTO task_notification_email_outbox
       (recipient_user_id, kind, occurrence_key, board_id, card_id)
     SELECT u.id, $2, $3, $4, $5
       FROM users u JOIN notification_preferences p ON p.user_id = u.id
      WHERE u.id = $1 AND u.email_verified_at IS NOT NULL AND u.deleted_at IS NULL AND p.${column} = true
     ON CONFLICT (recipient_user_id, kind, occurrence_key) DO NOTHING`,
    [
      input.recipientUserId,
      input.kind,
      input.occurrenceKey,
      input.boardId,
      input.cardId,
    ],
  );
}
