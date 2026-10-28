import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';

import { WorkspaceInvitation } from './entities/workspace-invitation.entity';

import { WorkspacesService } from './workspaces.service';
import { lockWorkspace, requireTeam } from './workspace-access';
import { readWorkspaceSnapshot } from './workspace-read';
import { invitationTime } from './workspace-invitation-issuance.service';
import {
  WorkspaceInvitationsQueryDto,
  toWorkspaceInvitationDto,
} from './dto/workspace-invitations.dto';

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
}
