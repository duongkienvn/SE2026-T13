import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { ApplicationException } from '../../exceptions/application.exception';

@Injectable()
export class BoardPolicyService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  async capabilities(workspaceId: string, owner: boolean) {
    const workspace = await this.workspaces.findOneBy({ id: workspaceId });
    if (!workspace)
      throw new ApplicationException(404, 'NOT_FOUND', 'Board not found');
    return {
      canInviteMembers: owner && workspace.boardInvitesEnabled,
      canChangeMembership: owner && workspace.boardMembershipChangesEnabled,
      canChangeVisibility: owner && workspace.boardVisibilityChangesEnabled,
    };
  }
}
