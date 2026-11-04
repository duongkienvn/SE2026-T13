import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { NotificationKind } from '@kanban/shared';
import { isUUID } from 'class-validator';
import { NotificationInvitationResolvers } from '../notifications/notification-invitation-resolvers';
import { notificationOccurrence } from '../notifications/notification-record';

@Injectable()
export class WorkspaceInvitationNotificationResolver implements OnModuleDestroy {
  private readonly unregister: () => void;
  constructor(registry: NotificationInvitationResolvers) {
    this.unregister = registry.register(
      NotificationKind.WORKSPACE_INVITED,
      async (manager, recipient, notifications) => {
        const ids = notifications
          .map(notificationOccurrence)
          .filter((id) => isUUID(id, '4'));
        const values = new Map<
          string,
          { name: string; workspaceId: string; boardId: null }
        >();
        if (!ids.length) return values;
        const rows: { id: string; workspaceId: string; name: string }[] =
          await manager.query(
            `
        SELECT i.id, i.workspace_id AS "workspaceId", w.name
        FROM workspace_invitations i JOIN workspaces w ON w.id = i.workspace_id
        JOIN users u ON u.id = $1 AND u.email_verified_at IS NOT NULL AND lower(btrim(u.email)) = i.email
        WHERE i.id = ANY($2::uuid[]) AND i.send_state = 'SENT'
          AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.declined_at IS NULL
          AND i.expires_at > clock_timestamp()`,
            [recipient, ids],
          );
        const byId = new Map(rows.map((row) => [row.id, row]));
        for (const notification of notifications) {
          const row = byId.get(notificationOccurrence(notification));
          if (row && row.workspaceId === notification.workspaceId)
            values.set(notification.id, {
              name: row.name,
              workspaceId: row.workspaceId,
              boardId: null,
            });
        }
        return values;
      },
    );
  }
  onModuleDestroy() {
    this.unregister();
  }
}
