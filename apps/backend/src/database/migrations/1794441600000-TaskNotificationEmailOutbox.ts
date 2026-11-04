import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskNotificationEmailOutbox1794441600000 implements MigrationInterface {
  name = 'TaskNotificationEmailOutbox1794441600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE task_notification_email_outbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind varchar(32) NOT NULL CHECK (kind IN ('CARD_ASSIGNED','COMMENT_MENTIONED','DUE_REMINDER')),
      occurrence_key varchar(140) NOT NULL CHECK (occurrence_key ~ '^[A-Za-z0-9][A-Za-z0-9:._+-]{0,139}$'),
      board_id uuid REFERENCES boards(id) ON DELETE SET NULL,
      card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
      status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','CANCELLED','FAILED','UNKNOWN')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      lease_owner uuid,
      lease_until timestamptz,
      first_attempt_at timestamptz,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_task_email_occurrence" UNIQUE (recipient_user_id, kind, occurrence_key),
      CONSTRAINT "CK_task_email_lease" CHECK ((status = 'PROCESSING') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
    )`);
    await runner.query(
      `CREATE INDEX "IDX_task_email_ready" ON task_notification_email_outbox (next_attempt_at, id) WHERE status IN ('PENDING','PROCESSING')`,
    );
    await runner.query(
      `CREATE INDEX "IDX_task_email_recipient_sent" ON task_notification_email_outbox (recipient_user_id, sent_at) WHERE sent_at IS NOT NULL`,
    );
    await runner.query(
      `CREATE INDEX "IDX_cards_due_scan" ON cards (due_date, id) WHERE due_date IS NOT NULL AND NOT is_archived`,
    );
  }

  async down(): Promise<void> {
    throw new Error('Task notification email outbox requires a forward fix');
  }
}
