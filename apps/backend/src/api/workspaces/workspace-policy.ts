import { WorkspaceRole } from '@kanban/shared';
import type { EntityManager } from 'typeorm';
import { ApplicationException } from '../../exceptions/application.exception';
import { Workspace } from './entities/workspace.entity';
import type { WorkspaceMember } from './entities/workspace-member.entity';

export function canCreateBoard(member: WorkspaceMember): boolean {
  return (
    !member.workspace.boardCreationAdminOnly ||
    member.role === WorkspaceRole.ADMIN
  );
}

export function requireBoardCreation(member: WorkspaceMember): void {
  if (!canCreateBoard(member))
    throw new ApplicationException(
      403,
      'FORBIDDEN',
      'Workspace policy forbids Board creation',
    );
}

export async function requireBoardPolicy(
  manager: EntityManager,
  workspaceId: string,
  policy:
    | 'boardInvitesEnabled'
    | 'boardMembershipChangesEnabled'
    | 'boardVisibilityChangesEnabled',
): Promise<Workspace> {
  const workspace = await manager.getRepository(Workspace).findOne({
    where: { id: workspaceId },
    lock: { mode: 'pessimistic_read' },
  });
  if (!workspace || !workspace[policy])
    throw new ApplicationException(
      403,
      'FORBIDDEN',
      'Workspace policy forbids this operation',
    );
  return workspace;
}
