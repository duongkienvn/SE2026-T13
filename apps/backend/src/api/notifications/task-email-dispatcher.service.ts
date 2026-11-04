import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TaskNotificationMailer } from '../../mail/task-notification-mailer';
import {
  dueReminderOccurrence,
  dueReminderSchedule,
} from './due-reminder-time';

type Claimed = {
  id: string;
  recipient_user_id: string;
  board_id: string | null;
  card_id: string | null;
  kind: string;
  attempts: number;
};

@Injectable()
export class TaskEmailDispatcher {
  private readonly logger = new Logger(TaskEmailDispatcher.name);
  private readonly owner = randomUUID();
  constructor(
    private readonly db: DataSource,
    private readonly mailer: TaskNotificationMailer,
  ) {}

  async releaseOwned(): Promise<void> {
    await this.db.query(
      `UPDATE task_notification_email_outbox SET
        status=CASE WHEN first_attempt_at IS NULL THEN 'PENDING' ELSE 'UNKNOWN' END,
        lease_owner=NULL, lease_until=NULL, updated_at=clock_timestamp()
       WHERE status='PROCESSING' AND lease_owner=$1`,
      [this.owner],
    );
  }

  async drain(limit: number): Promise<void> {
    // A crashed sender may have reached the provider: never assume failure.
    await this.db.query(
      `WITH expired AS (SELECT id FROM task_notification_email_outbox
      WHERE status='PROCESSING' AND lease_until < now() ORDER BY lease_until, id
      FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE task_notification_email_outbox o SET
      status=CASE WHEN first_attempt_at IS NULL THEN 'PENDING' ELSE 'UNKNOWN' END,
      lease_owner=NULL, lease_until=NULL, updated_at=now()
      FROM expired WHERE o.id=expired.id`,
      [limit],
    );
    await this.db.query(
      `WITH stale AS (SELECT id FROM task_notification_email_outbox
      WHERE status='PENDING' AND created_at <= now() - interval '24 hours'
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT $1)
      UPDATE task_notification_email_outbox o SET status='CANCELLED', updated_at=now()
      FROM stale WHERE o.id=stale.id`,
      [limit],
    );
    const [rows]: [Claimed[], number] = await this.db.transaction(
      async (manager) =>
        manager.query(
          `WITH selected AS (
        SELECT id FROM task_notification_email_outbox
         WHERE status='PENDING' AND next_attempt_at <= now()
         ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT $1
      ) UPDATE task_notification_email_outbox o SET status='PROCESSING', lease_owner=$2,
          lease_until=now()+interval '2 minutes', updated_at=now()
        FROM selected WHERE o.id=selected.id
        RETURNING o.id, o.recipient_user_id, o.board_id, o.card_id, o.kind, o.attempts`,
          [limit, this.owner],
        ),
    );
    for (const row of rows) await this.send(row);
  }

