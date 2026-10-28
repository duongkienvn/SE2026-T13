import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { EnvironmentConfig } from '../../config/environment';
import { welcomeEmail } from '../../mail/welcome-email';
import { WelcomeMailer } from '../../mail/welcome-mailer';
import { User } from '../users/entities/user.entity';
import { WelcomeEmailDelivery } from './entities/welcome-email-delivery.entity';

// Leave an hour of margin inside Resend's 24-hour idempotency retention.
export const WELCOME_RETRY_WINDOW_MS = 23 * 60 * 60_000;
const LEASE_MS = 60_000; // Longer than the adapter's 10-second abort deadline.
const SWEEP_MS = 30_000;

@Injectable()
export class WelcomeOnboardingService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WelcomeOnboardingService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly source: DataSource,
    private readonly mailer: WelcomeMailer,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}

  /** Only signup calls this, in the same transaction as User + Personal Workspace. */
  async enroll(manager: EntityManager, user: User): Promise<void> {
    this.requireTransaction(manager);
    const repository = manager.getRepository(WelcomeEmailDelivery);
    await repository.insert({ userId: user.id });
    if (user.emailVerifiedAt) await this.ready(manager, user);
  }

  /** Existing users have no row; verification cannot enroll them retroactively. */
  async ready(manager: EntityManager, user: User): Promise<void> {
    this.requireTransaction(manager);
    if (!user.emailVerifiedAt) return;
    await manager.getRepository(WelcomeEmailDelivery).update(
      { userId: user.id, readyAt: IsNull() },
      {
        readyAt: user.emailVerifiedAt,
        message: {
          from: this.config.get('MAIL_FROM', { infer: true }),
          to: user.email,
          ...welcomeEmail(this.config.get('PUBLIC_APP_URL', { infer: true })),
        },
      },
    );
  }

  onApplicationBootstrap(): void {
    void this.deliverPending();
    this.timer = setInterval(() => void this.deliverPending(), SWEEP_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Best effort after commit. All delivery/storage failures stay out of auth. */
  async deliverPending(userId?: string): Promise<void> {
    if (this.stopping || this.running) return;
    const work = this.drain(userId);
    this.running = work;
    try {
      await work;
    } catch {
      this.logger.warn(
        'Welcome email dispatch unavailable; pending records retained',
      );
    } finally {
      this.running = undefined;
    }
  }

  private async drain(userId?: string): Promise<void> {
    for (let i = 0; i < (userId ? 1 : 10) && !this.stopping; i++) {
      const delivery = await this.claim(userId);
      if (!delivery) return;
      if (delivery.stoppedAt) {
        this.logger.warn(
          'Welcome email retry window ended; reconciliation required',
        );
        continue;
      }
      let accepted = false;
      try {
        // Claim transaction has committed. Frozen sender/body + key survive restarts.
        await this.mailer.send(delivery.message!, `welcome/${delivery.userId}`);
        accepted = true;
      } catch {
        this.logger.warn('Welcome email delivery unavailable; retry scheduled');
      }
      // CAS fences late completions after another process has reclaimed the lease.
      // If this write fails, retain the lease and retry the SAME provider key/body.
      await this.source.getRepository(WelcomeEmailDelivery).update(
        { userId: delivery.userId, leaseToken: delivery.leaseToken! },
        {
          ...(accepted ? { sentAt: () => 'CURRENT_TIMESTAMP' } : {}),
          leaseToken: null,
          leaseUntil: null,
        },
      );
    }
  }

  private claim(userId?: string): Promise<WelcomeEmailDelivery | null> {
    return this.source.transaction(async (manager) => {
      const repository = manager.getRepository(WelcomeEmailDelivery);
      const query = repository
        .createQueryBuilder('delivery')
        .addSelect('delivery.message')
        .where('delivery.ready_at IS NOT NULL')
        .andWhere('delivery.sent_at IS NULL AND delivery.stopped_at IS NULL')
        .andWhere('delivery.next_attempt_at <= CURRENT_TIMESTAMP')
        .andWhere(
          '(delivery.lease_until IS NULL OR delivery.lease_until <= CURRENT_TIMESTAMP)',
        )
        .orderBy('delivery.next_attempt_at', 'ASC')
        .addOrderBy('delivery.user_id', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked');
      if (userId) query.andWhere('delivery.user_id = :userId', { userId });
      const delivery = await query.getOne();
      if (!delivery) return null;
      // Use database time consistently across application instances.
      const [{ now }]: { now: Date }[] = await manager.query(
        'SELECT CURRENT_TIMESTAMP AS now',
      );
      if (
        delivery.firstAttemptAt &&
        now.getTime() - delivery.firstAttemptAt.getTime() >=
          WELCOME_RETRY_WINDOW_MS
      ) {
        delivery.stoppedAt = now;
        delivery.leaseToken = null;
        delivery.leaseUntil = null;
      } else {
        delivery.firstAttemptAt ??= now;
        delivery.attempts++;
        delivery.leaseToken = randomUUID();
        delivery.leaseUntil = new Date(now.getTime() + LEASE_MS);
        const backoffMs = Math.min(
          60 * 60_000,
          60_000 * 2 ** Math.min(delivery.attempts - 1, 6),
        );
        delivery.nextAttemptAt = new Date(now.getTime() + backoffMs);
      }
      return repository.save(delivery);
    });
  }

  private requireTransaction(manager: EntityManager): void {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error(
        'Welcome onboarding requires an active account transaction',
      );
  }
}
