import { Injectable, Logger } from '@nestjs/common';
import { RealtimeNotificationEvent } from '@kanban/shared';
import { NotificationInvalidation } from '../api/notifications/notification-invalidation';
import { RealtimeBroadcastService } from './realtime-broadcast.service';

/** Invalidation is best effort; PostgreSQL is the reconnect/reload authority. */
@Injectable()
export class NotificationEventPublisher extends NotificationInvalidation {
  private readonly logger = new Logger(NotificationEventPublisher.name);
  constructor(private readonly broadcast: RealtimeBroadcastService) {
    super();
  }
  async afterCommit(recipientUserIds: readonly string[]): Promise<void> {
    for (const recipient of [
      ...new Set(recipientUserIds.map((id) => id.toLowerCase())),
    ].sort()) {
      try {
        if (
          !(await this.broadcast.emitToUser(
            recipient,
            RealtimeNotificationEvent.CHANGED,
            {},
          ))
        )
          this.logger.warn('Notification realtime delivery unavailable');
      } catch {
        this.logger.error('Notification realtime delivery failed');
      }
    }
  }
}
