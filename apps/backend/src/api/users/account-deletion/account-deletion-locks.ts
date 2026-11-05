import type { EntityManager } from 'typeorm';
import type {
  AccountDeletionBlocker,
  AccountDeletionBlockerType,
} from '@kanban/shared';
import { AccountDeletionBlockedException } from './account-deletion-blocked.exception';

export interface DeletionResources {
  boards: string[];
  workspaces: string[];
}
export class DeletionResourcesChanged extends Error {}

/** Includes invisible/read-only grants and invitation dependencies, not just OWNERs. */
export async function deletionResources(
  manager: EntityManager,
  userId: string,
  email: string,
): Promise<DeletionResources> {
  const boards: { id: string }[] = await manager.query(
    `SELECT id FROM boards b WHERE
    EXISTS (SELECT 1 FROM board_members m WHERE m.board_id=b.id AND m.user_id=$1)
    OR EXISTS (SELECT 1 FROM card_assignees a JOIN cards c ON c.id=a.card_id WHERE c.board_id=b.id AND a.user_id=$1)
    OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id=b.workspace_id AND w.type='PERSONAL' AND w.created_by_id=$1)
    ORDER BY id`,
    [userId],
  );
  const workspaces: { id: string }[] = await manager.query(
    `SELECT id FROM workspaces w WHERE
    (w.type='PERSONAL' AND w.created_by_id=$1)
    OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=$1)
    OR EXISTS (SELECT 1 FROM workspace_invitations i WHERE i.workspace_id=w.id AND (i.invited_by_id=$1 OR i.email=$2))
    ORDER BY id`,
    [userId, email],
  );
  return {
    boards: boards.map((row) => row.id),
    workspaces: workspaces.map((row) => row.id),
  };
}

/** Match Board Move (Board -> Workspace), then credential/notification User locks.
 * Sorted resource acquisition + bounded retry handles older mixed-domain writers.
 */
export async function lockDeletionResources(
  manager: EntityManager,
  resources: DeletionResources,
): Promise<void> {
  await manager.query(
    'SELECT id FROM boards WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [resources.boards],
  );
  await manager.query(
    'SELECT id FROM workspaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [resources.workspaces],
  );
}

export async function requireDeletionEligible(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  const blockers: AccountDeletionBlocker[] = [];
  const collect = async (type: AccountDeletionBlockerType, sql: string) => {
    const rows: { id: string; name: string; total: number }[] =
      await manager.query(sql, [userId]);
    if (rows.length)
      blockers.push({
        type,
        totalCount: Number(rows[0].total),
        resources: rows.map(({ id, name }) => ({ id, name })),
      });
  };
  await collect(
    'PERSONAL_WORKSPACE_HAS_BOARDS',
    `SELECT b.id,b.name,count(*) OVER()::int total FROM boards b
    JOIN workspaces w ON w.id=b.workspace_id WHERE w.type='PERSONAL' AND w.created_by_id=$1 ORDER BY b.id LIMIT 20`,
  );
  await collect(
    'BOARD_REQUIRES_ANOTHER_OWNER',
    `SELECT b.id,b.name,count(*) OVER()::int total FROM boards b
    JOIN board_members m ON m.board_id=b.id AND m.user_id=$1 AND m.role='OWNER'
    WHERE NOT EXISTS (SELECT 1 FROM board_members alt JOIN users u ON u.id=alt.user_id AND u.deleted_at IS NULL
      WHERE alt.board_id=b.id AND alt.user_id<>$1 AND alt.role='OWNER') ORDER BY b.id LIMIT 20`,
  );
  await collect(
    'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
    `SELECT w.id,w.name,count(*) OVER()::int total FROM workspaces w
    JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1 AND m.role='ADMIN' WHERE w.type='TEAM'
    AND NOT EXISTS (SELECT 1 FROM workspace_members alt JOIN users u ON u.id=alt.user_id AND u.deleted_at IS NULL
      WHERE alt.workspace_id=w.id AND alt.user_id<>$1 AND alt.role='ADMIN') ORDER BY w.id LIMIT 20`,
  );
  if (blockers.length) throw new AccountDeletionBlockedException(blockers);
}
