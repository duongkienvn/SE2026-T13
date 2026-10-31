import type { WorkspaceRole } from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { WorkspaceUnavailableError } from '../api';
import { workspaceErrorState } from '../hooks';
import { workspaceKeys } from '../query-keys';
import { revokeWorkspaceAccess } from '../revoke-workspace-access';
import type { WorkspaceViewState } from '../types';
import {
  acceptWorkspaceInvitation,
  declineWorkspaceInvitation,
  changeWorkspaceMemberRole,
  inviteWorkspaceMember,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  listWorkspaceGuests,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
} from './api';
import type { GuestFilters, InvitationFilters, MemberFilters } from './types';

function viewState(
  parent: WorkspaceViewState,
  query: { isError: boolean; error: unknown; isSuccess: boolean },
  fresh: boolean,
): WorkspaceViewState {
  if (parent !== 'ready') return parent;
  if (query.isError) return workspaceErrorState(query.error);
  return query.isSuccess && fresh ? 'ready' : 'loading';
}

/** Session/Workspace-scoped key parts shared by the hooks below. */
function useScope(workspaceId: string) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const userId = user?.id ?? '';
  const keys = {
    resource: workspaceKeys.resource(userId, scope.generation, workspaceId),
    overview: workspaceKeys.overview(userId, scope.generation, workspaceId),
    members: workspaceKeys.members(userId, scope.generation, workspaceId),
    guests: workspaceKeys.guests(userId, scope.generation, workspaceId),
    invitations: workspaceKeys.invitations(
      userId,
      scope.generation,
      workspaceId,
    ),
  };
  /** 404 means the Workspace is gone for this account; clear every page of it. */
  const revoke = (error: unknown, sourceKey: readonly unknown[]) =>
    revokeWorkspaceAccess(
      client,
      userId,
      scope.generation,
      workspaceId,
      error,
      sourceKey,
    );
  return { user, runAuthorized, scope, client, keys, revoke };
}

export function useWorkspaceGuests(
  workspaceId: string,
  filters: GuestFilters,
  workspaceState: WorkspaceViewState,
) {
  const { user, runAuthorized, scope, keys, revoke } = useScope(workspaceId);
  const queryKey = [...keys.guests, filters] as const;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        return await runAuthorized((token) =>
          listWorkspaceGuests(token, workspaceId, filters, signal),
        );
      } catch (error) {
        if (
          scope.isCurrent() &&
          isApiError(error) &&
          [403, 404].includes(error.status)
        )
          await revoke(error, queryKey);
        throw error;
      }
    },
    enabled: !!user && workspaceState === 'ready',
    retry: false,
    refetchOnMount: 'always',
    // A cached association may no longer be permitted. No placeholders or stale rows during revalidation.
    placeholderData: undefined,
  });
  const state = viewState(
    workspaceState,
    query,
    query.isFetchedAfterMount && !query.isFetching && scope.isCurrent(),
  );
  return {
    ...query,
    state,
    pageData: state === 'ready' ? query.data : undefined,
  };
}

export function useWorkspaceMembers(
  workspaceId: string,
  filters: MemberFilters,
  workspaceState: WorkspaceViewState,
) {
  const { user, runAuthorized, scope, keys, revoke } = useScope(workspaceId);
  const queryKey = [...keys.members, filters] as const;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        return await runAuthorized((token) =>
          listWorkspaceMembers(token, workspaceId, filters, signal),
        );
      } catch (error) {
        if (
          scope.isCurrent() &&
          isApiError(error) &&
          [403, 404].includes(error.status)
        )
          await revoke(error, queryKey);
        throw error;
      }
    },
    enabled: !!user && workspaceState === 'ready',
    retry: false,
    refetchOnMount: 'always',
    placeholderData: (previous, previousQuery) =>
      // Keep the table steady while paging or filtering the same Workspace.
      JSON.stringify(previousQuery?.queryKey.slice(0, -1)) ===
      JSON.stringify(keys.members)
        ? (previous ?? undefined)
        : undefined,
  });
  const state = viewState(
    workspaceState,
    query,
    (query.isFetchedAfterMount || query.isPlaceholderData) && scope.isCurrent(),
  );
  return {
    ...query,
    state,
    pageData: state === 'ready' ? query.data : undefined,
  };
}