  private async send(row: Claimed): Promise<void> {
    const recipient: string | null = await this.db.transaction(
      async (manager) => {
        // Match domain mutation order and keep the read grant stable until the
        // dispatch decision commits; provider I/O happens only afterwards.
        if (row.board_id) {
          await manager.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
            row.board_id,
          ]);
          await manager.query(
            `SELECT wm.user_id FROM workspace_members wm JOIN boards b ON b.workspace_id=wm.workspace_id
             WHERE b.id=$1 AND wm.user_id=$2 FOR KEY SHARE OF wm`,
            [row.board_id, row.recipient_user_id],
          );
        }
        // Serialize per-recipient rate checks across independent worker instances.
        const user = await manager.query(
          'SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE',
          [row.recipient_user_id],
        );
        if (!user.length) return null;
        const records: {
          email: string;
          due_date: Date | null;
          time_zone: string;
          occurrence_key: string;
          current_time: Date;
        }[] = await manager.query(
          `SELECT u.email, c.due_date, COALESCE(up.time_zone,'UTC') AS time_zone,
                  o.occurrence_key, clock_timestamp() AS current_time
          FROM task_notification_email_outbox o JOIN users u ON u.id=o.recipient_user_id
          JOIN notification_preferences p ON p.user_id=u.id
          JOIN cards c ON c.id=o.card_id AND c.board_id=o.board_id
          JOIN boards b ON b.id=c.board_id
          LEFT JOIN user_preferences up ON up.user_id=u.id
         WHERE o.id=$1 AND o.status='PROCESSING' AND o.lease_owner=$2 AND o.lease_until > clock_timestamp()
           AND o.created_at > clock_timestamp()-interval '24 hours' AND u.email_verified_at IS NOT NULL
           AND NOT c.is_archived AND NOT b.is_archived
           AND (o.kind <> 'DUE_REMINDER' OR (c.due_date > clock_timestamp() AND EXISTS
             (SELECT 1 FROM card_assignees a WHERE a.card_id=c.id AND a.user_id=u.id)))
           AND CASE o.kind WHEN 'CARD_ASSIGNED' THEN p.email_card_assigned
             WHEN 'COMMENT_MENTIONED' THEN p.email_comment_mentioned
             WHEN 'DUE_REMINDER' THEN p.email_due_reminder ELSE false END
           AND (EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id=u.id)
             OR (b.visibility='WORKSPACE_VISIBLE' AND EXISTS
               (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=b.workspace_id AND wm.user_id=u.id)))
         FOR UPDATE OF o`,
          [row.id, this.owner],
        );
        const record = records[0];
        const dueSchedule =
          row.kind === 'DUE_REMINDER' && record?.due_date
            ? dueReminderSchedule(record.due_date, record.time_zone)
            : null;
        if (
          !record ||
          (row.kind === 'DUE_REMINDER' &&
            (!dueSchedule ||
              dueSchedule.eligibleAt > record.current_time ||
              dueReminderOccurrence(
                row.recipient_user_id,
                row.card_id!,
                dueSchedule.localDueDate,
              ) !== record.occurrence_key))
        ) {
          await manager.query(
            `UPDATE task_notification_email_outbox SET status='CANCELLED', lease_owner=NULL, lease_until=NULL, updated_at=now()
          WHERE id=$1 AND status='PROCESSING' AND lease_owner=$2`,
            [row.id, this.owner],
          );
          return null;
        }
        const [{ count }]: { count: string }[] = await manager.query(
          `SELECT count(*) AS count FROM task_notification_email_outbox
        WHERE recipient_user_id=$1 AND id<>$2 AND ((status='SENT' AND sent_at > clock_timestamp()-interval '24 hours')
          OR (status='UNKNOWN' AND last_attempt_at > clock_timestamp()-interval '24 hours')
          OR (status='PROCESSING' AND last_attempt_at > clock_timestamp()-interval '24 hours'))`,
          [row.recipient_user_id, row.id],
        );
        if (Number(count) >= 10) {
          await manager.query(
            `UPDATE task_notification_email_outbox SET status='PENDING', next_attempt_at=now()+interval '1 hour',
          lease_owner=NULL, lease_until=NULL, updated_at=now() WHERE id=$1 AND lease_owner=$2`,
            [row.id, this.owner],
          );
          return null;
        }
        await manager.query(
          `UPDATE task_notification_email_outbox SET first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()), last_attempt_at=clock_timestamp(),
        attempts=attempts+1, lease_until=clock_timestamp()+interval '2 minutes', updated_at=clock_timestamp() WHERE id=$1 AND lease_owner=$2`,
          [row.id, this.owner],
        );
        return record.email;
      },
    );
    if (!recipient || !row.board_id || !row.card_id) return;
    const result = await this.mailer
      .send({
        recipient,
        boardId: row.board_id,
        cardId: row.card_id,
        outboxId: row.id,
      })
      .catch(() => 'UNKNOWN' as const);
    const attempt = row.attempts + 1;
    const delay = [1, 5, 15, 60, 240, 480][Math.min(attempt - 1, 5)];
    const status =
      result === 'RETRY' ? (attempt >= 6 ? 'FAILED' : 'PENDING') : result;
    await this.db.query(
      `UPDATE task_notification_email_outbox SET status=$3::varchar,
      sent_at=CASE WHEN $3::varchar='SENT' THEN now() ELSE sent_at END,
      next_attempt_at=CASE WHEN $3::varchar='PENDING' THEN now()+($4::integer * interval '1 minute') ELSE next_attempt_at END,
      lease_owner=NULL, lease_until=NULL, updated_at=now()
      WHERE id=$1 AND status='PROCESSING' AND lease_owner=$2`,
      [row.id, this.owner, status, delay],
    );
    this.logger.log(`Task email outcome: ${status}`);
  }
}
