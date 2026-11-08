import { BoardRole } from '@kanban/shared';
import type { BoardRole as BoardRoleValue } from '@kanban/shared';

// MOB-01 compatibility spike: exercise a real runtime and type export at boot.
// This does not grant a role or represent an authenticated user.
export function verifySharedCompatibility(): BoardRoleValue {
  const member: BoardRoleValue = BoardRole.MEMBER;
  if (member !== 'MEMBER') {
    throw new Error('The shared package could not be loaded correctly.');
  }
  return member;
}
