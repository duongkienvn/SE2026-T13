import type { EntityManager } from 'typeorm';
import type { User } from '../entities/user.entity';

/** Explicit dependency graph; no collaborative object is deleted here. */
export async function eraseAccountPrivateState(
  manager: EntityManager,
  user: User,
): Promise<void> {
  const tombstone = `deleted+${user.id}@users.invalid`;
  // Retain counts, actor IDs and timestamps, but replace direct recipient copies.
  // The digest uses the same one-hour anti-abuse convention as the existing ledger.
  await manager.query(
    `UPDATE workspace_invitations SET
    erased_recipient_hash=COALESCE(erased_recipient_hash,encode(sha256(convert_to(email,'UTF8')),'hex')),
    email='deleted-invite+' || id::text || '@users.invalid',
    revoked_at=CASE WHEN consumed_at IS NULL AND declined_at IS NULL THEN COALESCE(revoked_at,clock_timestamp()) ELSE revoked_at END,
    token_hash=encode(sha256(gen_random_bytes(32)),'hex'), updated_at=clock_timestamp()
    WHERE invited_by_id=$1 OR email=$2`,
    [user.id, user.email],
  );
  // Another user's pending target can contain this account's old email. Consume
  // and redact that proof without resetting the OTHER account's rolling quota.
  await manager.query(
    `UPDATE pending_email_changes SET
    new_email=CASE WHEN new_email=$2 THEN $3 ELSE new_email END,
    original_email=CASE WHEN original_email=$2 THEN $3 ELSE original_email END,
    consumed_at=COALESCE(consumed_at,clock_timestamp()),
    token_hash=encode(sha256(gen_random_bytes(32)),'hex')
    WHERE user_id<>$1 AND (new_email=$2 OR original_email=$2)`,
    [user.id, user.email, tombstone],
  );
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
  // Keep durable avatar ownership rows until provider deletion is confirmed.
  // Invalidate intents now; the sweep waits for original presigned POST expiry.
  await manager.query(
    `UPDATE avatar_uploads SET state='rejected', next_cleanup_at=clock_timestamp()
    WHERE user_id=$1`,
    [user.id],
  );
  const personal: { id: string }[] = await manager.query(
    "SELECT id FROM workspaces WHERE created_by_id=$1 AND type='PERSONAL'",
    [user.id],
  );
  for (const { id } of personal) {
    await manager.query(
      `INSERT INTO deleted_workspace_invitation_quota(invitation_id,actor_id,recipient_hash,created_at)
      SELECT id,invited_by_id,COALESCE(erased_recipient_hash,encode(sha256(convert_to(email,'UTF8')),'hex')),created_at
      FROM workspace_invitations WHERE workspace_id=$1 AND created_at>clock_timestamp()-interval '1 hour'
      ON CONFLICT (invitation_id) DO NOTHING`,
      [id],
    );
    await manager.query(
      'DELETE FROM workspace_invitations WHERE workspace_id=$1',
      [id],
    );
    await manager.query('DELETE FROM workspace_members WHERE workspace_id=$1', [
      id,
    ]);
    // Workspace Activity CASCADE; notification Workspace references SET NULL.
    // The locked zero-Board precondition was checked before any write.
    await manager.query('DELETE FROM workspaces WHERE id=$1', [id]);
  }
}
