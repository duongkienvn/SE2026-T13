import { BoardRole } from '@kanban/shared';
import type { Board } from '../boards/types';
import type { BoardMember } from './types';

export interface MemberActionBlocks {
  /** Why this member can't be removed, if they can't. */
  remove?: string;
  /** Why this OWNER can't be made a MEMBER, if they can't. */
  demote?: string;
}

/**
 * Mirrors the membership invariants from #21 so the UI can explain blocked
 * actions up front. The backend still enforces them on every request.
 */
export function memberActionBlocks(
  member: BoardMember,
  members: BoardMember[],
  board: Pick<Board, 'createdById'>,
  currentUserId: string | undefined,
): MemberActionBlocks {
  if (member.user.id === board.createdById) {
    return {
      remove: 'The board creator can’t be removed.',
      demote: 'The board creator always stays an owner.',
    };
  }
  // The member routes refuse owners removing or demoting themselves.
  if (member.user.id === currentUserId) {
    return {
      remove: 'You can’t remove yourself from the board.',
      demote: 'You can’t change your own role.',
    };
  }
  const owners = members.filter((m) => m.role === BoardRole.OWNER).length;
  if (member.role === BoardRole.OWNER && owners <= 1) {
    const reason = 'A board needs at least one owner.';
    return { remove: reason, demote: reason };
  }
  return {};
}

/** Owners first, then alphabetical by name. */
export function sortMembers(members: BoardMember[]): BoardMember[] {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === BoardRole.OWNER ? -1 : 1;
    return a.user.displayName.localeCompare(b.user.displayName);
  });
}
