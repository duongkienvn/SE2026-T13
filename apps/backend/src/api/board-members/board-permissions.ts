import { BoardVisibility, type BoardCapabilities } from '@kanban/shared';
import { BoardMemberRole } from '../../common/enums/database-enums';
import type { Board } from '../boards/entities/board.entity';
import type { Workspace } from '../workspaces/entities/workspace.entity';

/** Shared SQL predicate: filter before counting, sorting or pagination. */
export const readableBoardPredicate = `(
  EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id = board.id AND bm.user_id = :userId)
  OR (board.visibility = :workspaceVisible AND EXISTS (
    SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = board.workspace_id AND wm.user_id = :userId
  ))
)`;
export const readableBoardParameters = (userId: string) => ({
  userId,
  workspaceVisible: BoardVisibility.WORKSPACE_VISIBLE,
});

/** Call only after establishing a read grant; Workspace roles never grant writes. */
export function boardCapabilities(
  board: Pick<Board, 'isArchived'> & {
    workspace?: Pick<
      Workspace,
      'boardInvitesEnabled' | 'boardMembershipChangesEnabled'
    >;
  },
  role: BoardMemberRole | null,
): BoardCapabilities {
  const owner = role === BoardMemberRole.OWNER;
  return {
    canReadBoard: true,
    canWriteBoard: role !== null && !board.isArchived,
    canManageBoard: owner && !board.isArchived,
    canManageMembers:
      owner &&
      !board.isArchived &&
      (board.workspace?.boardInvitesEnabled === true ||
        board.workspace?.boardMembershipChangesEnabled === true),
    canRestoreBoard: owner && board.isArchived,
  };
}
