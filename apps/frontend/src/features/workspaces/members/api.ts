import type { WorkspaceRole } from '@kanban/shared';
import { apiRequest, apiRequestPage, type Page } from '../../../lib/api-client';
import type {
  InvitationFilters,
  MemberFilters,
  PageData,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceGuest,
  GuestFilters,
} from './types';

const base = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}`;

function toPageData<T>({ items, meta }: Page<T>): PageData<T> {
  return {
    items,
    total: meta.total,
    page: meta.page,
    pageCount: meta.totalPages,
  };
}

/** One server-scoped page; never build a directory by enumerating Board rosters. */
export async function listWorkspaceGuests(
  accessToken: string,
  workspaceId: string,
  filters: GuestFilters,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.limit),
  });
  if (filters.search.trim()) query.set('search', filters.search.trim());
  return toPageData(
    await apiRequestPage<WorkspaceGuest>(
      `${base(workspaceId)}/guests?${query}`,
      { accessToken, signal },
    ),
  );
}

export async function listWorkspaceMembers(
  accessToken: string,
  workspaceId: string,
  filters: MemberFilters,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.limit),
  });
  if (filters.search.trim()) query.set('search', filters.search.trim());
  if (filters.role !== 'ALL') query.set('role', filters.role);
  return toPageData(
    await apiRequestPage<WorkspaceMember>(
      `${base(workspaceId)}/members?${query}`,
      { accessToken, signal },
    ),
  );
}

export function changeWorkspaceMemberRole(
  accessToken: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
) {
  return apiRequest<WorkspaceMember>(
    `${base(workspaceId)}/members/${encodeURIComponent(userId)}`,
    { accessToken, method: 'PATCH', body: { role } },
  );
}

export function removeWorkspaceMember(
  accessToken: string,
  workspaceId: string,
  userId: string,
) {
  return apiRequest<void>(
    `${base(workspaceId)}/members/${encodeURIComponent(userId)}`,
    { accessToken, method: 'DELETE' },
  );
}

export async function listWorkspaceInvitations(
  accessToken: string,
  workspaceId: string,
  filters: InvitationFilters,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.limit),
  });
  if (filters.status !== 'ALL') query.set('status', filters.status);
  return toPageData(
    await apiRequestPage<WorkspaceInvitation>(
      `${base(workspaceId)}/invitations?${query}`,
      { accessToken, signal },
    ),
  );
}

/** Also the resend/reinvite request: after the cooldown it rotates the proof. */
export function inviteWorkspaceMember(
  accessToken: string,
  workspaceId: string,
  email: string,
) {
  return apiRequest<WorkspaceInvitation>(`${base(workspaceId)}/invitations`, {
    accessToken,
    method: 'POST',
    body: { email, role: 'MEMBER' },
  });
}

export function revokeWorkspaceInvitation(
  accessToken: string,
  workspaceId: string,
  invitationId: string,
) {
  return apiRequest<void>(
    `${base(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
    { accessToken, method: 'DELETE' },
  );
}

export function acceptWorkspaceInvitation(accessToken: string, proof: string) {
  return apiRequest<WorkspaceMember>('/workspace-invitations/accept', {
    accessToken,
    method: 'POST',
    body: { proof },
  });
}

export function declineWorkspaceInvitation(
  accessToken: string,
  proof: string,
): Promise<void> {
  return apiRequest<void>('/workspace-invitations/decline', {
    accessToken,
    method: 'POST',
    body: { proof },
    expectedStatus: 204,
  });
}
