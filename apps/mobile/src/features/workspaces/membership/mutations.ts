import { WorkspaceRole, WorkspaceType } from '@kanban/shared';
import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import type { ResourceId } from '../../../navigation/routes.ts';
import type { WorkspaceSummary } from '../decoder.ts';
import { isWorkspaceDenied } from '../queries.ts';
import { createWorkspaceApi } from '../api.ts';
import { evictWorkspace } from '../queries.ts';
import { createWorkspaceMembershipApi } from './api.ts';
import type { WorkspacePolicies } from './decoder.ts';
import {
  canManageWorkspaceMembers,
  canManageWorkspacePolicies,
  recheckWorkspaceAccess,
  refreshWorkspaceMembership,
  workspaceCollaborationKeys,
  workspaceCapabilityOptions,
} from './queries.ts';

const locks = new WeakMap<MobileDataLayer, Set<string>>();
type MembershipApi = ReturnType<typeof createWorkspaceMembershipApi>;

export function uncertainWorkspaceWrite(error: unknown) {
  return (
    error instanceof ApiError &&
    error.requestStarted === true &&
    ([
      'offline',
      'network',
      'timeout',
      'aborted',
      'invalid-response',
      'session-changed',
    ].includes(error.kind) ||
      error.status >= 500)
  );
}

export async function runWorkspaceCollaborationWrite<T>(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  signal: AbortSignal,
  canWrite: (workspace: WorkspaceSummary) => boolean,
  write: (api: MembershipApi) => Promise<T>,
) {
  data.assertCurrent(identity);
  if (!onlineManager.isOnline()) throw new ApiError('offline');
  if (signal.aborted) throw new ApiError('aborted');
  const key = JSON.stringify([identity.userId, identity.generation, id]);
  const pending = locks.get(data) ?? new Set<string>();
  locks.set(data, pending);
  if (pending.has(key))
    throw new ApiError('http', {
      status: 409,
      message: 'A workspace change is already saving.',
    });
  pending.add(key);
  try {
    const workspace = await recheckWorkspaceAccess(data, identity, id);
    data.assertCurrent(identity);
    if (signal.aborted) throw new ApiError('aborted');
    if (!canWrite(workspace)) throw new ApiError('http', { status: 403 });
    const result = await write(
      createWorkspaceMembershipApi(data.api, identity, id),
    );
    data.assertCurrent(identity);
    await refreshWorkspaceMembership(data, identity, id).catch(() => undefined);
    data.assertCurrent(identity);
    return result;
  } catch (error) {
    if (
      sameIdentity(identity, data.getIdentity()) &&
      (isWorkspaceDenied(error) || uncertainWorkspaceWrite(error))
    )
      void refreshWorkspaceMembership(data, identity, id).catch(
        () => undefined,
      );
    throw error;
  } finally {
    pending.delete(key);
  }
}

export function changeWorkspaceMemberRole(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  userId: ResourceId,
  role: WorkspaceRole,
  signal: AbortSignal,
) {
  return runWorkspaceCollaborationWrite(
    data,
    identity,
    id,
    signal,
    (workspace) =>
      userId !== identity.userId && canManageWorkspaceMembers(workspace),
    (api) => api.changeRole(userId, role, signal),
  );
}

export function removeWorkspaceMember(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  userId: ResourceId,
  signal: AbortSignal,
) {
  return runWorkspaceCollaborationWrite(
    data,
    identity,
    id,
    signal,
    (workspace) =>
      userId !== identity.userId && canManageWorkspaceMembers(workspace),
    (api) => api.remove(userId, signal),
  );
}

/** Keep the server outcome observable when the route changes during a leave. */
export async function leaveWorkspace(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  onLeft?: () => void,
) {
  data.assertCurrent(identity);
  await createWorkspaceApi(data.api, identity).leave(
    id,
    new AbortController().signal,
  );
  data.assertCurrent(identity);
  evictWorkspace(data, identity, id);
  onLeft?.();
}

export function updateWorkspacePolicies(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  changes: Partial<WorkspacePolicies>,
  signal: AbortSignal,
) {
  return runWorkspaceCollaborationWrite(
    data,
    identity,
    id,
    signal,
    (workspace) => workspace.role === WorkspaceRole.ADMIN,
    async (api) => {
      const policy = await api.policies(signal);
      const workspace = data.queryClient.getQueryData<WorkspaceSummary>(
        workspaceCapabilityOptions(data, identity, id).queryKey,
      );
      if (!canManageWorkspacePolicies(workspace, policy))
        throw new ApiError('http', { status: 403 });
      if (
        workspace?.type === WorkspaceType.PERSONAL &&
        changes.boardCreationAdminOnly !== undefined
      )
        throw new ApiError('http', {
          status: 400,
          message: 'This setting applies to Team Workspaces.',
        });
      const result = await api.updatePolicies(changes, signal);
      data.assertCurrent(identity);
      data.queryClient.setQueryData(
        workspaceCollaborationKeys.policies(identity, id),
        result,
      );
      // MOB-25: open Board sharing screens must re-read effective per-action policy.
      const boardPolicies = [...data.resources.trackedBoardIds()]
        .filter((boardId) => data.resources.boardWorkspace(boardId) === id)
        .map(
          (boardId) =>
            [
              ...queryKeys.board(identity, boardId),
              'settings',
              'policy',
            ] as const,
        );
      for (const key of boardPolicies) data.cancelResourceRequests(key);
      void data.invalidate(identity, boardPolicies).catch(() => undefined);
      return result;
    },
  );
}
