import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { PushDispatcher } from '../../src/api/push/push-dispatcher.service';
import { PushTokenCipher } from '../../src/api/push/push-token';
import { tokenContext } from '../../src/api/push/push-registry.service';
import { PushDeliveryOutbox } from '../../src/api/push/entities/push-delivery-outbox.entity';
import { UserPushPreference } from '../../src/api/push/entities/user-push-preference.entity';
import { UserPushSchedule } from '../../src/api/push/entities/user-push-schedule.entity';
import { PushDevice } from '../../src/api/push/entities/push-device.entity';
import { User } from '../../src/api/users/entities/user.entity';
import { UserPreferences } from '../../src/api/users/entities/user-preferences.entity';
import { NotificationPreference } from '../../src/api/notifications/entities/notification-preference.entity';
import { UserNotification } from '../../src/api/notifications/entities/user-notification.entity';
import type { ExpoPushProvider } from '../../src/api/push/expo-push.provider';
import type { NotificationResolver } from '../../src/api/notifications/notification-resolver.service';

// Exercises the public worker path with fake provider and deterministic clock.
// Repository fakes do NOT prove PostgreSQL locks, claim concurrency or SQL behavior.
describe('push quiet-hours send-time eligibility', () => {
  const now = new Date('2026-01-01T22:00:00Z');
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());
  function setup(
    options: {
      enabled?: boolean;
      zone?: string;
      expiry?: string;
      receipt?: boolean;
      push?: boolean;
      revoked?: boolean;
      acl?: boolean;
      deleted?: boolean;
      expiredDevice?: boolean;
      attempts?: number;
    } = {},
  ) {
    const config = new ConfigService({
      PUSH_NOTIFICATIONS_ENABLED: true,
      PUSH_PROJECT_ID: 'project',
      PUSH_APP_ENVIRONMENT: 'development',
      PUSH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    const device = {
      id: 'device',
      userId: 'user',
      active: !options.revoked,
      authVersion: 0,
      enrollmentRevision: 'revision',
      projectId: 'project',
      appEnvironment: 'development',
      installationId: 'installation',
      tokenFingerprint: 'fingerprint',
      leaseUntil: new Date(
        options.expiredDevice ? '2026-01-01T21:59:59Z' : '2026-01-03Z',
      ),
      sessionExpiresAt: new Date('2026-01-03Z'),
      encryptedToken: '',
    };
    device.encryptedToken = new PushTokenCipher(
      config.get('PUSH_TOKEN_ENCRYPTION_KEY')!,
    ).encrypt('ExpoPushToken[abcdefghijklmnop]', tokenContext(device));
    const job = {
      id: 'job',
      deviceId: 'device',
      notificationId: 'notification',
      recipientUserId: 'user',
      status: options.receipt ? 'RECEIPT_PROCESSING' : 'PROCESSING',
      leaseOwner: '',
      leaseUntil: new Date('2026-01-01T22:02:00Z'),
      enrollmentRevision: 'revision',
      expiresAt: new Date(options.expiry ?? '2026-01-02T22:00:00Z'),
      attempts: options.attempts ?? 0,
      receiptAttempts: 0,
      ticketId: options.receipt ? 'ticket' : null,
    };
    const schedule = {
      enabled: options.enabled ?? true,
      startLocal: '22:00',
      endLocal: '07:00',
    };
    const query = jest.fn(async (sql: string, parameters?: unknown[]) => {
      void parameters;
      if (sql === 'SELECT clock_timestamp() AS now')
        return [{ now: new Date() }];
      if (sql.includes('COALESCE(sum(attempts)'))
        return [{ device: 0, recipient: 0, recent: 0 }];
      return [];
    });
    const update = jest.fn();
    const manager = {
      query,
      getRepository(entity: unknown) {
        const value =
          entity === UserNotification
            ? {
                id: 'notification',
                recipientUserId: 'user',
                kind: 'CARD_ASSIGNED',
              }
            : entity === User
              ? {
                  authVersion: 0,
                  emailVerifiedAt: now,
                  deletedAt: options.deleted ? now : null,
                }
              : entity === PushDevice
                ? device
                : entity === PushDeliveryOutbox
                  ? job
                  : entity === UserPushPreference
                    ? { enabled: options.push ?? true }
                    : entity === UserPushSchedule
                      ? schedule
                      : entity === UserPreferences
                        ? { timeZone: options.zone ?? 'UTC' }
                        : entity === NotificationPreference
                          ? null
                          : undefined;
        if (value === undefined) throw new Error('Unexpected repository');
        return {
          findOneBy: jest.fn(async () => value),
          findOne: jest.fn(async () => value),
          update,
        };
      },
    };
    let claimed = false;
    const source = {
      query: jest.fn(async (sql: string, params: string[]) => {
        if (!sql.includes('WITH ready') || claimed) return [[], 0];
        claimed = true;
        job.leaseOwner = params[0];
        return [[{ id: job.id, status: job.status }], 1];
      }),
      transaction: async (run: (m: EntityManager) => unknown) =>
        run(manager as unknown as EntityManager),
    };
    const provider = {
      send: jest.fn(async () => ({ type: 'ticket', ticketId: 'ticket' })),
      receipt: jest.fn(async () => ({ type: 'accepted' })),
    };
    const resolver = {
      resolve: jest.fn(async () => [{ isUnavailable: options.acl === false }]),
    };
    const dispatcher = new PushDispatcher(
      source as unknown as DataSource,
      config as unknown as ConstructorParameters<typeof PushDispatcher>[1],
      provider as unknown as ExpoPushProvider,
      resolver as unknown as NotificationResolver,
    );
    return { dispatcher, provider, query, update, job, schedule, source };
  }
  it('never calls EPS while quiet; defers the same PENDING job without attempts/expiry changes', async () => {
    const f = setup();
    await f.dispatcher.drain();
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.provider.receipt).not.toHaveBeenCalled();
    const deferred = f.query.mock.calls.find(([sql]) =>
      sql.includes("last_error_code='QUIET_HOURS'"),
    );
    expect(deferred).toBeDefined();
    expect((deferred as unknown as [string, unknown[]])[1]).toEqual([
      'job',
      new Date('2026-01-02T07:00:00Z'),
    ]);
    expect(f.job.attempts).toBe(0);
    expect(f.job.expiresAt.toISOString()).toBe('2026-01-02T22:00:00.000Z');
    expect(
      f.source.query.mock.calls.filter(([sql]) => sql.includes('WITH ready')),
    ).toHaveLength(2);
  });
  it('preserves quiet early-wake marker only for expired unattempted claims', async () => {
    const f = setup();
    await f.dispatcher.drain();
    const recovery = f.source.query.mock.calls.find(([sql]) =>
      sql.includes('last_error_code=CASE'),
    );
    expect(recovery?.[0]).toContain(
      "WHEN status='PROCESSING' AND attempted_at IS NULL AND last_error_code='QUIET_HOURS' THEN 'QUIET_HOURS' ELSE 'LEASE_EXPIRED'",
    );
    expect(recovery?.[0]).toContain(
      "WHEN attempted_at IS NOT NULL THEN 'UNKNOWN' ELSE 'PENDING'",
    );
  });
  it('marks terminal expiry if the allowed instant reaches or exceeds original expiry', async () => {
    const f = setup({ expiry: '2026-01-02T07:00:00Z' });
    await f.dispatcher.drain();
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('status=$2'), [
      'job',
      'CANCELLED',
      'EXPIRED',
      0,
    ]);
    expect(f.job.attempts).toBe(0);
  });
  it.each([{ enabled: false }, { zone: 'Asia/Tokyo' }])(
    're-evaluates current schedule/zone at the attempt %j',
    async (options) => {
      const f = setup(options);
      await f.dispatcher.drain();
      expect(f.provider.send).toHaveBeenCalledTimes(1);
      expect(f.job.attempts).toBe(1);
    },
  );
  it('holds provider retries through quiet time without consuming another attempt', async () => {
    const f = setup({ attempts: 3 });
    await f.dispatcher.drain();
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.job.attempts).toBe(3);
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining("last_error_code='QUIET_HOURS'"),
      ['job', new Date('2026-01-02T07:00:00Z')],
    );
  });
  it('continues receipt polling during quiet hours without a new send', async () => {
    const f = setup({ receipt: true });
    await f.dispatcher.drain();
    expect(f.provider.receipt).toHaveBeenCalledWith('ticket');
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.update).toHaveBeenCalledWith('job', { receiptAttempts: 1 });
    expect(
      f.query.mock.calls.some(([sql]) => sql.includes('QUIET_HOURS')),
    ).toBe(false);
  });
  it.each([
    { push: false },
    { revoked: true },
    { acl: false },
    { deleted: true },
    { expiredDevice: true },
  ])('preserves opt-out/device/ACL rejection %j', async (options) => {
    const f = setup(options);
    await f.dispatcher.drain();
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('status=$2'), [
      'job',
      'CANCELLED',
      'INELIGIBLE',
      0,
    ]);
  });
});
