import type { BoardVisibility } from '@kanban/shared';
import { apiRequest } from '../../../lib/api-client';
import type { Board } from '../../boards/types';
import type { WorkspaceResponse } from '../response';

/** Wire DTOs from docs/tasks/backend/workspace-policies-board-move.md. */
export interface WorkspacePolicy {
  boardCreationAdminOnly: boolean;
  boardInvitesEnabled: boolean;
  boardMembershipChangesEnabled: boolean;
  boardVisibilityChangesEnabled: boolean;
  canManagePolicies: boolean;
  canCreateBoards: boolean;
}

export type PolicyFields = Omit<
  WorkspacePolicy,
  'canManagePolicies' | 'canCreateBoards'
>;

export type WorkspaceIcon = NonNullable<WorkspaceResponse['icon']>;
export const WORKSPACE_ICONS: readonly WorkspaceIcon[] = [
  'briefcase',
  'users',
  'code',
  'palette',
  'layers',
];

export interface WorkspaceMetadataInput {
  name: string;
  description: string | null;
  icon: WorkspaceIcon | null;
}

const base = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}`;

export const getWorkspace = (
  accessToken: string,
  workspaceId: string,
  signal?: AbortSignal,
) => apiRequest<WorkspaceResponse>(base(workspaceId), { accessToken, signal });

export const updateWorkspace = (
  accessToken: string,
  workspaceId: string,
  input: Partial<WorkspaceMetadataInput>,
) =>
  apiRequest<WorkspaceResponse>(base(workspaceId), {
    accessToken,
    method: 'PATCH',
    body: input,
  });

export const getWorkspacePolicy = (
  accessToken: string,
  workspaceId: string,
  signal?: AbortSignal,
) =>
  apiRequest<WorkspacePolicy>(`${base(workspaceId)}/policies`, {
    accessToken,
    signal,
  });

export const updateWorkspacePolicy = (
  accessToken: string,
  workspaceId: string,
  input: Partial<PolicyFields>,
) =>
  apiRequest<WorkspacePolicy>(`${base(workspaceId)}/policies`, {
    accessToken,
    method: 'PATCH',
    body: input,
  });

export const leaveWorkspace = (accessToken: string, workspaceId: string) =>
  apiRequest<void>(`${base(workspaceId)}/leave`, {
    accessToken,
    method: 'POST',
  });

/** The typed name is UX; the server re-checks ADMIN, Team and zero Boards. */
export const deleteWorkspace = (
  accessToken: string,
  workspaceId: string,
  confirmationName: string,
) =>
  apiRequest<void>(base(workspaceId), {
    accessToken,
    method: 'DELETE',
    body: { confirmationName },
  });

export const changeBoardVisibility = (
  accessToken: string,
  boardId: string,
  visibility: BoardVisibility,
) =>
  apiRequest<Board>(`/boards/${encodeURIComponent(boardId)}/visibility`, {
    accessToken,
    method: 'PATCH',
    body: { visibility },
  });

export const moveBoardToWorkspace = (
  accessToken: string,
  boardId: string,
  destinationWorkspaceId: string,
) =>
  apiRequest<Board>(`/boards/${encodeURIComponent(boardId)}/move-workspace`, {
    accessToken,
    method: 'POST',
    body: { destinationWorkspaceId },
  });
