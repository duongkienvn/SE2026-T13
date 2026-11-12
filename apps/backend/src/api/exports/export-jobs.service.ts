import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, MoreThan } from 'typeorm';
import { isUUID } from 'class-validator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { ApplicationException } from '../../exceptions/application.exception';
import { BoardExportService } from './board-export.service';
import { ExportSnapshot, snapshotAuthorization } from './export-snapshot';
import { BoardExportJob } from './entities/board-export-job.entity';
import { canRetryExportJob, toExportJobResponse } from './export-job-policy';

const notFound = () =>
  new ApplicationException(404, 'NOT_FOUND', 'Export job not found');

@Injectable()
export class ExportJobsService {
  constructor(
    private readonly source: DataSource,
    private readonly boards: BoardExportService,
    private readonly snapshots: ExportSnapshot,
  ) {}

  private async authorize(
    actor: AuthenticatedUser,
    boardId: string,
  ): Promise<void> {
    await this.snapshots.read(async (manager) => {
      await snapshotAuthorization(manager).requireOwner(actor.userId, boardId);
      await this.snapshots.requireSession(actor, manager);
    });
  }

  async start(
    actor: AuthenticatedUser,
    boardId: string,
    key: string | undefined,
    format: 'json' | 'csv',
  ) {
    if (!key || !isUUID(key, '4'))
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'Idempotency-Key must be a UUID v4',
      );
    await this.authorize(actor, boardId);
    const repository = this.source.getRepository(BoardExportJob);
    // Database uniqueness fences simultaneous retries across processes.
    await repository
      .createQueryBuilder()
      .insert()
      .values({
        id: randomUUID(),
        userId: actor.userId,
        boardId,
        idempotencyKey: key.toLowerCase(),
        format,
        authVersion: actor.authVersion,
        sessionExpiresAt: new Date(actor.expiresAt),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .orIgnore()
      .execute();
    const row = await repository.findOneBy({
      userId: actor.userId,
      idempotencyKey: key.toLowerCase(),
    });
    if (!row) throw notFound();
    if (row.boardId !== boardId || row.format !== format)
      throw new ApplicationException(
        409,
        'EXPORT_IDEMPOTENCY_CONFLICT',
        'Key already used for a different export',
      );
    this.requireUnexpired(row);
    return toExportJobResponse(row);
  }

  private requireUnexpired(row: BoardExportJob): void {
    if (row.expiresAt.getTime() <= Date.now())
      throw new ApplicationException(
        410,
        'EXPORT_EXPIRED',
        'Export expired; start a new operation',
      );
  }

  async status(actor: AuthenticatedUser, boardId: string, id: string) {
    await this.authorize(actor, boardId);
    const row = await this.source
      .getRepository(BoardExportJob)
      .findOneBy({ id, userId: actor.userId, boardId });
    if (!row) throw notFound();
    this.requireUnexpired(row);
    return toExportJobResponse(row);
  }

  async retry(actor: AuthenticatedUser, boardId: string, id: string) {
    await this.authorize(actor, boardId);
    return this.source.transaction(async (manager) => {
      const repository = manager.getRepository(BoardExportJob);
      const row = await repository.findOne({
        where: { id, boardId, userId: actor.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw notFound();
      this.requireUnexpired(row);
      if (canRetryExportJob(row, new Date())) {
        await repository.update(row.id, {
          state: 'PENDING',
          authVersion: actor.authVersion,
          sessionExpiresAt: new Date(actor.expiresAt),
        });
        row.state = 'PENDING';
      } else if (row.state === 'FAILED') {
        throw new ApplicationException(
          409,
          'EXPORT_RETRY_EXHAUSTED',
          'Export retry limit reached',
        );
      }
      return toExportJobResponse(row);
    });
  }

  async download(actor: AuthenticatedUser, boardId: string, id: string) {
    await this.authorize(actor, boardId);
    const row = await this.source
      .getRepository(BoardExportJob)
      .createQueryBuilder('job')
      .addSelect('job.body')
      .where({ id, boardId, userId: actor.userId })
      .getOne();
    if (!row) throw notFound();
    this.requireUnexpired(row);
    await this.authorize(actor, boardId);
    if (row.state !== 'COMPLETED' || !row.body)
      throw new ApplicationException(
        409,
        'EXPORT_NOT_READY',
        'Export is not ready',
      );
    this.requireUnexpired(row);
    return { body: row.body, format: row.format };
  }

  /** One claim/attempt; exposed for deterministic integration and load harnesses. */
  async processNext(): Promise<boolean> {
    const row = await this.source.transaction(async (manager) => {
      const repository = manager.getRepository(BoardExportJob);
      const job = await repository
        .createQueryBuilder('job')
        .addSelect(['job.authVersion', 'job.sessionExpiresAt'])
        .where('job.expiresAt > CURRENT_TIMESTAMP AND job.attempts < 3')
        .andWhere(
          "(job.state = 'PENDING' OR (job.state = 'RUNNING' AND job.leaseExpiresAt < CURRENT_TIMESTAMP))",
        )
        .orderBy('job.createdAt', 'ASC')
        .addOrderBy('job.id', 'ASC')
        .take(1)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();
      if (!job) return null;
      job.state = 'RUNNING';
      job.attempts++;
      job.leaseToken = randomUUID();
      job.leaseExpiresAt = new Date(Date.now() + 60_000);
      await repository.update(job.id, {
        state: job.state,
        attempts: job.attempts,
        leaseToken: job.leaseToken,
        leaseExpiresAt: job.leaseExpiresAt,
      });
      return job;
    });
    if (!row) return false;
    const actor = {
      userId: row.userId,
      authVersion: row.authVersion,
      expiresAt: row.sessionExpiresAt.getTime(),
    };
    const repository = this.source.getRepository(BoardExportJob);
    try {
      await this.authorize(actor, row.boardId);
      const body = await this.boards.create(
        row.userId,
        row.boardId,
        row.format,
      );
      await this.authorize(actor, row.boardId);
      // Lease token prevents a late worker from overwriting a reclaimed attempt.
      await repository.update(
        {
          id: row.id,
          state: 'RUNNING',
          leaseToken: row.leaseToken!,
          leaseExpiresAt: MoreThan(new Date()),
          expiresAt: MoreThan(new Date()),
        },
        { state: 'COMPLETED', body, leaseToken: null, leaseExpiresAt: null },
      );
    } catch {
      // Do not persist/log raw SQL, export bytes or provider exceptions.
      await repository.update(
        { id: row.id, state: 'RUNNING', leaseToken: row.leaseToken! },
        { state: 'FAILED', body: null, leaseToken: null, leaseExpiresAt: null },
      );
    }
    return true;
  }

  async sweep(): Promise<void> {
    const repository = this.source.getRepository(BoardExportJob);
    await repository
      .createQueryBuilder()
      .update()
      .set({ body: null })
      .where('expires_at <= CURRENT_TIMESTAMP AND body IS NOT NULL')
      .execute();
    await repository
      .createQueryBuilder()
      .update()
      .set({
        state: 'FAILED',
        body: null,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        "state IN ('PENDING','RUNNING') AND (expires_at <= CURRENT_TIMESTAMP OR (attempts >= 3 AND lease_expires_at <= CURRENT_TIMESTAMP))",
      )
      .execute();
  }
}
