import type { BoardRole, WorkspaceRole } from '@kanban/shared';

/** Exact #132 allowlist; Board roles belong to each association, never the Workspace. */
export interface WorkspaceGuest {
  user: { id: string; displayName: string; avatarUrl: string | null };
  boards: {
    boardId: string;
    name: string;
    role: BoardRole;
    isArchived: boolean;
  }[];
  visibleBoardCount: number;
}

export interface GuestFilters {
  search: string;
  page: number;
  limit: number;
}

/** Wire DTOs from docs/tasks/backend/workspace-members-invitations-api.md. */
export interface WorkspaceMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  avatarRevision: number;
  role: WorkspaceRole;
  joinedAt: string;
}

export const INVITATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
  'DECLINED',
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** SENT means the provider accepted the email; it never proves inbox delivery. */
export type InvitationSendState =
  'UNAVAILABLE' | 'DISPATCHING' | 'SENT' | 'FAILED' | 'UNKNOWN';

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  status: InvitationStatus;
  sendState: InvitationSendState;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  declinedAt: string | null;
}

export interface MemberFilters {
  search: string;
  role: WorkspaceRole | 'ALL';
  page: number;
  limit: number;
}

export interface InvitationFilters {
  status: InvitationStatus | 'ALL';
  page: number;
  limit: number;
}

export interface PageData<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
}
