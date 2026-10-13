import type { BoardRole } from '@kanban/shared';
import type { User } from '../auth/types';

/*
 * Frontend copies of the Board Membership contract (issue #21). The nested
 * `user` shape is assumed until the backend confirms it.
 */

export type MemberUser = Pick<
  User,
  'id' | 'email' | 'displayName' | 'avatarUrl'
>;

export interface BoardMember {
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