/** ADMIN-only history. A 403 means this account is no longer an ADMIN. */
export function useWorkspaceInvitations(
  workspaceId: string,
  filters: InvitationFilters,
  workspaceState: WorkspaceViewState,
  isAdmin: boolean,
) {
  const { user, runAuthorized, scope, client, keys, revoke } =
    useScope(workspaceId);
  const queryKey = [...keys.invitations, filters] as const;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        return await runAuthorized((token) =>
          listWorkspaceInvitations(token, workspaceId, filters, signal),
        );
      } catch (error) {
        if (scope.isCurrent() && isApiError(error)) {
          if (error.status === 404) await revoke(error, queryKey);
          if (error.status === 403)
            void client.invalidateQueries({ queryKey: keys.overview });
        }
        throw error;
      }
    },
    enabled: !!user && workspaceState === 'ready' && isAdmin,
    retry: false,
    refetchOnMount: 'always',
    placeholderData: (previous, previousQuery) =>
      JSON.stringify(previousQuery?.queryKey.slice(0, -1)) ===
      JSON.stringify(keys.invitations)
        ? (previous ?? undefined)
        : undefined,
  });
  const state = viewState(
    workspaceState,
    query,
    (query.isFetchedAfterMount || query.isPlaceholderData) && scope.isCurrent(),
  );
  return {
    ...query,
    state,
    pageData: state === 'ready' ? query.data : undefined,
  };
}

/**
 * Member and invitation commands. Caches change only after the server
 * confirms; refusals refresh the facts the refusal depends on.
 */
function useWorkspaceCommand<Input, Output>(
  workspaceId: string,
  name: string,
  run: (token: string, input: Input) => Promise<Output>,
) {
  const { user, runAuthorized, scope, client, keys, revoke } =
    useScope(workspaceId);
  const mutation = useMutation({
    retry: false,
    mutationKey: [...keys.resource, name],
    mutationFn: (input: Input) => {
      if (!user || !scope.isCurrent()) throw new WorkspaceUnavailableError();
      return runAuthorized((token) => run(token, input));
    },
    onSuccess: () => {
      if (scope.isCurrent())
        void client.invalidateQueries({ queryKey: keys.resource });
    },
    onError: async (error) => {
      if (!scope.isCurrent() || !isApiError(error)) return;
      if (
        error.status === 404 &&
        name !== 'revoke-invitation' &&
        name !== 'change-role'
      ) {
        await revoke(error, keys.overview);
        return;
      }
      // 403: this account lost ADMIN; 404: the member/invitation may be gone;
      // 409: another ADMIN changed membership first. Show the server's truth.
      if ([403, 404, 409].includes(error.status))
        void client.invalidateQueries({ queryKey: keys.resource });
    },
  });
  return { ...mutation, isCurrent: scope.isCurrent };
}

export const useChangeMemberRole = (workspaceId: string) =>
  useWorkspaceCommand(
    workspaceId,
    'change-role',
    (token, input: { userId: string; role: WorkspaceRole }) =>
      changeWorkspaceMemberRole(token, workspaceId, input.userId, input.role),
  );

export const useRemoveWorkspaceMember = (workspaceId: string) =>
  useWorkspaceCommand(workspaceId, 'remove-member', (token, userId: string) =>
    removeWorkspaceMember(token, workspaceId, userId),
  );

export const useInviteWorkspaceMember = (workspaceId: string) =>
  useWorkspaceCommand(workspaceId, 'invite', (token, email: string) =>
    inviteWorkspaceMember(token, workspaceId, email),
  );

export const useRevokeWorkspaceInvitation = (workspaceId: string) =>
  useWorkspaceCommand(
    workspaceId,
    'revoke-invitation',
    (token, invitationId: string) =>
      revokeWorkspaceInvitation(token, workspaceId, invitationId),
  );

export function useAcceptWorkspaceInvitation() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (proof: string) => {
      if (!user || !scope.isCurrent()) throw new WorkspaceUnavailableError();
      return runAuthorized((token) => acceptWorkspaceInvitation(token, proof));
    },
    onSuccess: () => {
      if (scope.isCurrent())
        void client.invalidateQueries({
          queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
        });
    },
  });
}

export function useDeclineWorkspaceInvitation() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (proof: string) => {
      if (!user || !scope.isCurrent()) throw new WorkspaceUnavailableError();
      return runAuthorized((token) => declineWorkspaceInvitation(token, proof));
    },
    onSuccess: () => {
      if (scope.isCurrent())
        void client.invalidateQueries({
          queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
        });
    },
  });
}
