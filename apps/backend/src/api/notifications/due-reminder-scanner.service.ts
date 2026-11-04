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
  time_zone: string;
};

/** A keyset cursor bounds each poll and eventually visits the whole due window. */
@Injectable()
export class DueReminderScanner {
  private cursor: { card: string; user: string } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
    private readonly events: NotificationEventPublisher,
  ) {}

  async scan(limit: number): Promise<void> {
    const candidates: Candidate[] = await this.dataSource.query(
      `SELECT c.id AS card_id, c.board_id, a.user_id, c.due_date,
              COALESCE(up.time_zone, 'UTC') AS time_zone
         FROM cards c JOIN boards b ON b.id = c.board_id
         JOIN card_assignees a ON a.card_id = c.id
         LEFT JOIN user_preferences up ON up.user_id = a.user_id
        WHERE NOT c.is_archived AND NOT b.is_archived
          AND c.due_date > now() AND c.due_date <= now() + interval '48 hours'
          AND ($1::uuid IS NULL OR (c.id, a.user_id) > ($1::uuid, $2::uuid))
          AND (EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id=a.user_id)
            OR (b.visibility='WORKSPACE_VISIBLE' AND EXISTS
              (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=b.workspace_id AND wm.user_id=a.user_id)))
        ORDER BY c.id, a.user_id LIMIT $3`,
      [this.cursor?.card ?? null, this.cursor?.user ?? null, limit],
    );
    if (!candidates.length) {
      this.cursor = null;
      return;
    }
    for (const candidate of candidates) {
      // Prime the calendar cache before taking a Board lock.
      dueReminderSchedule(candidate.due_date, candidate.time_zone);
      const created = await this.dataSource.transaction(async (manager) => {
        const board = await manager.query(
          'SELECT id FROM boards WHERE id=$1 AND NOT is_archived FOR UPDATE',
          [candidate.board_id],
        );
        if (
          !board.length ||
          !(await lockNotificationRecipient(manager, candidate.user_id))
        )
          return false;
        const rows: (Candidate & { current_time: Date })[] =
          await manager.query(
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
        return result.status === 'created';
      });
      if (created) await this.events.afterCommit([candidate.user_id]);
      this.cursor = { card: candidate.card_id, user: candidate.user_id };
    }
    if (candidates.length < limit) this.cursor = null;
  }
}
