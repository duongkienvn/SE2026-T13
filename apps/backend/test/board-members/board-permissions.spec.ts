import { boardCapabilities } from '../../src/api/board-members/board-permissions';
import { BoardMemberRole } from '../../src/common/enums/database-enums';

describe('Board capabilities for an established read grant', () => {
  it.each([BoardMemberRole.OWNER, BoardMemberRole.MEMBER, null])(
    'keeps %s writes separate from visibility and archive restore',
    (role) => {
      for (const isArchived of [false, true]) {
        expect(boardCapabilities({ isArchived }, role)).toEqual({
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
