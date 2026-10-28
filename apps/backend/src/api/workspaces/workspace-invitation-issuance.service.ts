import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceRole } from '@kanban/shared';
import { Repository, type EntityManager } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceInvitation } from './entities/workspace-invitation.entity';
import { WorkspacesService } from './workspaces.service';
import { lockWorkspace, requireTeam } from './workspace-access';
import {
  CreateWorkspaceInvitationDto,
  toWorkspaceInvitationDto,
} from './dto/workspace-invitations.dto';
import {
  WorkspaceInvitationMailer,
  INVITATION_TTL_MS,
  INVITATION_COOLDOWN_MS,
  INVITATION_DISPATCH_LEASE_MS,
  type WorkspaceInvitationMail,
  type InvitationSendState,
} from './workspace-invitation-mailer';
import { ErrorCode } from '../../common/dto/api-error';
import { ApplicationException } from '../../exceptions/application.exception';

export function invitationHash(proof: string): string {
  return createHash('sha256').update(proof).digest('hex');
}

export async function invitationTime(manager: EntityManager): Promise<Date> {
  const [row]: { now: Date }[] = await manager.query(
    'SELECT clock_timestamp() AS now',
  );
  return row.now;
}

@Injectable()
export class WorkspaceInvitationIssuanceService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly foundation: WorkspacesService,
    @Optional() private readonly mailer?: WorkspaceInvitationMailer,
  ) {}

  async create(
    actor: string,
    workspaceId: string,
    input: CreateWorkspaceInvitationDto,
  ) {
    const email = input.email.trim().toLowerCase();
    const reserved = await this.workspaces.manager.transaction(
      async (manager) => {
        // Shared across instances; serialize actor/recipient quotas before Workspace locks.
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`workspace-invite:actor:${actor}`],
        );
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`workspace-invite:email:${email}`],
        );
        await lockWorkspace(manager, workspaceId);
        const admin = await this.foundation.requireAdmin(
          actor,
          workspaceId,
          manager,
        );
        requireTeam(admin.workspace);
        if (input.role !== undefined && input.role !== WorkspaceRole.MEMBER)
          throw new ApplicationException(
            400,
            ErrorCode.VALIDATION_FAILED,
            'Invitations support MEMBER only',
          );
        const now = await invitationTime(manager);
        await this.checkLimits(manager, actor, workspaceId, email, now);
        const repository = manager.getRepository(WorkspaceInvitation);
        const prior = await repository.findOne({
          where: { workspaceId, email },
          order: { createdAt: 'DESC' },
        });
        if (
          prior &&
          (now.getTime() - prior.createdAt.getTime() < INVITATION_COOLDOWN_MS ||
            (!prior.revokedAt &&
              !prior.consumedAt &&
              prior.sendState === 'DISPATCHING' &&
              now.getTime() - prior.createdAt.getTime() <
                INVITATION_DISPATCH_LEASE_MS))
        )
          throw new ApplicationException(
            429,
            ErrorCode.TOO_MANY_REQUESTS,
            'Wait before requesting another invitation',
          );
        await repository
          .createQueryBuilder()
          .update()
          .set({ revokedAt: now, updatedAt: now })
          .where(
            'workspace_id = :workspaceId AND email = :email AND consumed_at IS NULL AND revoked_at IS NULL',
            { workspaceId, email },
          )
          .execute();
        const proof = randomBytes(32).toString('base64url');
        const invitation = await repository.save(
          repository.create({
            workspaceId,
            email,
            role: WorkspaceRole.MEMBER,
            invitedById: actor,
            tokenHash: invitationHash(proof),
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
            consumedAt: null,
            revokedAt: null,
            sendState: this.mailer ? 'DISPATCHING' : 'UNAVAILABLE',
          }),
        );
        const payload: WorkspaceInvitationMail = {
          invitationId: invitation.id,
          workspaceId,
          workspaceName: admin.workspace.name,
          recipient: email,
          role: invitation.role,
          proof,
          expiresAt: invitation.expiresAt,
          idempotencyKey: `workspace-invitation/${invitation.id}`,
        };
        return { invitation, payload };
      },
    );
    if (this.mailer) {
      const sendState = await this.dispatch(reserved.payload);
      // Never hold a transaction across transport I/O. Revoke/rotation wins over completion.
      await this.workspaces.manager.transaction(async (manager) => {
        await lockWorkspace(manager, workspaceId);
        const repository = manager.getRepository(WorkspaceInvitation);
        await repository
          .createQueryBuilder()
          .update()
          .set({ sendState })
          .where(
            'id = :id AND send_state = :state AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > clock_timestamp()',
            { id: reserved.invitation.id, state: 'DISPATCHING' },
          )
          .execute();
        reserved.invitation = await repository.findOneByOrFail({
          id: reserved.invitation.id,
        });
      });
    }
    return toWorkspaceInvitationDto(reserved.invitation, new Date());
  }

  private async dispatch(
    payload: WorkspaceInvitationMail,
  ): Promise<InvitationSendState> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        this.mailer?.send(payload),
        new Promise<'UNKNOWN'>((resolve) => {
          timeout = setTimeout(() => resolve('UNKNOWN'), 30000);
        }),
      ]);
      return outcome === 'SENT' || outcome === 'FAILED' ? outcome : 'UNKNOWN';
    } catch {
      // Transport errors may contain the proof; never log or reuse an uncertain payload.
      return 'UNKNOWN';
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async checkLimits(
    manager: EntityManager,
    actor: string,
    workspaceId: string,
    email: string,
    now: Date,
  ) {
    const [counts]: { actor: number; workspace: number; recipient: number }[] =
      await manager.query(
        `SELECT
      count(*) FILTER (WHERE invited_by_id = $1)::int AS actor,
      count(*) FILTER (WHERE workspace_id = $2)::int AS workspace,
      count(*) FILTER (WHERE email = $3)::int AS recipient
      FROM workspace_invitations WHERE created_at > $4`,
        [actor, workspaceId, email, new Date(now.getTime() - 3600000)],
      );
    if (counts.actor >= 30 || counts.workspace >= 100 || counts.recipient >= 5)
      throw new ApplicationException(
        429,
        ErrorCode.TOO_MANY_REQUESTS,
        'Invitation request limit reached',
      );
  }
}
