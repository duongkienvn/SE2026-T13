import { WorkspaceRole } from '@kanban/shared';
import type { Decoder } from '../../../infrastructure/api/client.ts';
import {
  ApiError,
  invalidResponse,
} from '../../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { requirePage } from '../../../infrastructure/query/pagination.ts';
import type { ResourceId } from '../../../navigation/routes.ts';
import { maxWorkspacePage, workspacePageLimit } from '../api.ts';
import { workspaceId } from '../decoder.ts';
import {
  decodeGuest,
  decodeMember,
  decodePolicies,
  policyFields,
  type WorkspacePolicies,
} from './decoder.ts';

export type RosterFilter = { search?: string; role?: WorkspaceRole };

export function normalizeRosterFilter({ search, role }: RosterFilter = {}) {
  const value = search?.trim();
  if (
    (value && [...value].length > 120) ||
    (role !== undefined && !Object.values(WorkspaceRole).includes(role))
  )
    throw new ApiError('configuration');
  return { search: value || undefined, role };
}

export function createWorkspaceMembershipApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  id: ResourceId,
) {
  if (workspaceId(id) !== id) throw new ApiError('configuration');
  const path = `/workspaces/${id}`;
  const workspaceKey = queryKeys.workspace(identity, id);
  const request = (
    section: 'members' | 'guests' | 'policies',
    signal: AbortSignal,
  ) => ({
    identity,
    signal,
    expectedStatus: 200,
    resourceKey: [...workspaceKey, section] as const,
    retries: 0 as const,
  });

  async function roster<T>(
    section: 'members' | 'guests',
    decode: Decoder<T>,
    rowId: (row: T) => string,
    page: number,
    filters: RosterFilter,
    signal: AbortSignal,
    limit: number,
  ) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > maxWorkspacePage ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new ApiError('configuration');
    const options = normalizeRosterFilter(filters);
    const result = requirePage(
      await api.envelope<T[]>(
        `${path}/${section}`,
        (value) => {
          if (!Array.isArray(value) || value.length > limit)
            throw invalidResponse(200);
          const rows = value.map(decode);
          if (new Set(rows.map(rowId)).size !== rows.length)
            throw invalidResponse(200);
          return rows;
        },
        { ...request(section, signal), query: { ...options, page, limit } },
      ),
    );
    const { meta, data } = result;
    if (
      meta.page !== page ||
      meta.limit !== limit ||
      meta.totalPages !== Math.ceil(meta.total / limit) ||
      data.length !==
        Math.min(limit, Math.max(0, meta.total - (page - 1) * limit))
    )
      throw invalidResponse(200);
    return result;
  }

  function memberPath(userId: ResourceId) {
    if (workspaceId(userId) !== userId) throw new ApiError('configuration');
    return `${path}/members/${userId}`;
  }

  return {
    members: (
      page: number,
      filters: RosterFilter,
      signal: AbortSignal,
      limit = workspacePageLimit,
    ) =>
      roster(
        'members',
        decodeMember,
        (row) => row.userId,
        page,
        filters,
        signal,
        limit,
      ),
    guests: (
      page: number,
      search: string | undefined,
      signal: AbortSignal,
      limit = workspacePageLimit,
    ) =>
      roster(
        'guests',
        decodeGuest,
        (row) => row.user.id,
        page,
        { search },
        signal,
        limit,
      ),
    changeRole(userId: ResourceId, role: WorkspaceRole, signal: AbortSignal) {
      if (!Object.values(WorkspaceRole).includes(role))
        throw new ApiError('configuration');
      return api.json(
        memberPath(userId),
        (value) => {
          const member = decodeMember(value);
          if (member.userId !== userId) throw invalidResponse(200);
          return member;
        },
        { ...request('members', signal), method: 'PATCH', body: { role } },
      );
    },
    remove(userId: ResourceId, signal: AbortSignal) {
      return api.empty(memberPath(userId), {
        ...request('members', signal),
        method: 'DELETE',
      });
    },
    policies(signal: AbortSignal) {
      return api.json(
        `${path}/policies`,
        decodePolicies,
        request('policies', signal),
      );
    },
    updatePolicies(input: Partial<WorkspacePolicies>, signal: AbortSignal) {
      const entries = Object.entries(input);
      if (
        !entries.length ||
        entries.some(
          ([key, value]) =>
            !policyFields.some((field) => field === key) ||
            typeof value !== 'boolean',
        )
      )
        throw new ApiError('configuration');
      return api.json(`${path}/policies`, decodePolicies, {
        ...request('policies', signal),
        method: 'PATCH',
        body: input,
      });
    },
  };
}
