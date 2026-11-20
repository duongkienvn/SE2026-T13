import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import { UserNotification } from '../../src/api/notifications/entities/user-notification.entity';
import { User } from '../../src/api/users/entities/user.entity';
import { PushDevice } from '../../src/api/push/entities/push-device.entity';
import { PushDeliveryOutbox } from '../../src/api/push/entities/push-delivery-outbox.entity';
import type { NotificationResolver } from '../../src/api/notifications/notification-resolver.service';
import {
  PushDispatcher,
  pushRetryDelay,
} from '../../src/api/push/push-dispatcher.service';
import type { ExpoPushProvider } from '../../src/api/push/expo-push.provider';
describe('push dispatcher boundaries', () => {
  it('never claims or calls a provider when disabled', async () => {
    const source = { query: jest.fn(), transaction: jest.fn() };
    const provider = { send: jest.fn(), receipt: jest.fn() };
    await new PushDispatcher(
      source as unknown as DataSource,
      new ConfigService({ PUSH_NOTIFICATIONS_ENABLED: false }),
      provider as ExpoPushProvider,
      {} as NotificationResolver,
    ).drain();
    expect(source.query).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });
  it('locks the live Board Workspace grant before the recipient and device', async () => {
    const order: string[] = [];
    const job = {
      id: 'job',
      notificationId: 'notification',
      recipientUserId: 'user',
      deviceId: 'device',
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        order.push(sql);
        return [];
      }),
      getRepository: (entity: unknown) => {
        if (entity === PushDeliveryOutbox)
          return { findOneBy: async () => job, findOne: async () => null };
        if (entity === UserNotification)
          return {
            findOneBy: async () => ({ boardId: 'board', workspaceId: null }),
          };
        return {
          findOne: async () => {
            order.push(
              entity === User
                ? 'user'
                : entity === PushDevice
                  ? 'device'
                  : 'other',
            );
            return null;
          },
        };
      },
    };
    const source = {
      query: jest.fn(async (sql: string) =>
        sql.includes('WITH ready')
          ? [[{ id: 'job', status: 'PROCESSING' }], 1]
          : [],
      ),
      transaction: async (run: (m: EntityManager) => Promise<unknown>) => {
        source.query.mockImplementation(async () => [[], 0]);
        return run(manager as unknown as EntityManager);
      },
    };
    const provider = { send: jest.fn(), receipt: jest.fn() };
    await new PushDispatcher(
      source as unknown as DataSource,
      new ConfigService({ PUSH_NOTIFICATIONS_ENABLED: true }),
      provider as ExpoPushProvider,
      {} as NotificationResolver,
    ).drain();
    expect(order[0]).toContain('FROM boards');
    expect(order[1]).toContain(
      'JOIN boards b ON b.workspace_id=wm.workspace_id',
    );
    expect(order[1]).toContain('FOR KEY SHARE OF wm');
    expect(order.slice(2)).toEqual(['user', 'device']);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it('bounds exponential backoff and jitter', () => {
    expect(pushRetryDelay(1, 0)).toBe(30_000);
    expect(pushRetryDelay(2, 1)).toBe(75_000);
    expect(pushRetryDelay(6, 1)).toBeLessThanOrEqual(975_000);
  });
  it('recovers possible acceptance as UNKNOWN rather than PENDING', async () => {
    const source = { query: jest.fn().mockResolvedValue([]) };
    const dispatcher = new PushDispatcher(
      source as unknown as DataSource,
      new ConfigService({ PUSH_NOTIFICATIONS_ENABLED: true }),
      {} as ExpoPushProvider,
      {} as NotificationResolver,
    );
    await dispatcher.releaseOwned();
    expect(source.query.mock.calls[0][0]).toContain(
      "WHEN attempted_at IS NOT NULL THEN 'UNKNOWN'",
    );
  });
});
