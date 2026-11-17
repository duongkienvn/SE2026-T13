import { ApiError } from '../../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import type { ResourceId } from '../../../navigation/routes.ts';
import { createWorkspaceApi } from '../api.ts';
import { workspaceDirectoryOptions } from '../queries.ts';
import { createWorkspaceMembershipApi } from '../membership/api.ts';
import {
  recheckWorkspaceAccess,
  workspaceCollaborationKeys,
} from '../membership/queries.ts';
import type { WorkspaceMember } from '../membership/decoder.ts';

export async function readInvitationBaseline(
  data: MobileDataLayer,
  identity: SessionIdentity,
  signal: AbortSignal,
) {
  const directory = await createWorkspaceApi(data.api, identity)
    .directory(signal)
    .catch(() => null);
  data.assertCurrent(identity);
  if (signal.aborted) throw new ApiError('aborted');
  return directory && new Set(directory.map(({ id }) => id));
}

export async function reconcileAcceptedInvitation(
  data: MobileDataLayer,
  identity: SessionIdentity,
  member: WorkspaceMember,
  baseline: Set<ResourceId> | null,
  signal: AbortSignal,
) {
  const options = workspaceDirectoryOptions(data, identity);
  data.cancelResourceRequests(options.queryKey);
  await data.queryClient.cancelQueries({ queryKey: options.queryKey });
  data.assertCurrent(identity);
  if (signal.aborted) return;
  // The acceptance DTO does not identify a Workspace. Only an authorized
  // directory addition with the returned membership can select a destination.
  const directory = await data.queryClient.fetchQuery({
    ...options,
    staleTime: 0,
    retry: false,
  });
  data.assertCurrent(identity);
  void data
    .invalidate(identity, [queryKeys.notifications(identity)])
    .catch(() => undefined);
  const candidates = baseline
    ? directory.filter(({ id }) => !baseline.has(id))
    : [];
  if (candidates.length !== 1 || signal.aborted) return;
  const candidate = candidates[0]!;
  const roster = await createWorkspaceMembershipApi(
    data.api,
    identity,
    candidate.id,
  ).members(1, { search: member.displayName }, signal);
  if (
    !roster.data.some(
      (row) =>
        row.userId === member.userId &&
        row.joinedAt === member.joinedAt &&
        row.role === member.role,
    )
  )
    return;
  if (signal.aborted) return;
  await recheckWorkspaceAccess(data, identity, candidate.id);
  data.assertCurrent(identity);
  void data
    .invalidate(identity, [
      workspaceCollaborationKeys.members(identity, candidate.id),
      [...queryKeys.workspace(identity, candidate.id), 'overview'],
    ])
    .catch(() => undefined);
  if (!signal.aborted) return candidate.id;
}
