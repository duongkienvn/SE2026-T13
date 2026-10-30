import type { EntityManager } from 'typeorm';
import {
  WorkspaceActivity,
  type WorkspaceActivityType,
} from './entities/workspace-activity.entity';

/** Uses the caller's transaction; never opens a transaction or publishes externally. */
export async function recordWorkspaceActivity(
  manager: EntityManager,
  event: {
    workspaceId: string;
    actorId: string;
    eventType: WorkspaceActivityType;
    boardId?: string;
    boardMoveVersion?: number;
  },
): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Workspace activity requires a transaction');
  await manager.getRepository(WorkspaceActivity).insert({
    workspaceId: event.workspaceId,
    actorId: event.actorId,
    eventType: event.eventType,
    boardId: event.boardId ?? null,
    boardMoveVersion: event.boardMoveVersion ?? null,
  });
}
