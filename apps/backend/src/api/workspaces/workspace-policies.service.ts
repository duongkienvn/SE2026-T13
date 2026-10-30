import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceRole } from '@kanban/shared';
import { Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspacesService } from './workspaces.service';
import { lockWorkspace } from './workspace-access';
import { canCreateBoard } from './workspace-policy';
import { UpdateWorkspacePolicyDto } from './dto/workspace-policy.dto';
import { ApplicationException } from '../../exceptions/application.exception';
import { BoardRoomCoordinator } from '../../realtime/board-room-coordinator.service';
import { recordWorkspaceActivity } from './workspace-activity-writer';

@Injectable()
export class WorkspacePoliciesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly foundation: WorkspacesService,
    private readonly coordinator: BoardRoomCoordinator,
  ) {}

  get(actor: string, workspaceId: string) {
    return this.workspaces.manager.transaction(async (manager) => {
      const member = await this.foundation.requireMember(
        actor,
        workspaceId,
        manager,
      );
      return this.response(member);
    });
  }

  async update(
    actor: string,
    workspaceId: string,
    input: UpdateWorkspacePolicyDto,
  ) {
    if (Object.values(input).every((value) => value === undefined))
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'At least one policy is required',
      );
    const result = await this.workspaces.manager.transaction(
      async (manager) => {
        await lockWorkspace(manager, workspaceId);
        const member = await this.foundation.requireAdmin(
          actor,
          workspaceId,
          manager,
        );
        const workspace = member.workspace;
        const changed =
          (input.boardCreationAdminOnly !== undefined &&
            input.boardCreationAdminOnly !==
              workspace.boardCreationAdminOnly) ||
          (input.boardInvitesEnabled !== undefined &&
            input.boardInvitesEnabled !== workspace.boardInvitesEnabled) ||
          (input.boardMembershipChangesEnabled !== undefined &&
            input.boardMembershipChangesEnabled !==
              workspace.boardMembershipChangesEnabled) ||
          (input.boardVisibilityChangesEnabled !== undefined &&
            input.boardVisibilityChangesEnabled !==
              workspace.boardVisibilityChangesEnabled);
        if (input.boardCreationAdminOnly !== undefined)
          workspace.boardCreationAdminOnly = input.boardCreationAdminOnly;
        if (input.boardInvitesEnabled !== undefined)
          workspace.boardInvitesEnabled = input.boardInvitesEnabled;
        if (input.boardMembershipChangesEnabled !== undefined)
          workspace.boardMembershipChangesEnabled =
            input.boardMembershipChangesEnabled;
        if (input.boardVisibilityChangesEnabled !== undefined)
          workspace.boardVisibilityChangesEnabled =
            input.boardVisibilityChangesEnabled;
        await manager.getRepository(Workspace).save(workspace);
        if (changed)
          await recordWorkspaceActivity(manager, {
            workspaceId,
            actorId: actor,
            eventType: 'POLICY_UPDATED',
          });
        const recipients: { userId: string }[] = changed
          ? await manager.query(
              `SELECT user_id AS "userId" FROM workspace_members WHERE workspace_id = $1
            UNION SELECT bm.user_id AS "userId" FROM board_members bm
            JOIN boards b ON b.id = bm.board_id WHERE b.workspace_id = $1`,
              [workspaceId],
            )
          : [];
        return {
          policy: this.response(member),
          recipients: recipients.map(({ userId }) => userId),
        };
      },
    );
    this.coordinator.notifyAccessChanged(result.recipients);
    return result.policy;
  }

  private response(
    member: import('./entities/workspace-member.entity').WorkspaceMember,
  ) {
    const workspace = member.workspace;
    return {
      boardCreationAdminOnly: workspace.boardCreationAdminOnly,
      boardInvitesEnabled: workspace.boardInvitesEnabled,
      boardMembershipChangesEnabled: workspace.boardMembershipChangesEnabled,
      boardVisibilityChangesEnabled: workspace.boardVisibilityChangesEnabled,
      canManagePolicies: member.role === WorkspaceRole.ADMIN,
      canCreateBoards: canCreateBoard(member),
    };
  }
}
