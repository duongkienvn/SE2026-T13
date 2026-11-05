import { Injectable } from '@nestjs/common';
import { NotificationKind } from '@kanban/shared';
import { DataSource } from 'typeorm';
import { NotificationService } from './notification.service';
import { NotificationEventPublisher } from '../../realtime/notification-event-publisher.service';
import { lockNotificationRecipient } from './notification-preferences';
import {
  dueReminderOccurrence,
  dueReminderSchedule,
} from './due-reminder-time';
import { enqueueTaskEmail } from './task-email-outbox';

type Candidate = {
  card_id: string;
  board_id: string;
  user_id: string;
  due_date: Date;
  due_cursor: string;
  time_zone: string;
  current_time: Date;
};
class ReminderBecameOverdue extends Error {}

/** A keyset cursor bounds each poll and eventually visits the whole due window. */
@Injectable()
export class DueReminderScanner {
  private cursor: { due: string; card: string; user: string } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
    private readonly events: NotificationEventPublisher,
  ) {}

  async scan(limit: number): Promise<void> {
    // A repeated local calendar day can make the earlier 09:00 occur nearly
    // three days before a late due instant; the index keeps this window bounded.
    const candidates: Candidate[] = await this.dataSource.query(
      `SELECT c.id AS card_id, c.board_id, a.user_id, c.due_date, c.due_date::text AS due_cursor,
              COALESCE(up.time_zone, 'UTC') AS time_zone, clock_timestamp() AS current_time
         FROM cards c JOIN boards b ON b.id = c.board_id
         JOIN card_assignees a ON a.card_id = c.id
         LEFT JOIN user_preferences up ON up.user_id = a.user_id
        WHERE NOT c.is_archived AND NOT b.is_archived
          AND c.due_date > now() AND c.due_date <= now() + interval '72 hours'
          AND ($1::timestamptz IS NULL OR (c.due_date, c.id, a.user_id) > ($1::timestamptz, $2::uuid, $3::uuid))
          AND (EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id=a.user_id)
            OR (b.visibility='WORKSPACE_VISIBLE' AND EXISTS
              (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=b.workspace_id AND wm.user_id=a.user_id)))
        ORDER BY c.due_date, c.id, a.user_id LIMIT $4`,
      [
        this.cursor?.due ?? null,
        this.cursor?.card ?? null,
        this.cursor?.user ?? null,
        limit,
      ],
    );
    if (!candidates.length) {
      this.cursor = null;
      return;
    }
    for (const candidate of candidates) {
      // Skip future work without locks, using the database clock rather than
      // the application's clock. The locked recheck below remains authoritative.
      const preview = dueReminderSchedule(
        candidate.due_date,
        candidate.time_zone,
      );
      if (preview.eligibleAt > candidate.current_time) {
        this.cursor = {
          due: candidate.due_cursor,
          card: candidate.card_id,
          user: candidate.user_id,
        };
        continue;
      }
      const created = await this.dataSource
        .transaction(async (manager) => {
          const board = await manager.query(
            'SELECT id FROM boards WHERE id=$1 AND NOT is_archived FOR UPDATE',
            [candidate.board_id],
          );
          if (!board.length) return false;
          // A Workspace member can read a visible Board without Board membership.
          // Hold that grant until commit so a concurrent Workspace leave cannot
          // invalidate it between the ACL query and the notification insert.
          await manager.query(
            `SELECT wm.user_id FROM workspace_members wm JOIN boards b ON b.workspace_id=wm.workspace_id
             WHERE b.id=$1 AND wm.user_id=$2 FOR KEY SHARE OF wm`,
            [candidate.board_id, candidate.user_id],
          );
          if (!(await lockNotificationRecipient(manager, candidate.user_id)))
            return false;
          const rows: (Omit<Candidate, 'due_cursor'> & {
            current_time: Date;
          })[] = await manager.query(
            `SELECT c.id AS card_id, c.board_id, a.user_id, c.due_date,
                  COALESCE(up.time_zone, 'UTC') AS time_zone, clock_timestamp() AS current_time
             FROM cards c JOIN boards b ON b.id=c.board_id
             JOIN card_assignees a ON a.card_id=c.id
             LEFT JOIN user_preferences up ON up.user_id=a.user_id
            WHERE c.id=$1 AND c.board_id=$2 AND a.user_id=$3
              AND NOT c.is_archived AND NOT b.is_archived AND c.due_date > clock_timestamp()
              AND (EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id=a.user_id)
                OR (b.visibility='WORKSPACE_VISIBLE' AND EXISTS
                  (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=b.workspace_id AND wm.user_id=a.user_id)))`,
            [candidate.card_id, candidate.board_id, candidate.user_id],
          );
          const row = rows[0];
          if (!row) return false;
          const schedule = dueReminderSchedule(row.due_date, row.time_zone);
          if (schedule.eligibleAt > row.current_time) return false;
          const occurrenceKey = dueReminderOccurrence(
            row.user_id,
            row.card_id,
            schedule.localDueDate,
          );
          const result = await this.notifications.record(manager, {
            kind: NotificationKind.DUE_REMINDER,
            recipientUserId: row.user_id,
            boardId: row.board_id,
            cardId: row.card_id,
            occurrenceKey,
          });
          await enqueueTaskEmail(manager, {
            kind: NotificationKind.DUE_REMINDER,
            recipientUserId: row.user_id,
            boardId: row.board_id,
            cardId: row.card_id,
            occurrenceKey,
          });
          const [{ still_due }]: { still_due: boolean }[] = await manager.query(
            'SELECT clock_timestamp() < $1::timestamptz AS still_due',
            [row.due_date],
          );
          if (!still_due) throw new ReminderBecameOverdue();
          return result.status === 'created';
        })
        .catch((error: unknown) => {
          if (error instanceof ReminderBecameOverdue) return false;
          throw error;
        });
      if (created) await this.events.afterCommit([candidate.user_id]);
      this.cursor = {
        due: candidate.due_cursor,
        card: candidate.card_id,
        user: candidate.user_id,
      };
    }
    if (candidates.length < limit) this.cursor = null;
  }
}
