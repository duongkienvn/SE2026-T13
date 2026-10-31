import {
  ApiError,
  ClientErrorCode,
  apiRequest,
  apiRequestPage,
  fetchAllPages,
  MAX_PAGE_LIMIT,
} from '../../lib/api-client';
import {
  isMemberCount,
  mapWorkspace,
  mapWorkspaceBoard,
  type WorkspaceResponse,
  type WorkspaceOverviewResponse,
} from './response';
import type {
  CreateTeamWorkspaceInput,
  WorkspaceOverview,
  WorkspaceSummary,
  WorkspaceActivityItem,
} from './types';

export function listWorkspaceActivity(
  accessToken: string,
  workspaceId: string,
  page: number,
  limit: number,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  return apiRequestPage<WorkspaceActivityItem>(
    `/workspaces/${encodeURIComponent(workspaceId)}/activity?${query}`,
    { accessToken, signal },
  );
}

/** Membership-only discovery and server ACL-filtered overview. */
export interface WorkspaceGateway {
  available: boolean;
  list(token: string, signal: AbortSignal): Promise<WorkspaceSummary[]>;
  overview(
    token: string,
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<WorkspaceOverview>;
  createTeam(
    token: string,
    input: CreateTeamWorkspaceInput,
  ): Promise<WorkspaceSummary>;
}

export class WorkspaceUnavailableError extends Error {
  constructor() {
    super('Workspace services are not available yet.');
    this.name = 'WorkspaceUnavailableError';
  }
}

export const workspaceGateway: WorkspaceGateway = {
  available: true,
  async list(accessToken, signal) {
    const items = await fetchAllPages((page) =>
      apiRequestPage<WorkspaceResponse>(
        `/workspaces?${new URLSearchParams({ page: String(page), limit: String(MAX_PAGE_LIMIT) })}`,
        { accessToken, signal },
      ),
    );
    return items.map(mapWorkspace);
  },
  async overview(accessToken, workspaceId, signal) {
    const response = await apiRequest<WorkspaceOverviewResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/overview`,
      { accessToken, signal },
    );
    if (!isMemberCount(response.memberCount))
      throw new ApiError(
        200,
        ClientErrorCode.INVALID_RESPONSE,
        'Invalid Workspace member count.',
      );
    return {
      workspace: mapWorkspace(response.workspace),
      visibleBoardCount: response.visibleBoardCount,
      memberCount: response.memberCount,
      recentBoards: response.recentBoards.map((item) => {
        const board = mapWorkspaceBoard(item);
        return {
          id: board.id,
          name: board.name,
          updatedAt: item.updatedAt,
          archived: board.isArchived,
          memberCount: board.memberCount,
        };
      }),
    };
  },
  async createTeam(accessToken, input) {
    return mapWorkspace(
      await apiRequest<WorkspaceResponse>('/workspaces', {
        accessToken,
        method: 'POST',
        body: { name: input.name, description: input.description },
      }),
    );
  },
};
