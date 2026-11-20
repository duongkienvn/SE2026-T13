import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager, QueryFailedError } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { EnvironmentConfig } from '../../config/environment';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { User } from '../users/entities/user.entity';
import { ApplicationException } from '../../exceptions/application.exception';
import { PushTokenCipher } from './push-token';
import { PushDevice } from './entities/push-device.entity';
import { UserPushPreference } from './entities/user-push-preference.entity';
import type { RegisterPushDeviceDto } from './push.dto';
import { JWT_EXPIRES_IN_SECONDS } from '../auth/constants/auth.constants';

/** Fixed server JWT lifetime fences every JWT issued through this second. */
export async function retirePushSession(
  m: EntityManager,
  userId: string,
  installationId: string,
  expiresAt: number,
) {
  const through = Math.max(
    expiresAt,
    Math.floor(Date.now() / 1000) * 1000 + JWT_EXPIRES_IN_SECONDS * 1000,
  );
  await m.query(
    `INSERT INTO push_device_revocations(user_id,installation_id,session_expires_through) VALUES ($1,$2,$3)
    ON CONFLICT(user_id,installation_id) DO UPDATE SET session_expires_through=GREATEST(push_device_revocations.session_expires_through,EXCLUDED.session_expires_through)`,
    [userId, installationId, new Date(through)],
  );
}

