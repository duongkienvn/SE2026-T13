import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { EmailChangeProof } from '../../auth/email-change-reauthentication.service';
import { invalidReauthentication } from '../../auth/email-change-reauthentication.service';
import { GoogleIdentity } from '../../auth/entities/google-identity.entity';
import { User } from '../entities/user.entity';
import { ApplicationException } from '../../../exceptions/application.exception';
import { BoardRoomCoordinator } from '../../../realtime/board-room-coordinator.service';
import { BoardEventPublisher } from '../../../realtime/board-event-publisher.service';
import { RealtimeServerEvent } from '@kanban/shared';
import {
  deletionResources,
  DeletionResourcesChanged,
  lockDeletionResources,
  requireDeletionEligible,
} from './account-deletion-locks';
import { eraseAccountPrivateState } from './account-deletion-state';

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  constructor(
    private readonly source: DataSource,
    private readonly sessions: BoardRoomCoordinator,
    private readonly events: BoardEventPublisher,
  ) {}

  /** No CPU-heavy verification or provider I/O inside this bounded transaction. */
  async delete(proof: EmailChangeProof): Promise<void> {
    const result = await this.sessions.withReadGrantChanges(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const outcome = await this.source.transaction(async (manager) => {
            await manager.query("SET LOCAL lock_timeout = '2s'");
            await manager.query("SET LOCAL statement_timeout = '5s'");
            // Same order as invitation issuance; preserve quota while scrubbing addresses.
            for (const key of [
              `workspace-invite:actor:${proof.userId}`,
              `workspace-invite:email:${proof.email}`,
            ])
              await manager.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                [key],
              );
            const resources = await deletionResources(
              manager,
              proof.userId,
              proof.email,
            );
            await lockDeletionResources(manager, resources);
            const users = manager.getRepository(User);
            const user = await users.findOne({
              where: { id: proof.userId },
              lock: { mode: 'pessimistic_write' },
            });
            if (
              !user ||
              user.deletedAt ||
              !user.emailVerifiedAt ||
              user.authVersion !== proof.authVersion ||
              user.email !== proof.email ||
              proof.expiresAt <= Date.now()
            )
              throw new ApplicationException(
                401,
                'UNAUTHORIZED',
                'Unauthorized',
              );
            if (
              (proof.passwordHash !== undefined) ===
              (proof.googleSub !== undefined)
            )
              throw invalidReauthentication();
            if (
              proof.passwordHash !== undefined &&
              user.passwordHash !== proof.passwordHash
            )
              throw invalidReauthentication();
            if (
              proof.googleSub !== undefined &&
              !(await manager
                .getRepository(GoogleIdentity)
                .existsBy({ userId: user.id, googleSub: proof.googleSub }))
            )
              throw invalidReauthentication();
            // The User lock now fences live-reference inserts. A grant that committed
            // during enumeration requires a fresh resource lock snapshot, never a guess.
            if (
              JSON.stringify(resources) !==
              JSON.stringify(
                await deletionResources(manager, user.id, user.email),
              )
            )
              throw new DeletionResourcesChanged();
            await requireDeletionEligible(manager, user.id);
            await eraseAccountPrivateState(manager, user);
            const [{ now }]: { now: Date }[] = await manager.query(
              'SELECT clock_timestamp() AS now',
            );
            await users.update(user.id, {
              deletedAt: now,
              email: `deleted+${user.id}@users.invalid`,
              displayName: 'Deleted user',
              passwordHash: null,
              emailVerifiedAt: null,
              avatarUrl: null,
              avatarObjectKey: null,
              avatarRevision: user.avatarRevision + 1,
              authVersion: user.authVersion + 1,
            });
            return { boards: resources.boards, version: user.authVersion + 1 };
          });
          // Publish the revocation floor before any asynchronous work, including
          // in-flight handshakes absent from the namespace's socket inventory.
          this.sessions.revokeUserSessions(proof.userId, outcome.version);
          return outcome;
        } catch (error) {
          const state =
            error instanceof QueryFailedError
              ? (error.driverError as { code?: string }).code
              : undefined;
          if (
            !(error instanceof DeletionResourcesChanged) &&
            !['40P01', '40001', '55P03'].includes(state ?? '')
          )
            throw error;
          if (attempt < 2) continue;
          throw new ApplicationException(
            409,
            'CONFLICT',
            'Account resources changed. Retry deletion after resolving concurrent changes.',
          );
        }
      }
    });
    // These invalidations may acquire Board queues. Never nest them in the
    // transaction/read-grant queue, and never turn a committed mutation into 500.
    for (const boardId of result.boards) {
      try {
        await this.events.publish(RealtimeServerEvent.MEMBER_REMOVED, {
          boardId,
          userId: proof.userId,
        });
      } catch {
        this.logger.warn('Account deletion realtime invalidation unavailable');
      }
    }
  }
}
