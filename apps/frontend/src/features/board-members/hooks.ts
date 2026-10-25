import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { retryUnlessClientError } from '../../lib/query-client';
import { useRefreshIfArchived } from '../boards/hooks';
import { boardKeys } from '../boards/query-keys';
import {
  addMember,
  listAllMembers,
  removeMember,
  updateMemberRole,
} from './api';
import type { AddMemberRequest, UpdateMemberRoleRequest } from './types';

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

/**
 * Membership changes can also change the signed-in user's own role, so refresh
 * the board (detail + members, which share a key prefix) and the board list.
 */
function useInvalidateBoard(boardId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardId) }),
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() }),
    ]);
}

export function useAddMember(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateBoard(boardId);
  const refreshIfArchived = useRefreshIfArchived(boardId);
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
  const refreshIfArchived = useRefreshIfArchived(boardId);
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
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return useMutation({
    mutationFn: (userId: string) =>
      runAuthorized((token) => removeMember(token, boardId, userId)),
    onSuccess: invalidate,
    onError: refreshIfArchived,
  });
}
