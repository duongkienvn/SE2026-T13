import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceInvitation } from './entities/workspace-invitation.entity';
import { User } from '../users/entities/user.entity';
import { WorkspacesService } from './workspaces.service';
import { lockWorkspace, requireTeam } from './workspace-access';
import { readWorkspaceSnapshot } from './workspace-read';
import {
  invitationHash,
  invitationTime,
} from './workspace-invitation-issuance.service';
import {
  WorkspaceInvitationsQueryDto,
  toWorkspaceInvitationDto,
} from './dto/workspace-invitations.dto';
import { toWorkspaceMemberDto } from './dto/workspace-members.dto';
import { paginate } from '../../common/dto/paginated-response';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { ErrorCode } from '../../common/dto/api-error';
import { ApplicationException } from '../../exceptions/application.exception';

@Injectable()
export class WorkspaceInvitationsService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly foundation: WorkspacesService,
  ) {}

  list(
    actor: string,
    workspaceId: string,
    query: WorkspaceInvitationsQueryDto,
  ) {
    return readWorkspaceSnapshot(this.workspaces.manager, async (manager) => {
      await this.foundation.requireAdmin(actor, workspaceId, manager);
      const now = await invitationTime(manager);
      const builder = manager
        .getRepository(WorkspaceInvitation)
        .createQueryBuilder('invitation')
        .where('invitation.workspaceId = :workspaceId', { workspaceId });
      if (query.status === 'ACCEPTED')
        builder.andWhere('invitation.consumedAt IS NOT NULL');
      if (query.status === 'REVOKED')
        builder.andWhere('invitation.revokedAt IS NOT NULL');
      if (query.status === 'PENDING' || query.status === 'EXPIRED') {
        builder.andWhere(
          'invitation.consumedAt IS NULL AND invitation.revokedAt IS NULL',
        );
        builder.andWhere(
          `invitation.expiresAt ${query.status === 'PENDING' ? '>' : '<='} :now`,
          { now },
        );
      }
      const page = await paginateQueryBuilder(builder, query, 'createdAt');
      return paginate(
        page.data.map((row) => toWorkspaceInvitationDto(row, now)),
        page.meta.total,
        query,
      );
    });
  }

  revoke(actor: string, workspaceId: string, invitationId: string) {
    return this.workspaces.manager.transaction(async (manager) => {
      await lockWorkspace(manager, workspaceId);
      const admin = await this.foundation.requireAdmin(
        actor,
        workspaceId,
        manager,
      );
      requireTeam(admin.workspace);
      const repository = manager.getRepository(WorkspaceInvitation);
      const invitation = await repository.findOneBy({
        id: invitationId,
        workspaceId,
      });
      if (!invitation)
        throw new ApplicationException(
          404,
          ErrorCode.NOT_FOUND,
          'Invitation not found',
        );
      if (invitation.consumedAt)
        throw new ApplicationException(
          409,
          ErrorCode.CONFLICT,
          'Accepted invitation cannot be revoked; remove membership explicitly',
        );
      if (!invitation.revokedAt)
        await repository.update(invitation.id, {
          revokedAt: await invitationTime(manager),
        });
    });
  }

  async accept(actor: string, proof: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) throw this.invalid();
    const tokenHash = invitationHash(proof);
    const candidate = await this.workspaces.manager
      .getRepository(WorkspaceInvitation)
      .findOneBy({ tokenHash });
    if (!candidate) throw this.invalid();
    return this.workspaces.manager.transaction(async (manager) => {
      const workspace = await lockWorkspace(manager, candidate.workspaceId);
      if (!workspace) throw this.invalid();
      requireTeam(workspace);
      const repository = manager.getRepository(WorkspaceInvitation);
      const invitation = await repository.findOneBy({
        id: candidate.id,
        tokenHash,
      });
      const now = await invitationTime(manager);
      if (
        !invitation ||
        invitation.revokedAt ||
        invitation.consumedAt ||
        invitation.expiresAt <= now
      )
        throw this.invalid();
      const user = await manager
        .getRepository(User)
        .findOne({ where: { id: actor }, lock: { mode: 'pessimistic_read' } });
      if (!user?.emailVerifiedAt)
        throw new ApplicationException(
          403,
          ErrorCode.EMAIL_NOT_VERIFIED,
          'Verify your email before accepting an invitation',
        );
      if (user.email.trim().toLowerCase() !== invitation.email)
        throw this.invalid();
      if (invitation.sendState !== 'SENT')
        throw new ApplicationException(
          409,
          ErrorCode.CONFLICT,
          'Invitation delivery is not confirmed; ask an ADMIN to retry',
        );
      const members = manager.getRepository(WorkspaceMember);
      let member = await members.findOneBy({
        workspaceId: workspace.id,
        userId: actor,
      });
      if (!member)
        member = await members.save(
          members.create({
            workspaceId: workspace.id,
            userId: actor,
            role: invitation.role,
          }),
        );
      const consumed = await repository
        .createQueryBuilder()
        .update()
        .set({ consumedAt: () => 'clock_timestamp()' })
        .where(
          'id = :id AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > clock_timestamp()',
          { id: invitation.id },
        )
        .execute();
      if (consumed.affected !== 1) throw this.invalid();
      member.user = user;
      return toWorkspaceMemberDto(member);
    });
  }

  private invalid() {
    return new ApplicationException(
      410,
      ErrorCode.INVALID_WORKSPACE_INVITATION,
      'Invitation is unavailable; use the invited account or request a new invitation',
    );
  }
}
