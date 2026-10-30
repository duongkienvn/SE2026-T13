import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { boardKeys } from '../../boards/query-keys';
import { WorkspaceUnavailableError } from '../api';
import { workspaceErrorState } from '../hooks';
import { workspaceKeys } from '../query-keys';
import { revokeWorkspaceAccess } from '../revoke-workspace-access';
import type { WorkspaceSummary, WorkspaceViewState } from '../types';
import {
  deleteWorkspace,
  getWorkspace,
  getWorkspacePolicy,
  leaveWorkspace,
  updateWorkspace,
  updateWorkspacePolicy,
  type PolicyFields,
  type WorkspaceMetadataInput,
} from './api';

function useScope(workspaceId: string) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const userId = user?.id ?? '';
  const g = scope.generation;
  const keys = {
    session: workspaceKeys.session(userId, g),
    list: workspaceKeys.list(userId, g),
    resource: workspaceKeys.resource(userId, g, workspaceId),
    overview: workspaceKeys.overview(userId, g, workspaceId),
    detail: workspaceKeys.detail(userId, g, workspaceId),
    policies: workspaceKeys.policies(userId, g, workspaceId),
  };
  const revoke = (error: unknown, sourceKey: readonly unknown[]) =>
    revokeWorkspaceAccess(client, userId, g, workspaceId, error, sourceKey);
  return { user, runAuthorized, scope, client, keys, revoke };
}

/** Reads one resource of a ready Workspace; 404 hides the whole Workspace. */
function useWorkspaceRead<T>(
  workspaceId: string,
  key: 'detail' | 'policies',
  read: (token: string, signal: AbortSignal) => Promise<T>,
  workspaceState: WorkspaceViewState,
) {
  const { user, runAuthorized, scope, keys, revoke } = useScope(workspaceId);
  const query = useQuery({
    queryKey: keys[key],
    queryFn: async ({ signal }) => {
      try {
        return await runAuthorized((token) => read(token, signal));
      } catch (error) {
        if (scope.isCurrent() && isApiError(error) && error.status === 404)
          await revoke(error, keys[key]);
        throw error;
      }
    },
    enabled: !!user && workspaceState === 'ready',
    retry: false,
    refetchOnMount: 'always',
  });
  const state: WorkspaceViewState =
    workspaceState !== 'ready'
      ? workspaceState
      : query.isError
        ? workspaceErrorState(query.error)
        : query.isSuccess && scope.isCurrent()
          ? 'ready'
          : 'loading';
  return { ...query, state, value: state === 'ready' ? query.data : undefined };
}

export const useWorkspaceDetail = (
  workspaceId: string,
  workspaceState: WorkspaceViewState,
) =>
  useWorkspaceRead(
    workspaceId,
    'detail',
    (token, signal) => getWorkspace(token, workspaceId, signal),
    workspaceState,
  );

export const useWorkspacePolicy = (
  workspaceId: string,
  workspaceState: WorkspaceViewState,
) =>
  useWorkspaceRead(
    workspaceId,
    'policies',
    (token, signal) => getWorkspacePolicy(token, workspaceId, signal),
    workspaceState,
  );

/**
 * Settings commands. Nothing changes before the server confirms. A 403 means
 * this account lost ADMIN, 404 that the Workspace is gone, 409 another change
 * won: each reloads the facts behind the form.
 */
function useSettingsCommand<Input, Output>(
  workspaceId: string,
  name: string,
  run: (token: string, input: Input) => Promise<Output>,
  invalidate: (keys: ReturnType<typeof useScope>['keys']) => unknown[][],
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
      if (!scope.isCurrent()) return;
      for (const queryKey of invalidate(keys))
        void client.invalidateQueries({ queryKey });
    },
    onError: async (error) => {
      if (!scope.isCurrent() || !isApiError(error)) return;
      if (error.status === 404) await revoke(error, keys.overview);
      else if ([403, 409].includes(error.status))
        void client.invalidateQueries({ queryKey: keys.resource });
    },
  });
  return { ...mutation, isCurrent: scope.isCurrent };
}

export const useUpdateWorkspace = (workspaceId: string) =>
  useSettingsCommand(
    workspaceId,
    'update',
    (token, input: Partial<WorkspaceMetadataInput>) =>
      updateWorkspace(token, workspaceId, input),
    // Name/icon appear in the header, sidebar, switcher and directory.
    (keys) => [[...keys.session]],
  );

export const useUpdateWorkspacePolicy = (workspaceId: string) =>
  useSettingsCommand(
    workspaceId,
    'update-policy',
    (token, input: Partial<PolicyFields>) =>
      updateWorkspacePolicy(token, workspaceId, input),
    // Create/invite/visibility capabilities shown on Board pages change too.
    (keys) => [[...keys.resource], [...keys.list], [...boardKeys.all]],
  );

export const useLeaveWorkspace = (workspaceId: string) =>
  useSettingsCommand<void, void>(
    workspaceId,
    'leave',
    (token) => leaveWorkspace(token, workspaceId),
    () => [],
  );

export const useDeleteWorkspace = (workspaceId: string) =>
  useSettingsCommand(
    workspaceId,
    'delete',
    (token, confirmationName: string) =>
      deleteWorkspace(token, workspaceId, confirmationName),
    () => [],
  );

/** After leave/delete: drop every cached page of the Workspace, then refresh. */
export function useForgetWorkspace(workspaceId: string) {
  const { client, keys, scope } = useScope(workspaceId);
  return () => {
    if (!scope.isCurrent()) return;
    void client.cancelQueries({ queryKey: keys.resource });
    client.removeQueries({ queryKey: keys.resource });
    client.setQueryData<WorkspaceSummary[]>(keys.list, (items) =>
      items?.filter((item) => item.id !== workspaceId),
    );
    void client.invalidateQueries({ queryKey: keys.list });
    void client.invalidateQueries({ queryKey: boardKeys.all });
  };
}
