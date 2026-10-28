import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { workspaceErrorState } from '../hooks';
import { workspaceKeys } from '../query-keys';
import { revokeWorkspaceAccess } from '../revoke-workspace-access';
import type { WorkspaceViewState } from '../types';
import { useWorkspaceBoardsGateway } from './gateway';
import type { WorkspaceBoardFilters } from './types';

export function useWorkspaceBoards(
  workspaceId: string,
  filters: WorkspaceBoardFilters,
  workspaceState: WorkspaceViewState,
) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const gateway = useWorkspaceBoardsGateway();
  const client = useQueryClient();
  const queryKey = [
    ...workspaceKeys.boards(user?.id ?? '', scope.generation, workspaceId),
    filters,
  ] as const;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        return await runAuthorized((token) =>
          gateway.list(token, workspaceId, filters, signal),
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
            queryKey,
          );
        throw error;
      }
    },
    enabled: !!user && gateway.available && workspaceState === 'ready',
    retry: false,
    refetchOnMount: 'always',
  });
  const state: WorkspaceViewState =
    workspaceState !== 'ready'
      ? workspaceState
      : !gateway.available
        ? 'unavailable'
        : query.isError
          ? workspaceErrorState(query.error)
          : query.isSuccess && query.isFetchedAfterMount && scope.isCurrent()
            ? 'ready'
            : 'loading';
  return {
    ...query,
    state,
    pageData: state === 'ready' ? query.data : undefined,
  };
}
