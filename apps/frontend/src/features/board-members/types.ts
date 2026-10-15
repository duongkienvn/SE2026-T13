import type { BoardRole } from '@kanban/shared';
import type { User } from '../auth/types';

/*
 * Frontend copies of the Board Membership contract (issue #21,
 * `BoardMemberResponseDto`).
 */

export type MemberUser = Pick<
  User,
  'id' | 'email' | 'displayName' | 'avatarUrl'
>;

export interface BoardMember {
  /** The membership id; member routes take the user id instead. */
  id: string;
  user: MemberUser;
  role: BoardRole;
  joinedAt: string;
}

export interface AddMemberRequest {
  email: string;
}

export interface UpdateMemberRoleRequest {
  role: BoardRole;
}
