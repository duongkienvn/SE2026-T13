import { NotificationKind } from '@kanban/shared';
import { NotificationInvitationResolvers } from '../../src/api/notifications/notification-invitation-resolvers';
import { WorkspaceInvitationNotificationResolver } from '../../src/api/workspaces/workspace-invitation-notification-resolver';
import type { EntityManager } from 'typeorm';
import type { UserNotification } from '../../src/api/notifications/entities/user-notification.entity';

it('returns only the matching source and never invents an acceptance target', async () => {
  const registry = new NotificationInvitationResolvers();
  const resolver = new WorkspaceInvitationNotificationResolver(registry);
  const id = '10000000-0000-4000-8000-000000000001';
  const workspaceId = '20000000-0000-4000-8000-000000000002';
  const row = {
    id: 'notification',
    kind: NotificationKind.WORKSPACE_INVITED,
    workspaceId,
    dedupeKey: `WORKSPACE_INVITED:workspace:${id}`,
  } as UserNotification;
  const query = jest
    .fn()
    .mockResolvedValue([{ id, workspaceId, name: 'Team' }]);
  const manager = { query } as unknown as EntityManager;
  expect(await registry.resolve(manager, 'recipient', [row])).toEqual(
    new Map([['notification', { name: 'Team', workspaceId, boardId: null }]]),
  );
  expect(query.mock.calls[0][0]).toContain("i.send_state = 'SENT'");
  expect(query.mock.calls[0][0]).toContain('u.email_verified_at IS NOT NULL');
  query.mockResolvedValueOnce([]);
  expect((await registry.resolve(manager, 'recipient', [row])).size).toBe(0);
  resolver.onModuleDestroy();
  expect((await registry.resolve(manager, 'recipient', [row])).size).toBe(0);
});
