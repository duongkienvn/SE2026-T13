import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api-client';
import { useAuthSession } from '../auth/auth-session-context';
import { useAuth } from '../auth/useAuth';
import { listWorkspaceActivity, WorkspaceUnavailableError } from './api';
import { useWorkspaceGateway } from './gateway-context';
import { workspaceKeys } from './query-keys';
import { revokeWorkspaceAccess } from './revoke-workspace-access';
import type { CreateTeamWorkspaceInput, WorkspaceViewState } from './types';

export function workspaceErrorState(error: unknown): WorkspaceViewState {
  if (error instanceof WorkspaceUnavailableError) return 'unavailable';
  if (isApiError(error) && error.status === 403) return 'forbidden';
  if (isApiError(error) && error.status === 404) return 'not-found';
  return 'error';
}

export function useWorkspaceDirectory() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const gateway = useWorkspaceGateway();
  const query = useQuery({
    queryKey: workspaceKeys.list(user?.id ?? '', scope.generation),
    queryFn: ({ signal }) =>
      runAuthorized((token) => gateway.list(token, signal)),
    enabled: !!user && gateway.available,
    retry: false,
    refetchOnMount: 'always',
  });
  const state: WorkspaceViewState = !gateway.available
    ? 'unavailable'
    : query.isError
      ? workspaceErrorState(query.error)
      : query.isSuccess && query.isFetchedAfterMount && scope.isCurrent()
        ? 'ready'
        : 'loading';
  return {
    ...query,
    state,
    workspaces: state === 'ready' ? (query.data ?? []) : [],
  };
}

export function useWorkspaceOverview(workspaceId: string) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const gateway = useWorkspaceGateway();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: workspaceKeys.overview(
      user?.id ?? '',
      scope.generation,
      workspaceId,
    ),
    queryFn: async ({ signal }) => {
      try {
        return await runAuthorized((token) =>
          gateway.overview(token, workspaceId, signal),
        );
      } catch (error) {
        if (
          scope.isCurrent() &&
          isApiError(error) &&
          [403, 404].includes(error.status)
        ) {
          await revokeWorkspaceAccess(
            client,
            user?.id ?? '',
            scope.generation,
            workspaceId,
            error,
            workspaceKeys.overview(
              user?.id ?? '',
              scope.generation,
              workspaceId,
            ),
          );
        }
        throw error;
      }
    },
    enabled: !!user && !!workspaceId && gateway.available,
    retry: false,
    refetchOnMount: 'always',
  });
  const state: WorkspaceViewState = !gateway.available
    ? 'unavailable'
    : query.isError
      ? workspaceErrorState(query.error)
      : query.isSuccess && query.isFetchedAfterMount && scope.isCurrent()
        ? 'ready'
        : 'loading';
  // An error, even during a background refresh, immediately hides protected data.
  return {
    ...query,
    state,
    overview: state === 'ready' ? query.data : undefined,
  };
}

export function useWorkspaceActivity(
  workspaceId: string,
  page: number,
  limit: number,
  enabled: boolean,
) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const key = [
    ...workspaceKeys.activity(user?.id ?? '', scope.generation, workspaceId),
    page,
    limit,
  ] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      try {
        return await runAuthorized((token) =>
          listWorkspaceActivity(token, workspaceId, page, limit, signal),
        );
      } catch (error) {
        if (
          scope.isCurrent() &&
          isApiError(error) &&
          [403, 404].includes(error.status)
        )
          await revokeWorkspaceAccess(
            client,
            user?.id ?? '',
            scope.generation,
            workspaceId,
            error,
            key,
          );
        throw error;
      }
    },
    enabled: !!user && !!workspaceId && enabled,
    // Remove protected pages once their last observer leaves this Workspace.
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  return {
    ...query,
    pageData:
      enabled &&
      scope.isCurrent() &&
      query.isSuccess &&
      query.isFetchedAfterMount &&
      !query.isFetching
        ? query.data
        : undefined,
  };
}

export function useCreateTeamWorkspace() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const gateway = useWorkspaceGateway();
  const client = useQueryClient();
  const mutation = useMutation({
    retry: false,
    mutationKey: [
      ...workspaceKeys.session(user?.id ?? '', scope.generation),
      'create',
    ],
    mutationFn: (input: CreateTeamWorkspaceInput) => {
      if (!gateway.available || !scope.isCurrent())
        throw new WorkspaceUnavailableError();
      return runAuthorized((token) => gateway.createTeam(token, input));
    },
    onSuccess: () => {
      if (scope.isCurrent())
        void client.invalidateQueries({
          queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
        });
    },
  });
  return {
    ...mutation,
    available: gateway.available,
    isCurrent: scope.isCurrent,
  };
}
