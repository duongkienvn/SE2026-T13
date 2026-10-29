import { boardCapabilities } from '../../src/api/board-members/board-permissions';
import { BoardMemberRole } from '../../src/common/enums/database-enums';

describe('Board capabilities for an established read grant', () => {
  it('reports membership management only when an owner is permitted by Workspace policy', () => {
    const board = {
      isArchived: false,
      workspace: {
        boardInvitesEnabled: false,
        boardMembershipChangesEnabled: false,
      },
    };
    expect(
      boardCapabilities(board, BoardMemberRole.OWNER).canManageMembers,
    ).toBe(false);
    const inviting = {
      ...board,
      workspace: { ...board.workspace, boardInvitesEnabled: true },
    };
    const editing = {
      ...board,
      workspace: { ...board.workspace, boardMembershipChangesEnabled: true },
    };
    expect(
      boardCapabilities(inviting, BoardMemberRole.OWNER).canManageMembers,
    ).toBe(true);
    expect(
      boardCapabilities(editing, BoardMemberRole.MEMBER).canManageMembers,
    ).toBe(false);
  });
  it.each([BoardMemberRole.OWNER, BoardMemberRole.MEMBER, null])(
    'keeps %s writes separate from visibility and archive restore',
    (role) => {
      for (const isArchived of [false, true]) {
        expect(
          boardCapabilities(
            {
              isArchived,
              workspace: {
                boardInvitesEnabled: true,
                boardMembershipChangesEnabled: true,
              },
            },
            role,
          ),
        ).toEqual({
          canReadBoard: true,
          canWriteBoard: role !== null && !isArchived,
          canManageBoard: role === BoardMemberRole.OWNER && !isArchived,
          canManageMembers: role === BoardMemberRole.OWNER && !isArchived,
          canRestoreBoard: role === BoardMemberRole.OWNER && isArchived,
        });
      }
    },
  );
});
