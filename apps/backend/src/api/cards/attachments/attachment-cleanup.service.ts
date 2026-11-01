import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EnvironmentConfig } from '../../../config/environment';
import { Board } from '../../boards/entities/board.entity';
import { CardAttachment } from '../entities/card-attachment.entity';
import { AttachmentCleanupJob } from '../entities/attachment-cleanup-job.entity';
import { AttachmentStorage } from './attachment-storage';
import { ATTACHMENT_FILE_POLICY as POLICY } from './attachment-file-policy';

/** Durable expiry/deletion/reconciliation; no provider I/O inside transactions. */
@Injectable()
export class AttachmentCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private closing = false;
  private readonly logger = new Logger(AttachmentCleanupService.name);
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly storage: AttachmentStorage,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}
  onModuleInit() {
    if (
      !this.storage.available ||
      this.config.get('NODE_ENV', { infer: true }) === 'test'
    )
      return;
    this.timer = setInterval(() => {
      void this.sweep().catch(() =>
        this.logger.warn('Attachment cleanup will retry'),
      );
    }, POLICY.cleanupIntervalMilliseconds);
    this.timer.unref();
    // Restart resumes persisted due work without waiting for the first interval.
    void this.sweep().catch(() =>
      this.logger.warn('Attachment cleanup will retry'),
    );
  }
  async onModuleDestroy() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }
  sweep(now = new Date()): Promise<void> {
    if (!this.storage.available || this.closing) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.run(now).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run(now: Date) {
    const manager = this.boards.manager;
    const expired = await manager
      .getRepository(CardAttachment)
      .createQueryBuilder('asset')
      .select(['asset.id', 'asset.boardId'])
      .where(
        "asset.kind='FILE' AND asset.state='PENDING' AND asset.expiresAt <= :now",
        { now },
      )
      .andWhere(
        '(asset.verificationExpiresAt IS NULL OR asset.verificationExpiresAt <= :now)',
        { now },
      )
      .orderBy('asset.expiresAt', 'ASC')
      .addOrderBy('asset.id', 'ASC')
      .take(50)
      .getMany();
    for (const candidate of expired) {
      if (this.closing) return;
      await manager.transaction(async (transaction) => {
        const board = await transaction.getRepository(Board).findOne({
          where: { id: candidate.boardId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!board) return;
        const repository = transaction.getRepository(CardAttachment);
        const row = await repository
          .createQueryBuilder('asset')
          .addSelect([
            'asset.expiresAt',
            'asset.verificationExpiresAt',
            'asset.verificationToken',
          ])
          .where({ id: candidate.id })
          .getOne();
        if (
          !row ||
          row.state !== 'PENDING' ||
          !row.expiresAt ||
          row.expiresAt > now ||
          (row.verificationExpiresAt && row.verificationExpiresAt > now)
        )
          return;
        // Never re-save hidden immutable fields (legacy timestamps may have microseconds).
        await repository.update(
          { id: row.id },
          {
            state: 'EXPIRED',
            verificationToken: null,
            verificationExpiresAt: null,
            revision: row.revision + 1,
          },
        );
      });
    }
    // Claim immediately before each bounded operation; a five-minute lease exceeds SDK I/O.
    for (let count = 0; count < 10 && !this.closing; count++) {
      const ticket = await manager.transaction(async (transaction) => {
        const repository = transaction.getRepository(AttachmentCleanupJob);
        const row = await repository
          .createQueryBuilder('job')
          .where('job.nextAttemptAt <= :now AND job.notBefore <= :now', { now })
          .orderBy('job.nextAttemptAt', 'ASC')
          .addOrderBy('job.objectKey', 'ASC')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .take(1)
          .getOne();
        if (!row) return null;
        row.attempts++;
        row.nextAttemptAt = new Date(
          now.getTime() + POLICY.cleanupIntervalMilliseconds,
        );
        return repository.save(row);
      });
      if (!ticket) break;
      const reference = await manager
        .getRepository(CardAttachment)
        .createQueryBuilder('asset')
        .addSelect(['asset.pendingKey', 'asset.storageKey'])
        .where({ id: ticket.attachmentId })
        .getOne();
      const referenced =
        reference &&
        (reference.state === 'PENDING' ||
          (reference.state === 'ACTIVE' &&
            reference.storageKey === ticket.objectKey));
      if (referenced) {
        await this.finish(
          ticket,
          null,
          new Date(now.getTime() + POLICY.cleanupIntervalMilliseconds),
        );
        continue;
      }
      try {
        await this.storage.delete(ticket.objectKey);
        // Retain ownership tombstones and revisit: late/ambiguous provider writes cannot hide forever.
        await this.finish(
          ticket,
          now,
          new Date(now.getTime() + POLICY.reconciliationMilliseconds),
        );
      } catch {
        await this.finish(
          ticket,
          null,
          new Date(
            now.getTime() +
              Math.min(
                60 * 60_000,
                POLICY.cleanupIntervalMilliseconds *
                  2 ** Math.min(ticket.attempts - 1, 4),
              ),
          ),
        );
        this.logger.warn(
          'Attachment storage cleanup failed; durable retry retained',
        );
        break;
      }
    }
  }
  private async finish(
    ticket: AttachmentCleanupJob,
    completedAt: Date | null,
    nextAttemptAt: Date,
  ) {
    await this.boards.manager
      .getRepository(AttachmentCleanupJob)
      .createQueryBuilder()
      .update()
      .set({ completedAt, nextAttemptAt })
      .where(
        'object_key=:key AND attempts=:attempts AND next_attempt_at=:lease',
        {
          key: ticket.objectKey,
          attempts: ticket.attempts,
          lease: ticket.nextAttemptAt,
        },
      )
      .execute();
  }
}
