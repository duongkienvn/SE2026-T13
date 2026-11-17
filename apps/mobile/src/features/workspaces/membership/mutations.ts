import { WorkspaceRole } from '@kanban/shared';
import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import type { ResourceId } from '../../../navigation/routes.ts';
import type { WorkspaceSummary } from '../decoder.ts';
import { isWorkspaceDenied } from '../queries.ts';
import { createWorkspaceMembershipApi } from './api.ts';
import {
  canManageWorkspaceMembers,
  recheckWorkspaceAccess,
  refreshWorkspaceMembership,
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
