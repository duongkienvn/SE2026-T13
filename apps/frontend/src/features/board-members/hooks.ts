import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { retryUnlessClientError } from '../../lib/query-client';
import { useRefreshIfArchived } from '../boards/hooks';
import { boardKeys } from '../boards/query-keys';
import { isApiError } from '../../lib/api-client';
import {
  addMember,
  getBoardPolicyCapabilities,
  listAllMembers,
  removeMember,
  updateMemberRole,
} from './api';
import type { AddMemberRequest, UpdateMemberRoleRequest } from './types';
import { refreshWorkspaceGuests } from '../workspaces/members/refresh-guests';
import { refreshWorkspaceBoardSummaries } from '../workspaces/refresh-board-summaries';
import { useAuthSession } from '../auth/auth-session-context';

export function useBoardMembers(boardId: string, { enabled = true } = {}) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.members(boardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listAllMembers(token, boardId, signal)),
    retry: retryUnlessClientError,
    enabled,
  });
}

export function useBoardPolicyCapabilities(boardId: string, enabled: boolean) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.policyCapabilities(boardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) =>
        getBoardPolicyCapabilities(token, boardId, signal),
      ),
    retry: retryUnlessClientError,
    enabled,
  });
}

function useRefreshDeniedPolicy(boardId: string) {
  const client = useQueryClient();
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return (error: unknown) => {
    refreshIfArchived(error);
    if (isApiError(error) && error.status === 403)
      void client.invalidateQueries({
        queryKey: boardKeys.policyCapabilities(boardId),
      });
  };
}

/**
 * Membership changes can also change the signed-in user's own role, so refresh
 * the board (detail + members, which share a key prefix) and the board list.
 */
function useInvalidateBoard(boardId: string) {
  const queryClient = useQueryClient();
  const scope = useAuthSession();
  return () => {
    if (!scope.isCurrent()) return;
    refreshWorkspaceBoardSummaries(queryClient, boardId);
    refreshWorkspaceGuests(queryClient);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardId) }),
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() }),
    ]);
  };
}

export function useAddMember(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateBoard(boardId);
  const refreshIfArchived = useRefreshDeniedPolicy(boardId);
  return useMutation({
    mutationFn: (input: AddMemberRequest) =>
      runAuthorized((token) => addMember(token, boardId, input)),
    onSuccess: invalidate,
    onError: refreshIfArchived,
  });
}

export function useUpdateMemberRole(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateBoard(boardId);
  const refreshIfArchived = useRefreshDeniedPolicy(boardId);
  return useMutation({
    mutationFn: ({
      userId,
      ...input
    }: UpdateMemberRoleRequest & { userId: string }) =>
      runAuthorized((token) => updateMemberRole(token, boardId, userId, input)),
    onSuccess: invalidate,
    onError: refreshIfArchived,
  });
}

export function useRemoveMember(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateBoard(boardId);
  const refreshIfArchived = useRefreshDeniedPolicy(boardId);
  return useMutation({
    mutationFn: (userId: string) =>
      runAuthorized((token) => removeMember(token, boardId, userId)),
    onSuccess: invalidate,
    onError: refreshIfArchived,
  });
}
