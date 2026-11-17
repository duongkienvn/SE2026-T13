import { queryOptions } from '@tanstack/react-query';
import { WorkspaceRole, WorkspaceType } from '@kanban/shared';
import type { SessionIdentity } from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import type { ResourceId } from '../../../navigation/routes.ts';
import type { WorkspaceSummary } from '../decoder.ts';
import { isWorkspaceDenied, workspaceDetailOptions } from '../queries.ts';
import {
  createWorkspaceMembershipApi,
  normalizeRosterFilter,
  type RosterFilter,
} from './api.ts';
import type { WorkspacePolicy } from './decoder.ts';

export const workspaceCapabilityOptions = workspaceDetailOptions;

export function canManageWorkspaceMembers(
  workspace: WorkspaceSummary | undefined,
) {
  return (
    workspace?.type === WorkspaceType.TEAM &&
    workspace.role === WorkspaceRole.ADMIN &&
    workspace.canManage
  );
}

export function canManageWorkspacePolicies(
  workspace: WorkspaceSummary | undefined,
  policy: WorkspacePolicy | undefined,
) {
  return (
    workspace?.role === WorkspaceRole.ADMIN &&
    policy?.canManagePolicies === true
  );
}

export const workspaceCollaborationKeys = {
  members: (identity: SessionIdentity, id: ResourceId) =>
    [...queryKeys.workspace(identity, id), 'members'] as const,
  guests: (identity: SessionIdentity, id: ResourceId) =>
    [...queryKeys.workspace(identity, id), 'guests'] as const,
  policies: (identity: SessionIdentity, id: ResourceId) =>
    [...queryKeys.workspace(identity, id), 'policies'] as const,
};

export async function recheckWorkspaceAccess(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
) {
  return data.queryClient.fetchQuery({
    ...workspaceCapabilityOptions(data, identity, id),
    staleTime: 0,
    retry: false,
  });
}

async function authorizedRead<T>(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  signal: AbortSignal,
  read: () => Promise<T>,
) {
  try {
    return await read();
  } catch (error) {
    if (!signal.aborted && isWorkspaceDenied(error))
      await recheckWorkspaceAccess(data, identity, id).catch(() => undefined);
    throw error;
  }
}

export function workspaceMembersOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  page: number,
  filters: RosterFilter,
) {
  const search = normalizeRosterFilter(filters);
  const api = createWorkspaceMembershipApi(data.api, identity, id);
  return queryOptions({
    queryKey: [
      ...workspaceCollaborationKeys.members(identity, id),
      search,
      page,
    ] as const,
    retry: false,
    queryFn: ({ signal }) =>
      authorizedRead(data, identity, id, signal, () =>
        api.members(page, search, signal),
      ),
  });
}

export function workspaceGuestsOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  page: number,
  search?: string,
) {
  const filter = normalizeRosterFilter({ search }).search;
  const api = createWorkspaceMembershipApi(data.api, identity, id);
  return queryOptions({
    queryKey: [
      ...workspaceCollaborationKeys.guests(identity, id),
      { search: filter },
      page,
    ] as const,
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      authorizedRead(data, identity, id, signal, () =>
        api.guests(page, filter, signal),
      ),
  });
}

export function workspacePoliciesOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
) {
  const api = createWorkspaceMembershipApi(data.api, identity, id);
  return queryOptions({
    queryKey: workspaceCollaborationKeys.policies(identity, id),
    retry: false,
    queryFn: ({ signal }) =>
      authorizedRead(data, identity, id, signal, () => api.policies(signal)),
  });
}

/** Refreshes roster, policy and aggregate projections after Workspace collaboration changes. */
export async function refreshWorkspaceMembership(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
) {
  data.assertCurrent(identity);
  const keys = [
    queryKeys.workspace(identity, id),
    queryKeys.workspaces(identity),
    queryKeys.boardLists(identity),
    queryKeys.home(identity),
    queryKeys.tasks(identity),
    queryKeys.search(identity),
  ];
  for (const key of keys) data.cancelResourceRequests(key);
  await data.invalidate(identity, keys);
}
