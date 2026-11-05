import type { EntityManager } from 'typeorm';
import type { User } from '../entities/user.entity';

/** Explicit dependency graph; no collaborative object is deleted here. */
export async function eraseAccountPrivateState(
  manager: EntityManager,
  user: User,
): Promise<void> {
  for (const table of [
    'google_identities',
    'password_reset_tokens',
    'email_verification_tokens',
    'pending_email_changes',
    'welcome_email_deliveries',
    'user_preferences',
    'notification_preferences',
    'board_user_states',
    'card_assignees',
  ])
    await manager.query(`DELETE FROM ${table} WHERE user_id=$1`, [user.id]);
  await manager.query(
    'DELETE FROM user_notifications WHERE recipient_user_id=$1',
    [user.id],
  );
  await manager.query(
    'DELETE FROM task_notification_email_outbox WHERE recipient_user_id=$1',
    [user.id],
  );
  await manager.query('DELETE FROM board_members WHERE user_id=$1', [user.id]);
  await manager.query('DELETE FROM workspace_members WHERE user_id=$1', [
    user.id,
  ]);
}
