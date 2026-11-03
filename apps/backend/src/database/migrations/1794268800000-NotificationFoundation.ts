import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationFoundation1794268800000 implements MigrationInterface {
  name = 'NotificationFoundation1794268800000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE user_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_user_id uuid NOT NULL CONSTRAINT "FK_user_notifications_recipient" REFERENCES users(id) ON DELETE NO ACTION,
      kind varchar NOT NULL,
      dedupe_key varchar(200) NOT NULL,
      actor_user_id uuid CONSTRAINT "FK_user_notifications_actor" REFERENCES users(id) ON DELETE SET NULL,
      workspace_id uuid CONSTRAINT "FK_user_notifications_workspace" REFERENCES workspaces(id) ON DELETE SET NULL,
      board_id uuid CONSTRAINT "FK_user_notifications_board" REFERENCES boards(id) ON DELETE SET NULL,
      card_id uuid CONSTRAINT "FK_user_notifications_card" REFERENCES cards(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      read_at timestamptz,
      CONSTRAINT "UQ_user_notifications_recipient_dedupe" UNIQUE(recipient_user_id,dedupe_key),
      CONSTRAINT "CK_user_notifications_kind" CHECK(kind IN ('CARD_ASSIGNED','COMMENT_MENTIONED','WORKSPACE_INVITED','BOARD_INVITED','MEMBERSHIP_CHANGED','DUE_REMINDER')),
      CONSTRAINT "CK_user_notifications_dedupe" CHECK(dedupe_key ~ ('^' || kind || ':[A-Za-z0-9][A-Za-z0-9:._+-]{0,159}$')),
      CONSTRAINT "CK_user_notifications_dates" CHECK(isfinite(created_at) AND (read_at IS NULL OR (isfinite(read_at) AND read_at >= created_at)))
    )`);
    await runner.query(
      'CREATE INDEX "IDX_user_notifications_inbox" ON user_notifications(recipient_user_id,created_at DESC,id DESC)',
    );
    await runner.query(
      'CREATE INDEX "IDX_user_notifications_unread" ON user_notifications(recipient_user_id,created_at DESC,id DESC) WHERE read_at IS NULL',
    );
    for (const column of ['actor', 'workspace', 'board', 'card']) {
      const field = column === 'actor' ? 'actor_user_id' : `${column}_id`;
      await runner.query(
        `CREATE INDEX "IDX_user_notifications_${column}" ON user_notifications(${field})`,
      );
    }
    await runner.query(`CREATE TABLE notification_preferences (
      user_id uuid CONSTRAINT "PK_notification_preferences" PRIMARY KEY CONSTRAINT "FK_notification_preferences_user" REFERENCES users(id) ON DELETE NO ACTION,
      in_app_card_assigned boolean NOT NULL DEFAULT true,
      in_app_comment_mentioned boolean NOT NULL DEFAULT true,
      in_app_workspace_invited boolean NOT NULL DEFAULT true,
      in_app_board_invited boolean NOT NULL DEFAULT true,
      in_app_membership_changed boolean NOT NULL DEFAULT true,
      in_app_due_reminder boolean NOT NULL DEFAULT true,
      email_card_assigned boolean NOT NULL DEFAULT false,
      email_comment_mentioned boolean NOT NULL DEFAULT false,
      email_due_reminder boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async down(): Promise<void> {
    throw new Error(
      'Notification foundation requires a forward fix; preserve notification history and preferences',
    );
  }
}
