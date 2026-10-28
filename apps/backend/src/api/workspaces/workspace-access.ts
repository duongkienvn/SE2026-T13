import { WorkspaceType } from '@kanban/shared';
import type { EntityManager } from 'typeorm';
import { ErrorCode } from '../../common/dto/api-error';
import { ApplicationException } from '../../exceptions/application.exception';
import { Workspace } from './entities/workspace.entity';

export async function lockWorkspace(manager: EntityManager, id: string) {
  return manager.getRepository(Workspace).findOne({
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
}

export function requireTeam(workspace: Workspace): void {
  if (workspace.type !== WorkspaceType.TEAM)
    throw new ApplicationException(
      403,
      ErrorCode.FORBIDDEN,
      'Personal Workspace membership cannot be changed',
    );
}
