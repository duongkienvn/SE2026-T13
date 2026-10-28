import { createContext, useContext } from 'react';
import { WorkspaceUnavailableError } from '../api';
import type { WorkspaceBoardsGateway } from './types';

const unavailable = () => Promise.reject(new WorkspaceUnavailableError());
/** No guessed Workspace endpoints or unscoped /boards fallback. */
export const workspaceBoardsGateway: WorkspaceBoardsGateway = {
  available: false,
  features: { search: false, status: false, sorts: [], pagination: false },
  list: unavailable,
  create: unavailable,
};
export const WorkspaceBoardsGatewayContext = createContext(
  workspaceBoardsGateway,
);
export const useWorkspaceBoardsGateway = () =>
  useContext(WorkspaceBoardsGatewayContext);
