import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
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
