import type { WorkspaceRole } from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import {
  activityPage,
  activityPageSize,
  decodeRows,
  id,
  validatePagination,
} from '../contracts.ts';
import { activityKeys, activityPageKey } from '../keys.ts';
import { decodeWorkspaceActivity } from './decoder.ts';

export function createWorkspaceActivityApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  workspaceId: string,
) {
  const workspace = id(workspaceId);
  return {
    async list(
      page: number,
      role: WorkspaceRole,
      signal: AbortSignal,
      limit = activityPageSize,
    ) {
      validatePagination(page, limit);
      return activityPage(
        await api.envelope(
          `/workspaces/${workspace}/activity`,
          decodeRows((value) => decodeWorkspaceActivity(value, role), limit),
          {
            identity,
            signal,
            resourceKey: activityPageKey(
              activityKeys.workspace(identity, workspace),
              page,
              limit,
            ),
            expectedStatus: 200,
            retries: 0,
            query: { page, limit },
          },
        ),
        page,
        limit,
      );
    },
  };
}