export function tokenContext(
  device: Pick<
    PushDevice,
    'installationId' | 'projectId' | 'appEnvironment' | 'tokenFingerprint'
  >,
) {
  return [
    device.installationId,
    device.projectId,
    device.appEnvironment,
    device.tokenFingerprint,
  ].join(':');
}
export async function cancelDeviceJobs(m: EntityManager, deviceId: string) {
  await m.query(
    `UPDATE push_delivery_outbox SET status='CANCELLED', lease_owner=NULL, lease_until=NULL, updated_at=clock_timestamp()
    WHERE device_id=$1 AND status IN ('PENDING','PROCESSING','TICKET','RECEIPT_PROCESSING')`,
    [deviceId],
  );
}
@Injectable()
export class PushRegistryService {
  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}
  get available() {
    return this.config.get('PUSH_NOTIFICATIONS_ENABLED', { infer: true });
  }
  private unavailable(): never {
    throw new ApplicationException(
      503,
      'PUSH_UNAVAILABLE',
      'Push delivery is unavailable',
    );
  }
  private conflict(): never {
    throw new ApplicationException(
      409,
      'PUSH_ENROLLMENT_CONFLICT',
      'This device cannot be enrolled with this session. Sign in again or retry device setup.',
    );
  }
  private async lockUser(m: EntityManager, session: AuthenticatedUser) {
    const user = await m.getRepository(User).findOne({
      where: { id: session.userId },
      lock: { mode: 'for_no_key_update' },
    });
    if (
      !user ||
      user.deletedAt ||
      !user.emailVerifiedAt ||
      user.authVersion !== session.authVersion ||
      session.expiresAt <= Date.now()
    )
      throw new ApplicationException(401, 'UNAUTHORIZED', 'Unauthorized');
  }
  async get(userId: string) {
    const row = await this.source
      .getRepository(UserPushPreference)
      .findOneBy({ userId });
    return {
      enabled: row?.enabled ?? false,
      deliveryAvailable: this.available,
    };
  }
  async current(session: AuthenticatedUser, installationId: string) {
    const device = await this.source
      .getRepository(PushDevice)
      .findOneBy({ userId: session.userId, installationId });
    return {
      registered: !!device?.active,
      eligible:
        !!device?.active &&
        this.available &&
        device.authVersion === session.authVersion &&
        device.leaseUntil.getTime() > Date.now() &&
        device.sessionExpiresAt.getTime() > Date.now() &&
        device.projectId ===
          this.config.get('PUSH_PROJECT_ID', { infer: true }) &&
        device.appEnvironment ===
          this.config.get('PUSH_APP_ENVIRONMENT', { infer: true }),
    };
  }
  async update(session: AuthenticatedUser, enabled: boolean) {
    if (enabled && !this.available) this.unavailable();
    return this.source.transaction(async (m) => {
      await this.lockUser(m, session);
      if (enabled) {
        const rows: { id: string }[] = await m.query(
          `SELECT id FROM push_devices WHERE user_id=$1 AND active AND auth_version=$2 AND lease_until>clock_timestamp() AND session_expires_at>clock_timestamp() AND project_id=$3 AND app_environment=$4 LIMIT 1`,
          [
            session.userId,
            session.authVersion,
            this.config.get('PUSH_PROJECT_ID', { infer: true }),
            this.config.get('PUSH_APP_ENVIRONMENT', { infer: true }),
          ],
        );
        if (!rows.length)
          throw new ApplicationException(
            409,
            'PUSH_DEVICE_REQUIRED',
            'Enable notifications on this device first',
          );
      }
      await m.query(
        'INSERT INTO user_push_preferences(user_id,enabled) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=clock_timestamp()',
        [session.userId, enabled],
      );
      if (!enabled) {
        await m.query(
          'UPDATE push_devices SET active=false,updated_at=clock_timestamp() WHERE user_id=$1',
          [session.userId],
        );
        await m.query(
          `UPDATE push_delivery_outbox SET status='CANCELLED',lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE recipient_user_id=$1 AND status IN ('PENDING','PROCESSING','TICKET','RECEIPT_PROCESSING')`,
          [session.userId],
        );
      }
      return { enabled, deliveryAvailable: this.available };
    });
  }
  async register(session: AuthenticatedUser, input: RegisterPushDeviceDto) {
    input = {
      ...input,
      installationId: input.installationId.toLowerCase(),
      projectId: input.projectId.toLowerCase(),
    };
    if (!this.available) this.unavailable();
    if (
      input.projectId !== this.config.get('PUSH_PROJECT_ID', { infer: true }) ||
      input.appEnvironment !==
        this.config.get('PUSH_APP_ENVIRONMENT', { infer: true })
    )
      throw new ApplicationException(
        400,
        'PUSH_ENVIRONMENT_MISMATCH',
        'Device build does not match this push environment',
      );
    const cipher = new PushTokenCipher(
      this.config.get('PUSH_TOKEN_ENCRYPTION_KEY', { infer: true }),
    );
    const fingerprint = cipher.fingerprint(input.expoPushToken);
    try {
      return await this.source.transaction(async (m) => {
        // Identity advisory locks first, sorted users next, devices/outbox last.
        // Domain producers already hold Board then sorted recipient NO KEY UPDATE.
        for (const key of [
          `push:install:${input.installationId}`,
          `push:token:${fingerprint}`,
        ].sort())
          await m.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            [key],
          );
        const repo = m.getRepository(PushDevice);
        const previous = await repo.findOne({
          where: { installationId: input.installationId },
          select: {
            id: true,
            userId: true,
            tokenFingerprint: true,
            sessionExpiresAt: true,
            leaseUntil: true,
            enrollmentRevision: true,
            active: true,
            authVersion: true,
          },
        });
        for (const userId of [
          ...new Set([session.userId, ...(previous ? [previous.userId] : [])]),
        ].sort()) {
          await m.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [
            userId,
          ]);
        }
        await this.lockUser(m, session);
        const tokenOwner = await repo.findOne({
          where: { tokenFingerprint: fingerprint },
          select: { id: true },
        });
        if (tokenOwner && tokenOwner.id !== previous?.id) this.conflict();
        const revoked: { session_expires_through: Date }[] = await m.query(
          'SELECT session_expires_through FROM push_device_revocations WHERE user_id=$1 AND installation_id=$2',
          [session.userId, input.installationId],
        );
        if (
          revoked[0] &&
          session.expiresAt <= revoked[0].session_expires_through.getTime()
        )
          this.conflict();
        if (previous && previous.userId !== session.userId) {
          // A public installation UUID cannot transfer a live foreign routing
          // credential. Rotation is allowed once it is revoked/expired; otherwise
          // require possession of the same Expo credential as well as the JWT.
          if (
            previous.active &&
            previous.sessionExpiresAt.getTime() > Date.now() &&
            previous.leaseUntil.getTime() > Date.now() &&
            previous.tokenFingerprint !== fingerprint
          )
            this.conflict();
          await retirePushSession(
            m,
            previous.userId,
            input.installationId,
            previous.sessionExpiresAt.getTime(),
          );
        }
        const [{ count }]: { count: number }[] = await m.query(
          'SELECT count(*)::int AS count FROM push_devices WHERE user_id=$1 AND installation_id<>$2 AND active AND lease_until>clock_timestamp() AND session_expires_at>clock_timestamp()',
          [session.userId, input.installationId],
        );
        if (count >= 20)
          throw new ApplicationException(
            429,
            'PUSH_DEVICE_LIMIT',
            'Too many active push installations',
          );
        const changed =
          !previous ||
          previous.userId !== session.userId ||
          previous.tokenFingerprint !== fingerprint ||
          !previous.active ||
          previous.authVersion !== session.authVersion;
        if (previous && changed) await cancelDeviceJobs(m, previous.id);
        await repo.save(
          repo.create({
            id: previous?.id,
            userId: session.userId,
            installationId: input.installationId,
            platform: input.platform,
            projectId: input.projectId,
            appEnvironment: input.appEnvironment,
            tokenFingerprint: fingerprint,
            encryptedToken: cipher.encrypt(
              input.expoPushToken,
              tokenContext({ ...input, tokenFingerprint: fingerprint }),
            ),
            active: true,
            authVersion: session.authVersion,
            sessionExpiresAt: new Date(session.expiresAt),
            enrollmentRevision: changed
              ? randomUUID()
              : previous!.enrollmentRevision,
            leaseUntil: new Date(
              Math.min(Date.now() + 24 * 3600_000, session.expiresAt),
            ),
            lastSeenAt: new Date(),
          }),
        );
        return {
          installationId: input.installationId,
          registered: true as const,
        };
      });
    } catch (error) {
      // Query errors can include parameters (encrypted routing credentials): never log/return them.
      if (error instanceof QueryFailedError)
        throw new ApplicationException(
          503,
          'PUSH_REGISTRATION_FAILED',
          'Device registration could not be completed. Retry.',
        );
      throw error;
    }
  }
  async remove(session: AuthenticatedUser, installationId: string) {
    installationId = installationId.toLowerCase();
    await this.source.transaction(async (m) => {
      await this.lockUser(m, session);
      // Persist even if an earlier enrollment POST has not arrived yet.
      await retirePushSession(
        m,
        session.userId,
        installationId,
        session.expiresAt,
      );
      const repo = m.getRepository(PushDevice);
      const device = await repo.findOne({
        where: { userId: session.userId, installationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!device) return;
      await repo.update(device.id, { active: false });
      await cancelDeviceJobs(m, device.id);
    });
  }
}
