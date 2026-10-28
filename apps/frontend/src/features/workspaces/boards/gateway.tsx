import { createContext, useContext } from 'react';
import { apiRequestPage } from '../../../lib/api-client';
import { createBoard } from '../../boards/api';
import { mapWorkspaceBoard, type WorkspaceBoardResponse } from '../response';
import type { WorkspaceBoardsGateway } from './types';

export const workspaceBoardsGateway: WorkspaceBoardsGateway = {
  available: true,
  features: {
    search: true,
    status: true,
    sorts: ['updated-desc', 'name-asc'],
    pagination: true,
  },
  async list(accessToken, workspaceId, filters, signal) {
    const query = new URLSearchParams({
      page: String(filters.page),
      limit: '20',
      status: filters.status,
      sort: filters.sort === 'name-asc' ? 'name' : 'updatedAt',
    });
    if (filters.search.trim()) query.set('search', filters.search.trim());
    const response = await apiRequestPage<WorkspaceBoardResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/boards?${query}`,
      { accessToken, signal },
    );
    return {
      items: response.items.map(mapWorkspaceBoard),
      total: response.meta.total,
      page: response.meta.page,
      pageCount: response.meta.totalPages,
    };
  },
  create: (token, workspaceId, input) =>
    createBoard(token, {
      name: input.name,
      description: input.description,
      workspaceId,
    }),
};
export const WorkspaceBoardsGatewayContext = createContext(
  workspaceBoardsGateway,
);
export const useWorkspaceBoardsGateway = () =>
  useContext(WorkspaceBoardsGatewayContext);
