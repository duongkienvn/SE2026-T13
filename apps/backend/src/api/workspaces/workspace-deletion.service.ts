import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceInvitation } from './entities/workspace-invitation.entity';
import { Board } from '../boards/entities/board.entity';
import { WorkspacesService } from './workspaces.service';
import { lockWorkspace, requireTeam } from './workspace-access';
import { BoardRoomCoordinator } from '../../realtime/board-room-coordinator.service';
import { ApplicationException } from '../../exceptions/application.exception';

@Injectable()
export class WorkspaceDeletionService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly foundation: WorkspacesService,
    private readonly coordinator: BoardRoomCoordinator,
  ) {}

  remove(actor: string, workspaceId: string, confirmationName: string) {
    return this.coordinator.withReadGrantChanges(async () => {
      const userIds = await this.workspaces.manager.transaction(
        async (manager) => {
          await lockWorkspace(manager, workspaceId);
          const admin = await this.foundation.requireAdmin(
            actor,
            workspaceId,
            manager,
          );
          requireTeam(admin.workspace);
          if (confirmationName !== admin.workspace.name)
            throw new ApplicationException(
              400,
              'VALIDATION_FAILED',
              'Workspace confirmation does not match',
            );
          if (await manager.getRepository(Board).existsBy({ workspaceId }))
            throw new ApplicationException(
              409,
              'CONFLICT',
              'Workspace must be empty before deletion',
            );
          const members = manager.getRepository(WorkspaceMember);
          const users = await members.find({
            where: { workspaceId },
            select: { userId: true },
          });
          // Preserve the one-hour actor/recipient quota when the Workspace rows go away.
          // Expired hashed entries are pruned opportunistically on Workspace deletion.
          await manager.query(`DELETE FROM deleted_workspace_invitation_quota
            WHERE created_at <= clock_timestamp() - interval '1 hour'`);
          await manager.query(
            `INSERT INTO deleted_workspace_invitation_quota
            (invitation_id, actor_id, recipient_hash, created_at)
            SELECT id, invited_by_id, encode(sha256(convert_to(email, 'UTF8')), 'hex'), created_at
            FROM workspace_invitations
            WHERE workspace_id = $1 AND created_at > clock_timestamp() - interval '1 hour'`,
            [workspaceId],
          );
          await manager
            .getRepository(WorkspaceInvitation)
            .delete({ workspaceId });
          await members.delete({ workspaceId });
          await manager.getRepository(Workspace).delete({ id: workspaceId });
          return users.map((member) => member.userId);
        },
      );
      for (const userId of userIds)
        this.coordinator.notifyWorkspaceRevoked(workspaceId, userId);
    });
  }
}
