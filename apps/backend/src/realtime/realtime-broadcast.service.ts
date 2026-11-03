import type { RealtimeServerEvents } from '@kanban/shared';
import {
  RealtimeNotificationEvent,
  type NotificationsChangedPayload,
} from '@kanban/shared';
import { Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { BoardRoomCoordinator } from './board-room-coordinator.service';
import { RealtimeAuthService } from './realtime-auth.service';

type EventArguments<Event extends keyof RealtimeServerEvents> = Parameters<
  RealtimeServerEvents[Event]
>;

@Injectable()
export class RealtimeBroadcastService {
  private readonly logger = new Logger(RealtimeBroadcastService.name);

  constructor(
    private readonly coordinator: BoardRoomCoordinator,
    private readonly auth: RealtimeAuthService,
  ) {}

  /** No user rooms or client-selected channels. Recheck DB session version once
   * per recipient, then immutable owner/expiry immediately before every emit.
   * This channel intentionally accepts only the ID-free notification hint.
   */
  async emitToUser(
    recipientUserId: string,
    event: typeof RealtimeNotificationEvent.CHANGED,
    payload: NotificationsChangedPayload,
  ): Promise<boolean> {
    try {
      if (
        !isUUID(recipientUserId, '4') ||
        event !== RealtimeNotificationEvent.CHANGED ||
        !payload ||
        Object.keys(payload).length !== 0
      )
        return false;
      const server = this.coordinator.server;
      if (!server) return false;
      const recipient = recipientUserId.toLowerCase();
      const sockets = [...server.sockets.sockets.values()].filter(
        (socket) => socket.data.identity?.userId === recipient,
      );
      if (!sockets.length) return true;
      const version = await this.auth.currentUserVersion(recipient);
      let delivered = true;
      for (const socket of sockets) {
        if (!this.auth.isCurrentRecipient(socket, recipient, version)) continue;
        try {
          socket.emit(RealtimeNotificationEvent.CHANGED, {});
        } catch {
          delivered = false;
          this.logger.error('User notification realtime delivery failed');
        }
      }
      return delivered;
    } catch {
      this.logger.error('User notification realtime broadcast failed');
      return false;
    }
  }

  /** Call after commit, outside coordinator.run(). Failures never undo persistence. */
  async emitToBoard<
    Event extends Exclude<keyof RealtimeServerEvents, 'notifications:changed'> &
      string,
  >(
    boardId: string,
    event: Event,
    ...args: EventArguments<Event>
  ): Promise<boolean> {
    try {
      if (!isUUID(boardId)) throw new Error('Invalid board identifier');
      return await this.coordinator.run(boardId, () => {
        const server = this.coordinator.server;
        if (!server) return false;
        const canonicalId = boardId.toLowerCase();
        for (const socket of server.sockets.sockets.values()) {
          if (
            socket.data.authorizedBoardIds?.has(canonicalId) &&
            this.auth.isActive(socket)
          ) {
            // Select recipients from application grants, independently of stale
            // adapter rooms after leave/disconnect failures. Recovery is disabled,
            // so this direct emit does not ask the adapter to choose recipients.
            socket.emit(event, ...args);
          }
        }
        return true;
      });
    } catch {
      // Never log the error object, event name, token or business payload.
      this.logger.error('Board realtime broadcast failed');
      return false;
    }
  }
}
